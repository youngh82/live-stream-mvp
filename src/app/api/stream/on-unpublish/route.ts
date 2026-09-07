import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import { isStopped } from '@/shared/lib/media-server';

// MediaMTX가 송출 종료 시 호출한다. path = streams.id
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const streamId = (body.path || '').replace(/^\//, '');

    if (!streamId) {
      return NextResponse.json({ error: 'Missing path' }, { status: 400 });
    }

    // H-03: 위조 웹훅 차단 - 아직 송출 중이면 종료 요청을 무시한다.
    // 이 검사가 없으면 남의 방송을 임의로 끝낼 수 있었다.
    if (!(await isStopped(streamId))) {
      console.warn('[Stream] on-unpublish 거부: 아직 송출 중', streamId);
      return NextResponse.json({ error: 'Still publishing' }, { status: 403 });
    }

    const { data: stream, error } = await supabaseAdmin
      .from('streams')
      .select('id')
      .eq('id', streamId)
      .eq('status', 'live')
      .single();

    if (error || !stream) {
      // 이미 종료된 방송일 수 있다
      return NextResponse.json({ ok: true });
    }

    await supabaseAdmin
      .from('streams')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
      })
      .eq('id', stream.id);

    await redis.zrem('live:streams', stream.id);
    await redis.del(`stream:viewers:${stream.id}`);

    console.log(`[Stream] Ended: ${stream.id}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Stream] on-unpublish error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
