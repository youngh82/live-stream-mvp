import {
  MAX_BATCH,
  MAX_DWELL_MS,
  SIGNAL_KINDS,
  type FeedSignal,
} from '@/domains/feed/signals';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** feed_events에 그대로 들어가는 행 */
export interface SignalRow {
  user_id: string;
  target_type: FeedSignal['targetType'];
  target_id: string;
  kind: FeedSignal['kind'];
  dwell_ms: number | null;
  category: string | null;
}

/**
 * 클라이언트가 보낸 신호 배치를 DB에 넣을 행으로 정규화한다.
 *
 * **전부 위조 가능한 입력이라고 보고 다룬다.** 여기를 통과한 것만 feed_events에
 * 들어가고, 그 값이 곧 피드 랭킹이 된다. 상한을 넘기거나 형식이 틀린 것은
 * 거부하는 게 아니라 조용히 버린다 — 신호 수집이 사용자 경험을 막으면 안 된다.
 *
 * 라우트 핸들러에서 분리해 둔 이유는 순수 함수라야 테스트가 되기 때문이다.
 * 인증·rate limit·DB 쓰기는 라우트에 남는다.
 */
export function normalizeSignalEvents(
  userId: string,
  events: unknown,
): SignalRow[] {
  if (!Array.isArray(events)) return [];

  return events
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
      user_id: userId,
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
}
