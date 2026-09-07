import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/shared/lib/stripe';
import { createClient } from '@/shared/lib/supabase-server';
import { POINT_PACKAGES } from '@/domains/donation/types';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { packageIndex } = await request.json();
    const pkg = POINT_PACKAGES[packageIndex];
    if (!pkg) {
      return NextResponse.json(
        { error: '유효하지 않은 패키지입니다' },
        { status: 400 },
      );
    }

    const origin = request.headers.get('origin') || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'krw',
            product_data: {
              name: `포인트 충전 ${pkg.label}`,
              description: `${pkg.points.toLocaleString()} 포인트 충전`,
            },
            unit_amount: pkg.price,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      metadata: {
        user_id: user.id,
        points: pkg.points.toString(),
      },
      success_url: `${origin}/charge/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/charge?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('[Checkout] Error:', error);
    return NextResponse.json(
      { error: '결제 세션 생성에 실패했습니다' },
      { status: 500 },
    );
  }
}
