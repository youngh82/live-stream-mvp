import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { getPayoutProvider } from '@/domains/payout/services/toss-provider';
import { TossPayoutError } from '@/shared/lib/toss-payout';
import {
  calculateFees,
  validatePayoutAmount,
  HOLD_DAYS,
} from '@/domains/payout/services/fees';
import type { PayoutBusinessType } from '@/domains/payout/types';

/**
 * 다음 영업일(YYYY-MM-DD, KST).
 *
 * 토스 예약 지급은 익일 오전 9시부터 1년 이내의 영업일만 받는다.
 * 공휴일은 여기서 알 수 없으므로 주말만 건너뛰고, 공휴일이면 토스가
 * 에러로 알려준다(그 경우 사용자에게 다른 날짜를 안내한다).
 */
function nextBusinessDay(from = new Date()): string {
  const kst = new Date(from.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + 1);
  while (kst.getUTCDay() === 0 || kst.getUTCDay() === 6) {
    kst.setUTCDate(kst.getUTCDate() + 1);
  }
  return kst.toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  let payoutId: string | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { amount } = (await request.json()) ?? {};
    if (typeof amount !== 'number' || !Number.isInteger(amount)) {
      return NextResponse.json(
        { error: '환전 금액은 정수여야 합니다' },
        { status: 400 },
      );
    }

    const { data: account } = await supabaseAdmin
      .from('payout_accounts')
      .select('provider_seller_id, business_type, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!account?.provider_seller_id) {
      return NextResponse.json(
        { error: '지급 계좌를 먼저 등록해주세요' },
        { status: 400 },
      );
    }

    if (account.status === 'APPROVAL_REQUIRED') {
      return NextResponse.json(
        { error: '본인인증을 완료해주세요. 등록한 전화번호로 인증 문자가 발송되었습니다' },
        { status: 400 },
      );
    }
    if (account.status === 'KYC_REQUIRED') {
      return NextResponse.json(
        { error: 'KYC 심사가 필요합니다. 등록한 이메일로 안내가 발송되었습니다' },
        { status: 400 },
      );
    }

    // 가용액은 항상 서버가 다시 계산한다. 클라이언트가 보낸 값은 믿지 않는다.
    const { data: available } = await supabaseAdmin.rpc('available_revenue', {
      p_user_id: user.id,
      p_hold_days: HOLD_DAYS,
    });

    const invalid = validatePayoutAmount(amount, available ?? 0);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const businessType = account.business_type as PayoutBusinessType;
    const fees = calculateFees(amount, businessType);
    const refPayoutId = crypto.randomUUID();
    const payoutDate = nextBusinessDay();

    // 순서가 중요하다: DB에서 먼저 차감·기록하고 그 다음에 토스로 보낸다.
    // 반대로 하면 지급은 나갔는데 기록이 없는 상태가 생길 수 있다.
    const { data: created, error: rpcError } = await supabaseAdmin.rpc(
      'request_payout',
      {
        p_user_id: user.id,
        p_ref_payout_id: refPayoutId,
        p_gross: fees.gross,
        p_fee: fees.fee,
        p_withholding: fees.withholding,
        p_net: fees.net,
        p_fee_rate: fees.feeRate,
        p_schedule_type: 'SCHEDULED',
        p_payout_date: payoutDate,
        p_hold_days: HOLD_DAYS,
      },
    );

    if (rpcError) {
      console.error('[Payout/request] RPC error:', rpcError.message);
      return NextResponse.json(
        { error: '환전 신청에 실패했습니다' },
        { status: 400 },
      );
    }
    payoutId = created as string;

    const provider = getPayoutProvider('KR');
    const result = await provider.requestPayout({
      refPayoutId,
      destination: account.provider_seller_id,
      amount: fees.net,
      scheduleType: 'SCHEDULED',
      payoutDate,
      description: '라이브 방송 정산',
    });

    await supabaseAdmin
      .from('payouts')
      .update({
        provider_payout_id: result.payoutId,
        status: result.status,
      })
      .eq('id', payoutId);

    return NextResponse.json({
      payoutId,
      status: result.status,
      payoutDate,
      ...fees,
    });
  } catch (error) {
    // 토스 요청이 실패했으면 차감한 잔액을 되돌린다.
    // revert_payout은 열려 있는 건에만 적용되므로 중복 호출도 안전하다.
    if (payoutId) {
      const code =
        error instanceof TossPayoutError ? error.code : 'REQUEST_FAILED';
      const message =
        error instanceof Error ? error.message : '환전 요청 실패';
      await supabaseAdmin
        .rpc('revert_payout', {
          p_payout_id: payoutId,
          p_status: 'FAILED',
          p_error_code: code,
          p_error_message: message,
        })
        .then(({ error: e }) => {
          if (e) console.error('[Payout/request] revert 실패:', e.message);
        });
    }

    if (error instanceof TossPayoutError) {
      console.error('[Payout/request] Toss error:', error.code, error.message);
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus >= 400 ? error.httpStatus : 502 },
      );
    }
    console.error('[Payout/request] Error:', error);
    return NextResponse.json(
      { error: '환전 신청에 실패했습니다' },
      { status: 500 },
    );
  }
}
