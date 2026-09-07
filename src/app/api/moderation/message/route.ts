import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import {
  MODERATION_EVENTS_CHANNEL,
  type ModerationEvent,
} from '@/domains/moderation/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 채팅 메시지 삭제.
 *
 * 채팅은 DB에 저장되지 않으므로(아카이빙은 백로그) 삭제는 "모두의 화면에서
 * 지운다"는 뜻이다. 채팅 서버가 방에 `chat:delete`를 뿌리면 각 클라이언트가
 * 해당 id를 제거한다.
 *
 * 그래서 나중에 접속한 사람에게는 애초에 보이지 않는다 — 지금 구조에서는
 * 이게 맞는 동작이다.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { streamId, messageId, targetUserId } = await request.json();

    if (!UUID_RE.test(streamId ?? '') || !UUID_RE.test(messageId ?? '')) {
      return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 });
    }

    // 방송 소유자만 지울 수 있다. 여기를 빼면 아무나 남의 방 채팅을 지운다.
    const { data: stream } = await supabaseAdmin
      .from('streams')
      .select('user_id')
      .eq('id', streamId)
      .single();

    if (!stream || stream.user_id !== user.id) {
      return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
    }

    if (UUID_RE.test(targetUserId ?? '')) {
      await supabaseAdmin.from('moderation_logs').insert({
        channel_id: user.id,
        target_id: targetUserId,
        actor_id: user.id,
        action: 'delete_message',
      });
    }

    const event: ModerationEvent = {
      type: 'delete_message',
      channelId: user.id,
      streamId,
      messageId,
    };
    await redis.publish(MODERATION_EVENTS_CHANNEL, JSON.stringify(event));

    return NextResponse.json({ data: { ok: true }, error: null });
  } catch (err) {
    console.error('[Moderation] delete message error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
