import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const cursor = request.nextUrl.searchParams.get('cursor');

    let query = supabaseAdmin
      .from('payouts')
      .select(
        'id, ref_payout_id, gross_amount, fee_amount, withholding_amount, net_amount, fee_rate, status, schedule_type, payout_date, error_message, requested_at, completed_at',
      )
      .eq('user_id', user.id)
      .order('requested_at', { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (cursor) query = query.lt('requested_at', cursor);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const hasMore = rows.length > PAGE_SIZE;
    const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    return NextResponse.json({
      items,
      nextCursor: hasMore ? items[items.length - 1]?.requested_at : null,
    });
  } catch (error) {
    console.error('[Payout/history] Error:', error);
    return NextResponse.json(
      { error: '환전 내역 조회에 실패했습니다' },
      { status: 500 },
    );
  }
}
