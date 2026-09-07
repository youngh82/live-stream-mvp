import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import {
  categoryOfStreamer,
  recordSignal,
} from '@/domains/feed/services/record-signal';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 팔로우 / 언팔로우.
 *
 * **RLS가 실제 방어선이다.** 여기서는 사용자 세션 클라이언트로 쓰기 때문에
 * `follower_id = auth.uid()` 정책이 서버 코드와 무관하게 위조를 막는다.
 * admin 클라이언트로 바꾸면 그 방어선이 사라진다 — 바꾸지 말 것.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const { supabase, user } = await requireUser();

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  }
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: '잘못된 대상입니다' }, { status: 400 });
  }
  if (userId === user.id) {
    return NextResponse.json(
      { error: '자기 자신은 팔로우할 수 없습니다' },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: user.id, following_id: userId });

  // 23505 = unique_violation. 연타나 중복 요청이며 결과적으로 이미 팔로우
  // 상태이므로 성공으로 취급한다(멱등). 에러로 돌리면 UI가 되돌아간다.
  if (error && error.code !== '23505') {
    // 23503 = foreign_key_violation → 없는 유저
    if (error.code === '23503') {
      return NextResponse.json(
        { error: '존재하지 않는 사용자입니다' },
        { status: 404 },
      );
    }
    console.error('[Follow] insert error:', error);
    return NextResponse.json({ error: '팔로우에 실패했습니다' }, { status: 500 });
  }

  // 팔로우는 가장 강한 취향 신호다. 서버에서만 기록한다.
  await recordSignal({
    userId: user.id,
    targetType: 'stream',
    targetId: userId,
    kind: 'follow',
    category: await categoryOfStreamer(userId),
  });

  return NextResponse.json({ data: { following: true }, error: null });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const { supabase, user } = await requireUser();

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  }
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: '잘못된 대상입니다' }, { status: 400 });
  }

  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', user.id)
    .eq('following_id', userId);

  if (error) {
    console.error('[Follow] delete error:', error);
    return NextResponse.json(
      { error: '팔로우 해제에 실패했습니다' },
      { status: 500 },
    );
  }

  // 이미 안 하고 있었어도 성공이다 (멱등)
  return NextResponse.json({ data: { following: false }, error: null });
}

/** 내가 이 사람을 팔로우 중인지 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const { supabase, user } = await requireUser();

  if (!user) {
    // 비로그인은 에러가 아니다. 팔로우 버튼이 "안 함" 상태로 보이면 된다.
    return NextResponse.json({ data: { following: false }, error: null });
  }

  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', user.id)
    .eq('following_id', userId)
    .maybeSingle();

  return NextResponse.json({ data: { following: Boolean(data) }, error: null });
}
