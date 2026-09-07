import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/shared/lib/stripe';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // H-02: 멱등성.
  //
  // Stripe는 at-least-once 전달이라 같은 이벤트가 두 번 이상 올 수 있다
  // (응답 지연이나 5xx 시 자동 재시도). 포인트를 넣기 전에 event_id를
  // PK로 INSERT하고, 유니크 위반이면 이미 처리한 것으로 보고 조기 반환한다.
  const { error: dedupeError } = await supabaseAdmin
    .from('processed_stripe_events')
    .insert({ event_id: event.id, event_type: event.type });

  if (dedupeError) {
    // 23505 = unique_violation → 중복 전달
    if (dedupeError.code === '23505') {
      console.log(`[Stripe Webhook] 중복 이벤트 무시: ${event.id}`);
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('[Stripe Webhook] 멱등 기록 실패:', dedupeError);
    // 기록에 실패하면 중복 충전 위험이 있으므로 처리하지 않고 재시도를 유도한다
    return NextResponse.json({ error: 'Dedupe failed' }, { status: 500 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    const points = parseInt(session.metadata?.points || '0');

    if (!userId || !points) {
      console.error('[Stripe Webhook] Missing metadata:', session.metadata);
      return NextResponse.json({ received: true });
    }

    const { error } = await supabaseAdmin.rpc('add_points', {
      target_user_id: userId,
      amount: points,
    });

    if (error) {
      console.error('[Stripe Webhook] Failed to add points:', error);
      // 충전에 실패했으면 멱등 기록을 지워 Stripe 재시도가 다시 처리하도록 한다
      await supabaseAdmin
        .from('processed_stripe_events')
        .delete()
        .eq('event_id', event.id);

      return NextResponse.json(
        { error: 'Failed to add points' },
        { status: 500 },
      );
    }

    console.log(`[Stripe Webhook] Added ${points} points to user ${userId}`);
  }

  return NextResponse.json({ received: true });
}
