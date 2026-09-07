import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'sent'; // 'sent' | 'received'
    const cursor = searchParams.get('cursor');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);

    let query = supabaseAdmin
      .from('donations')
      .select(
        `
        id, stream_id, amount, message, created_at,
        sender:users!donations_sender_id_fkey(nickname, avatar_url),
        receiver:users!donations_receiver_id_fkey(nickname, avatar_url)
      `,
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (type === 'sent') {
      query = query.eq('sender_id', user.id);
    } else {
      query = query.eq('receiver_id', user.id);
    }

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Donation History] Error:', error);
      return NextResponse.json(
        { error: '후원 내역을 불러올 수 없습니다' },
        { status: 500 },
      );
    }

    const nextCursor =
      data && data.length === limit
        ? data[data.length - 1].created_at
        : null;

    return NextResponse.json({ donations: data, nextCursor });
  } catch (error) {
    console.error('[Donation History] Error:', error);
    return NextResponse.json(
      { error: '후원 내역을 불러올 수 없습니다' },
      { status: 500 },
    );
  }
}
