import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import type {
  PayoutAccountStatus,
  PayoutStatus,
} from '@/domains/payout/types';

/**
 * 토스 지급대행 웹훅 (payout.changed, seller.changed).
 *
 * 서명 검증: `{원문 페이로드}:{transmission-time}`을 보안 키로 HMAC-SHA256 한
 * 값이, 헤더의 `v1:` 뒤 두 값 중 하나와 일치해야 한다. 두 개인 이유는 키
 * 교체 중에도 검증이 끊기지 않게 하기 위해서다.
 *
 * 서명 검증에 원문이 필요하므로 request.text()로 먼저 읽고 그 문자열로
 * 검증한 뒤에 JSON.parse 한다. 파싱된 객체를 다시 stringify하면 키 순서나
 * 공백이 달라져 서명이 깨진다.
 */

interface TossWebhookEvent {
  eventType: 'payout.changed' | 'seller.changed';
  eventId: string;
  createdAt: string;
  entityType: string;
  entityBody: Record<string, unknown>;
}

function verifySignature(
  rawBody: string,
  transmissionTime: string,
  signatureHeader: string,
  securityKey: string,
): boolean {
  const message = `${rawBody}:${transmissionTime}`;

  // 문서는 "보안 키로 해싱"이라고만 한다. JWE에서는 hex 디코딩한 바이트를
  // 쓰므로 여기서도 그럴 가능성이 높지만 명시되어 있지 않다.
  // 둘 다 시도하고 하나라도 맞으면 통과시킨다.
  const keys: Buffer[] = [Buffer.from(securityKey, 'utf8')];
  if (/^[0-9a-fA-F]{64}$/.test(securityKey)) {
    keys.push(Buffer.from(securityKey, 'hex'));
  }

  const digests = keys.map((key) =>
    createHmac('sha256', key).update(message).digest(),
  );

  // `v1:xxx=,v1:yyy=` — 키 교체 중에는 두 개가 온다
  const candidates = signatureHeader
    .split(',')
    .map((part) => part.trim().replace(/^v1:/, ''))
    .filter(Boolean)
    .map((b64) => Buffer.from(b64, 'base64'));

  return candidates.some((candidate) =>
    digests.some(
      (digest) =>
        digest.length === candidate.length && timingSafeEqual(digest, candidate),
    ),
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('tosspayments-webhook-signature');
  const transmissionTime = request.headers.get(
    'tosspayments-webhook-transmission-time',
  );
  const securityKey = process.env.TOSS_PAYOUT_SECURITY_KEY;

  if (!securityKey) {
    console.error('[Toss Webhook] TOSS_PAYOUT_SECURITY_KEY 미설정');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  if (!signature || !transmissionTime) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  if (!verifySignature(rawBody, transmissionTime, signature, securityKey)) {
    console.error('[Toss Webhook] 서명 검증 실패');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: TossWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // 멱등성. Stripe 웹훅(H-02)과 같은 패턴 — 처리 전에 eventId를 PK로 INSERT
  // 하고 유니크 위반이면 이미 처리한 것으로 본다. 잔액 복원이 두 번 일어나면
  // 없던 돈이 생기므로 여기서 반드시 막아야 한다.
  const { error: dedupeError } = await supabaseAdmin
    .from('processed_toss_events')
    .insert({ event_id: event.eventId, event_type: event.eventType });

  if (dedupeError) {
    if (dedupeError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('[Toss Webhook] 멱등 기록 실패:', dedupeError);
    return NextResponse.json({ error: 'Dedupe failed' }, { status: 500 });
  }

  try {
    if (event.eventType === 'payout.changed') {
      await handlePayoutChanged(event.entityBody);
    } else if (event.eventType === 'seller.changed') {
      await handleSellerChanged(event.entityBody);
    }
  } catch (error) {
    console.error('[Toss Webhook] 처리 실패:', error);
    // 멱등 기록을 지워서 재전송 때 다시 처리되게 한다
    await supabaseAdmin
      .from('processed_toss_events')
      .delete()
      .eq('event_id', event.eventId);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handlePayoutChanged(body: Record<string, unknown>) {
  const refPayoutId = body.refPayoutId as string | undefined;
  const providerPayoutId = body.id as string | undefined;
  const status = body.status as PayoutStatus | undefined;
  const error = body.error as { code?: string; message?: string } | null;

  if (!refPayoutId || !status) {
    console.error('[Toss Webhook] payout 본문 불완전:', body);
    return;
  }

  const { data: payout } = await supabaseAdmin
    .from('payouts')
    .select('id, status')
    .eq('ref_payout_id', refPayoutId)
    .maybeSingle();

  if (!payout) {
    console.error('[Toss Webhook] 알 수 없는 환전 건:', refPayoutId);
    return;
  }

  // 실패·취소는 차감했던 수익 잔액을 되돌려야 한다.
  // revert_payout이 열려 있는 건에만 적용되므로 중복 복원이 안 된다.
  if (status === 'FAILED' || status === 'CANCELED') {
    const { data: reverted } = await supabaseAdmin.rpc('revert_payout', {
      p_payout_id: payout.id,
      p_status: status,
      p_error_code: error?.code ?? null,
      p_error_message: error?.message ?? null,
    });
    if (!reverted) {
      console.warn('[Toss Webhook] 이미 종료된 건이라 복원 생략:', payout.id);
    }
    return;
  }

  const { error: updateError } = await supabaseAdmin
    .from('payouts')
    .update({
      status,
      provider_payout_id: providerPayoutId ?? null,
      completed_at: status === 'COMPLETED' ? new Date().toISOString() : null,
    })
    .eq('id', payout.id);

  if (updateError) throw updateError;
}

async function handleSellerChanged(body: Record<string, unknown>) {
  const sellerId = body.id as string | undefined;
  const status = body.status as PayoutAccountStatus | undefined;

  if (!sellerId || !status) {
    console.error('[Toss Webhook] seller 본문 불완전:', body);
    return;
  }

  const { error } = await supabaseAdmin
    .from('payout_accounts')
    .update({ status })
    .eq('provider_seller_id', sellerId);

  if (error) throw error;
}
