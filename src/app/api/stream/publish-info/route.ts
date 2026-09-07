import { NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { whipUrlFor } from '@/shared/lib/media-url';

/**
 * 모바일 웹 방송에 필요한 송출 정보.
 *
 * stream_key는 방송자 본인에게만 내려간다. WHIP은 이 값을 HTTP Basic
 * 비밀번호로 보내고, /api/stream/auth 가 검증한다.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { data: stream } = await supabaseAdmin
      .from('streams')
      .select('id, stream_key, title, status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!stream) {
      return NextResponse.json(
        { error: '방송자 등록이 필요합니다' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      data: {
        streamId: stream.id,
        streamKey: stream.stream_key,
        whipUrl: whipUrlFor(stream.id),
        title: stream.title,
        status: stream.status,
      },
      error: null,
    });
  } catch (err) {
    console.error('[Stream] publish-info error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
