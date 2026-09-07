import { NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { HOLD_DAYS } from '@/domains/payout/services/fees';

/** 수익 잔액 + 환전 가능/보류/진행중 금액 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const [profileRes, availableRes, pendingRes] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('revenue_balance')
        .eq('id', user.id)
        .single(),
      supabaseAdmin.rpc('available_revenue', {
        p_user_id: user.id,
        p_hold_days: HOLD_DAYS,
      }),
      supabaseAdmin
        .from('payouts')
        .select('gross_amount')
        .eq('user_id', user.id)
        .in('status', ['REQUESTED', 'IN_PROGRESS']),
    ]);

    const revenue = profileRes.data?.revenue_balance ?? 0;
    const available = availableRes.data ?? 0;
    const pending = (pendingRes.data ?? []).reduce(
      (sum, p) => sum + (p.gross_amount ?? 0),
      0,
    );

    return NextResponse.json({
      revenue,
      available,
      // 홀드 중인 금액. 환전 요청으로 이미 빠진 건 revenue에 없다.
      held: Math.max(revenue - available, 0),
      pending,
      holdDays: HOLD_DAYS,
    });
  } catch (error) {
    console.error('[Payout/balance] Error:', error);
    return NextResponse.json(
      { error: '잔액 조회에 실패했습니다' },
      { status: 500 },
    );
  }
}
