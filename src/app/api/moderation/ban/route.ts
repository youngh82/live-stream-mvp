import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import { cacheBan, clearBanCache } from '@/domains/moderation/services/bans';
import {
  MODERATION_EVENTS_CHANNEL,
  type ModerationEvent,
} from '@/domains/moderation/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 최대 1년. 그 이상은 영구(null)로 표현한다 */
const MAX_DURATION_SEC = 31_536_000;

/**
 * 채팅 제재.
 *
 * 타임아웃 / 기간 차단 / 영구 차단이 전부 이 하나다.
 * `durationSeconds`가 없거나 null이면 영구다.
 *
 * **채널은 방송자의 users.id다.** 스트림 단위로 묶으면 방송을 껐다 켤 때마다
 * 차단이 초기화된다.
 *
 * 순서가 중요하다: DB 커밋 → 캐시 갱신 → 이벤트 발행.
 * 반대로 하면 아직 DB에 없는 차단이 캐시에만 존재하는 순간이 생긴다.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { targetUserId, durationSeconds, reason } = await request.json();

    if (!UUID_RE.test(targetUserId ?? '')) {
      return NextResponse.json({ error: '잘못된 대상입니다' }, { status: 400 });
    }
    if (targetUserId === user.id) {
      return NextResponse.json(
        { error: '자기 자신은 제재할 수 없습니다' },
        { status: 400 },
      );
    }

    let expiresAt: Date | null = null;
    if (durationSeconds !== undefined && durationSeconds !== null) {
      if (
        typeof durationSeconds !== 'number' ||
        !Number.isInteger(durationSeconds) ||
        durationSeconds <= 0 ||
        durationSeconds > MAX_DURATION_SEC
      ) {
        return NextResponse.json(
          { error: '제재 기간이 올바르지 않습니다' },
          { status: 400 },
        );
      }
      expiresAt = new Date(Date.now() + durationSeconds * 1000);
    }

    const trimmedReason =
      typeof reason === 'string' && reason.trim()
        ? reason.trim().slice(0, 200)
        : null;

    // 방송자 본인만 자기 채널을 제재한다.
    // 채널 = 시전자 자신이므로 별도 소유권 조회가 필요 없다.
    // (모더레이터 위임이 생기면 여기서 권한을 확인하게 된다)
    const channelId = user.id;

    const { error } = await supabaseAdmin.from('channel_bans').upsert(
      {
        channel_id: channelId,
        user_id: targetUserId,
        expires_at: expiresAt?.toISOString() ?? null,
        reason: trimmedReason,
        created_by: user.id,
      },
      { onConflict: 'channel_id,user_id' },
    );

    if (error) {
      console.error('[Moderation] ban error:', error);
      return NextResponse.json({ error: '제재에 실패했습니다' }, { status: 500 });
    }

    // 해제해도 남아야 하는 기록. 분쟁에서 유일한 근거다.
    await supabaseAdmin.from('moderation_logs').insert({
      channel_id: channelId,
      target_id: targetUserId,
      actor_id: user.id,
      // 짧은 것은 타임아웃, 그 이상은 차단으로 기록한다
      action:
        durationSeconds && durationSeconds <= 3600 ? 'timeout' : 'ban',
      duration_seconds: durationSeconds ?? null,
      reason: trimmedReason,
    });

    await cacheBan(redis, channelId, targetUserId, expiresAt);

    const event: ModerationEvent = {
      type: 'ban',
      channelId,
      targetId: targetUserId,
      expiresAt: expiresAt?.toISOString() ?? null,
      reason: trimmedReason,
    };
    await redis.publish(MODERATION_EVENTS_CHANNEL, JSON.stringify(event));

    return NextResponse.json({
      data: { expires_at: expiresAt?.toISOString() ?? null },
      error: null,
    });
  } catch (err) {
    console.error('[Moderation] ban error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** 제재 해제 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const targetUserId = request.nextUrl.searchParams.get('userId') ?? '';
    if (!UUID_RE.test(targetUserId)) {
      return NextResponse.json({ error: '잘못된 대상입니다' }, { status: 400 });
    }

    const channelId = user.id;

    const { error } = await supabaseAdmin
      .from('channel_bans')
      .delete()
      .eq('channel_id', channelId)
      .eq('user_id', targetUserId);

    if (error) {
      console.error('[Moderation] unban error:', error);
      return NextResponse.json({ error: '해제에 실패했습니다' }, { status: 500 });
    }

    await supabaseAdmin.from('moderation_logs').insert({
      channel_id: channelId,
      target_id: targetUserId,
      actor_id: user.id,
      action: 'unban',
    });

    await clearBanCache(redis, channelId, targetUserId);

    const event: ModerationEvent = {
      type: 'unban',
      channelId,
      targetId: targetUserId,
    };
    await redis.publish(MODERATION_EVENTS_CHANNEL, JSON.stringify(event));

    return NextResponse.json({ data: { ok: true }, error: null });
  } catch (err) {
    console.error('[Moderation] unban error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** 내 채널의 차단 목록 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { data } = await supabaseAdmin
      .from('channel_bans')
      .select('user_id, expires_at, reason, created_at, users!channel_bans_user_id_fkey(id, nickname, avatar_url)')
      .eq('channel_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    // 만료된 것은 목록에서 뺀다. 정리 배치가 아직 안 돌았을 수 있다.
    const now = Date.now();
    const active = (data ?? []).filter(
      (b) => b.expires_at === null || new Date(b.expires_at).getTime() > now,
    );

    return NextResponse.json({ data: active, error: null });
  } catch (err) {
    console.error('[Moderation] list error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
