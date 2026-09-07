import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';

/**
 * 공개 프로필.
 *
 * 팔로우 버튼·검색 결과·채팅 닉네임이 전부 여기로 향한다.
 * 로그인 여부와 무관하게 열리며, 로그인했을 때만 `is_following`이 채워진다.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const { data: profile, error } = await supabaseAdmin
      .from('users')
      .select(
        'id, nickname, avatar_url, bio, role, follower_count, following_count, created_at',
      )
      .eq('id', id)
      .single();

    if (error || !profile) {
      return NextResponse.json(
        { error: '사용자를 찾을 수 없습니다' },
        { status: 404 },
      );
    }

    // 라이브 중이면 바로 들어갈 수 있어야 한다. 프로필의 핵심 동선이다.
    const { data: liveStream } = await supabaseAdmin
      .from('streams')
      .select('id, title, viewer_count, thumbnail_url, started_at')
      .eq('user_id', id)
      .eq('status', 'live')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: recentStreams } = await supabaseAdmin
      .from('streams')
      .select('id, title, category, thumbnail_url, started_at, ended_at')
      .eq('user_id', id)
      .eq('status', 'ended')
      .order('ended_at', { ascending: false })
      .limit(12);

    // 세션 클라이언트로 별도 조회한다. admin으로 보면 RLS를 우회해버려서
    // "누구 기준의 팔로우인지"가 흐려진다.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let isFollowing = false;
    if (user && user.id !== id) {
      const { data: follow } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('follower_id', user.id)
        .eq('following_id', id)
        .maybeSingle();
      isFollowing = Boolean(follow);
    }

    return NextResponse.json({
      data: {
        ...profile,
        is_following: isFollowing,
        is_me: user?.id === id,
        live_stream: liveStream ?? null,
        recent_streams: recentStreams ?? [],
      },
      error: null,
    });
  } catch (err) {
    console.error('[User] get error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
