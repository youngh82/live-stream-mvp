import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import {
  MAX_BATCH,
  MAX_DWELL_MS,
  SIGNAL_KINDS,
  type FeedSignal,
} from '@/domains/feed/signals';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 10초에 배치 5회. 정상 사용은 훨씬 적게 보낸다 */
const RATE_WINDOW_SEC = 10;
const RATE_LIMIT = 5;

/**
 * 취향 신호 수집.
 *
 * 랭킹(Phase 13)의 재료다. 지금은 쌓기만 한다.
 *
 * **왜 클라이언트가 DB에 직접 쓰지 않는가**: feed_events는 anon/authenticated에게
 * 완전히 닫혀 있다(009). 직접 쓸 수 있으면 자기 취향 점수를 마음대로 만들 수 있고
 * 그건 곧 피드 노출 조작이다. 여기서 검증한 것만 들어간다.
 *
 * 실패해도 조용히 넘어간다 — 신호 수집이 사용자 경험을 막으면 안 된다.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 비로그인은 신호를 남기지 않는다. 귀속시킬 유저가 없다.
    if (!user) return NextResponse.json({ ok: true });

    // Redis INCR 기반. 채팅 rate limit과 같은 방식이라
    // 서버를 늘려도 한도가 공유된다.
    const key = `ratelimit:signals:${user.id}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_WINDOW_SEC);
    if (count > RATE_LIMIT) {
      return NextResponse.json({ ok: true, dropped: true });
    }

    const body = await request.json();
    const events: unknown = body?.events;
    if (!Array.isArray(events)) {
      return NextResponse.json({ error: '잘못된 형식입니다' }, { status: 400 });
    }

    const rows = events
      .slice(0, MAX_BATCH)
      .filter((e): e is FeedSignal => {
        if (!e || typeof e !== 'object') return false;
        const ev = e as FeedSignal;
        return (
          (ev.targetType === 'stream' || ev.targetType === 'post') &&
          typeof ev.targetId === 'string' &&
          UUID_RE.test(ev.targetId) &&
          SIGNAL_KINDS.includes(ev.kind)
        );
      })
      .map((e) => ({
        user_id: user.id,
        target_type: e.targetType,
        target_id: e.targetId,
        kind: e.kind,
        // 위조 방지 상한. DB에도 CHECK가 있어 이중으로 막힌다.
        dwell_ms:
          typeof e.dwellMs === 'number' && Number.isFinite(e.dwellMs)
            ? Math.min(Math.max(Math.trunc(e.dwellMs), 0), MAX_DWELL_MS)
            : null,
        category: typeof e.category === 'string' ? e.category : null,
      }));

    if (rows.length === 0) return NextResponse.json({ ok: true });

    const { error } = await supabaseAdmin.from('feed_events').insert(rows);
    if (error) {
      console.error('[Signals] insert error:', error.message);
      // 사용자에게는 실패를 알리지 않는다. 화면이 할 수 있는 일이 없다.
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, accepted: rows.length });
  } catch (err) {
    console.error('[Signals] error:', err);
    return NextResponse.json({ ok: true });
  }
}
