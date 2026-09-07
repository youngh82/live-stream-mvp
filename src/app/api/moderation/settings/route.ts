import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import {
  MAX_BANNED_WORDS,
  MAX_BANNED_WORD_LENGTH,
  MODERATION_EVENTS_CHANNEL,
  type ModerationEvent,
} from '@/domains/moderation/types';

const MAX_SLOW_MODE_SEC = 300;

/** 내 채널 채팅 설정 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
  }

  const { data } = await supabaseAdmin
    .from('channel_settings')
    .select('slow_mode_sec, followers_only, banned_words')
    .eq('channel_id', user.id)
    .maybeSingle();

  // 행이 없으면 기본값이다. 가입할 때 미리 만들지 않는다 — 대부분 안 쓴다.
  return NextResponse.json({
    data: data ?? { slow_mode_sec: 0, followers_only: false, banned_words: [] },
    error: null,
  });
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const { slowModeSec, followersOnly, bannedWords } = await request.json();
    const updates: Record<string, unknown> = { channel_id: user.id };

    if (slowModeSec !== undefined) {
      if (
        typeof slowModeSec !== 'number' ||
        !Number.isInteger(slowModeSec) ||
        slowModeSec < 0 ||
        slowModeSec > MAX_SLOW_MODE_SEC
      ) {
        return NextResponse.json(
          { error: `슬로우 모드는 0~${MAX_SLOW_MODE_SEC}초여야 합니다` },
          { status: 400 },
        );
      }
      updates.slow_mode_sec = slowModeSec;
    }

    if (followersOnly !== undefined) {
      updates.followers_only = Boolean(followersOnly);
    }

    if (bannedWords !== undefined) {
      if (!Array.isArray(bannedWords)) {
        return NextResponse.json(
          { error: '금칙어 형식이 올바르지 않습니다' },
          { status: 400 },
        );
      }
      updates.banned_words = [
        ...new Set(
          bannedWords
            .map((w) => String(w).trim().toLowerCase())
            .filter((w) => w.length > 0 && w.length <= MAX_BANNED_WORD_LENGTH),
        ),
      ].slice(0, MAX_BANNED_WORDS);
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('channel_settings')
      .upsert(updates, { onConflict: 'channel_id' })
      .select('slow_mode_sec, followers_only, banned_words')
      .single();

    if (error) {
      console.error('[Moderation] settings error:', error);
      return NextResponse.json({ error: '저장에 실패했습니다' }, { status: 500 });
    }

    // 채팅 서버가 설정을 캐싱하므로 바뀐 것을 알려야 한다
    const event: ModerationEvent = { type: 'settings', channelId: user.id };
    await redis.publish(MODERATION_EVENTS_CHANNEL, JSON.stringify(event));

    return NextResponse.json({ data, error: null });
  } catch (err) {
    console.error('[Moderation] settings error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
