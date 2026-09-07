import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import { isPublishing } from '@/shared/lib/media-server';
import {
  LIVE_EVENTS_CHANNEL,
  type LiveStartedEvent,
} from '@/domains/user/events';

// MediaMTX가 송출 시작 시 호출한다. path = streams.id
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const streamId = (body.path || '').replace(/^\//, '');

    if (!streamId) {
      return NextResponse.json({ error: 'Missing path' }, { status: 400 });
    }

    // H-03: 위조 웹훅 차단 - 미디어 서버에 실제 송출 여부를 되묻는다
    if (!(await isPublishing(streamId))) {
      console.warn('[Stream] on-publish 거부: 실제 송출 중이 아님', streamId);
      return NextResponse.json({ error: 'Not publishing' }, { status: 403 });
    }

    const { data: stream, error } = await supabaseAdmin
      .from('streams')
      .select('id, user_id, title, users!inner(nickname, avatar_url)')
      .eq('id', streamId)
      .single();

    if (error || !stream) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
    }

    const startedAt = Date.now();

    await supabaseAdmin
      .from('streams')
      .update({
        status: 'live',
        started_at: new Date(startedAt).toISOString(),
        ended_at: null,
        viewer_count: 0,
      })
      .eq('id', stream.id);

    // 피드 커서로 쓰이는 정렬 키. 라이브 중에는 절대 변하지 않는다.
    await redis.zadd('live:streams', startedAt, stream.id);
    await redis.del(`stream:viewers:${stream.id}`);

    // 팔로워 알림. 여기서는 발행만 하고 실제 발송(팔로워 순회)은
    // 채팅 서버가 맡는다 — 이유는 LIVE_EVENTS_CHANNEL 주석 참고.
    const streamer = stream.users as unknown as {
      nickname: string;
      avatar_url: string | null;
    };
    const event: LiveStartedEvent = {
      streamId: stream.id,
      streamerId: stream.user_id,
      nickname: streamer.nickname,
      avatarUrl: streamer.avatar_url,
      title: stream.title,
    };

    // 알림 발행이 실패해도 방송은 시작되어야 한다
    try {
      await redis.publish(LIVE_EVENTS_CHANNEL, JSON.stringify(event));
    } catch (err) {
      console.error('[Stream] 라이브 알림 발행 실패:', err);
    }

    console.log(`[Stream] Started: ${stream.id}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Stream] on-publish error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
