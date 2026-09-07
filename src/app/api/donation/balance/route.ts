import { NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('point_balance')
      .eq('id', user.id)
      .single();

    return NextResponse.json({ balance: profile?.point_balance ?? 0 });
  } catch (error) {
    console.error('[Balance] Error:', error);
    return NextResponse.json(
      { error: '잔액 조회에 실패했습니다' },
      { status: 500 },
    );
  }
}
