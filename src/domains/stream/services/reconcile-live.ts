/**
 * 라이브 목록 재조정.
 *
 * **문제**: 피드가 읽는 라이브 목록(`live:streams`)이 Redis에만 있다.
 * Redis를 재시작하면 방송 중인 스트림이 피드에서 **전부 사라지고**,
 * 다시 나타날 방법이 없다 — 목록에 다시 넣어주는 것은 `on-publish`
 * 웹훅뿐인데, 그건 방송이 *시작될 때* 한 번만 온다. 이미 송출 중인
 * 사람은 아무 이벤트도 만들지 않으므로 방송을 껐다 켜야만 복구된다.
 *
 * **기준**: MediaMTX가 유일한 진실이다. Redis와 Postgres는 둘 다 웹훅을
 * 받아 적은 사본이고, 웹훅은 유실될 수 있다. 그래서 "지금 실제로 송출
 * 중인 경로"를 물어보고 나머지 둘을 거기에 맞춘다.
 * (`on-publish`/`on-unpublish`가 위조 웹훅을 막을 때 이미 쓰는 방식과 같다)
 *
 * **정렬 키를 보존한다**: `live:streams`의 score는 피드 커서다. 재조정하면서
 * 지금 시각을 새로 넣으면 방송 중인 사람들의 피드 순서가 통째로 뒤바뀌고,
 * 스크롤 중이던 시청자는 항목을 건너뛰거나 두 번 보게 된다. Postgres에
 * 남아 있는 `started_at`을 그대로 쓰고, 그게 없을 때만 MediaMTX의
 * readyTime으로 대신한다.
 *
 * **주기적으로 돈다** (instrumentation.ts, 60초 — U-17). 미디어 서버가
 * 재시작되면 on-unpublish가 유실되어 끝난 방송이 피드에 남는다. 주기
 * 실행이라 on-publish/on-unpublish와 겹칠 수 있다 — 실행부의 순서 주석 참고.
 */

import { redis } from '@/shared/lib/redis';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { listPublishingPaths } from '@/shared/lib/media-server';

/** MediaMTX가 보고한, 지금 송출 중인 경로 */
export interface PublishingPath {
  name: string;
  readyTime: string | null;
}

/** Postgres가 라이브라고 알고 있는 행 */
export interface DbLiveStream {
  id: string;
  started_at: string | null;
}

export interface ReconcilePlan {
  /** `live:streams`에 있어야 할 항목 (score = 정렬 키). 이미 있으면 score를 건드리지 않는다 */
  live: Array<{ id: string; score: number }>;
  /** `live:streams`에서 빼야 할 것 — 스냅샷에 있었는데 송출 중이 아닌 것 */
  toRemove: string[];
  /** 송출이 끝났는데 DB가 아직 live로 알고 있는 것 */
  toEnd: string[];
  /** 송출 중인데 DB가 모르고 있는 것 (웹훅 유실) */
  toMarkLive: string[];
}

/**
 * 무엇을 바꿔야 하는지 계산한다. 여기서는 아무것도 쓰지 않는다 —
 * 순수 함수라야 테스트할 수 있고, 이 판단이 틀리면 방송이 사라진다.
 *
 * @param publishing MediaMTX가 보고한 송출 중 경로
 * @param dbLive     Postgres가 live로 알고 있는 스트림
 * @param now        재조정 시각 (fallback score)
 * @param inRedis    `live:streams`에 들어 있던 id (스냅샷)
 */
export function planReconciliation(
  publishing: PublishingPath[],
  dbLive: DbLiveStream[],
  now: number,
  inRedis: string[] = [],
): ReconcilePlan {
  const startedById = new Map<string, number>();
  for (const row of dbLive) {
    const t = row.started_at ? Date.parse(row.started_at) : NaN;
    if (Number.isFinite(t)) startedById.set(row.id, t);
  }

  const publishingIds = new Set<string>();
  const live: ReconcilePlan['live'] = [];
  const toMarkLive: string[] = [];

  for (const path of publishing) {
    // 같은 경로가 두 번 보고돼도 한 번만 넣는다
    if (publishingIds.has(path.name)) continue;
    publishingIds.add(path.name);

    // 1순위: DB에 남은 원래 시작 시각 — 피드 커서가 흔들리지 않는다
    let score = startedById.get(path.name);

    // 2순위: MediaMTX가 이 경로를 ready로 본 시각
    if (score === undefined && path.readyTime) {
      const t = Date.parse(path.readyTime);
      if (Number.isFinite(t)) score = t;
    }

    // 3순위: 지금. 둘 다 없을 때만이고, 순서가 흔들려도 목록에서
    // 사라지는 것보다는 낫다.
    live.push({ id: path.name, score: score ?? now });

    if (!startedById.has(path.name)) toMarkLive.push(path.name);
  }

  // DB는 live라는데 실제로는 송출이 끝난 것 — on-unpublish 유실
  const toEnd = dbLive
    .map((r) => r.id)
    .filter((id) => !publishingIds.has(id));

  // 스냅샷에 있던 것만 뺀다. 스냅샷 뒤에 on-publish가 넣은 방송은 여기에
  // 없으므로 지워지지 않는다.
  const toRemove = [...new Set(inRedis)].filter((id) => !publishingIds.has(id));

  return { live, toRemove, toEnd, toMarkLive };
}

/* ── 실행부 ─────────────────────────────────────────────────
 * 위 planReconciliation이 무엇을 바꿀지 정하고, 아래가 실제로 쓴다.
 */


const LIVE_KEY = 'live:streams';

/** 여러 앱 인스턴스가 동시에 재조정하지 않도록 하는 잠금 */
const LOCK_KEY = 'lock:reconcile-live';
const LOCK_TTL_SEC = 30;

export interface ReconcileResult {
  skipped?: 'locked';
  live: number;
  ended: number;
  markedLive: number;
}

/**
 * 재조정을 실제로 수행한다.
 *
 * **MediaMTX 조회가 실패하면 아무것도 하지 않는다.** 빈 목록을 진실로 믿고
 * 덮어쓰면 방송 중인 사람을 전부 지워버린다 — 고치려던 문제를 스스로
 * 만들어내는 셈이다. 실패는 던져서 호출부가 알게 한다.
 */
export async function reconcileLiveStreams(): Promise<ReconcileResult> {
  // 앱 인스턴스가 여럿이면 기동 시 동시에 들어온다. 한 번만 돌면 된다.
  const acquired = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SEC, 'NX');
  if (acquired !== 'OK') return { skipped: 'locked', live: 0, ended: 0, markedLive: 0 };

  try {
    // **순서가 중요하다: DB·Redis 스냅샷 → MediaMTX.** 주기적으로 돌면
    // on-publish와 겹친다. on-publish는 MediaMTX에서 송출을 확인한 *뒤에*
    // DB와 Redis를 쓰므로, 스냅샷에 live로 잡힌 방송은 그 뒤의 MediaMTX
    // 조회에도 반드시 잡힌다. 거꾸로 하면 막 시작한 방송이 "DB엔 live인데
    // 송출 목록엔 없음"으로 보여 ended가 된다.
    const { data: dbLive, error: dbError } = await supabaseAdmin
      .from('streams')
      .select('id, started_at')
      .eq('status', 'live');
    // DB를 못 읽었는데 빈 목록으로 믿으면 송출 중인 방송을 전부 toMarkLive로 본다
    if (dbError) throw new Error(`streams 조회 실패: ${dbError.message}`);

    const inRedis = await redis.zrevrange(LIVE_KEY, 0, -1);

    // 진실. 실패하면 여기서 던진다 — 빈 목록으로 덮어쓰지 않는다.
    const publishing = await listPublishingPaths();

    const plan = planReconciliation(publishing, dbLive ?? [], Date.now(), inRedis);

    // 통째로 갈아끼우지 않는다(DEL 금지) — 그 사이 on-publish가 넣은 방송이
    // 지워진다. NX: 이미 있는 항목은 score(피드 커서)를 건드리지 않는다.
    const tx = redis.multi();
    for (const item of plan.live) tx.zadd(LIVE_KEY, 'NX', String(item.score), item.id);
    if (plan.toRemove.length) tx.zrem(LIVE_KEY, ...plan.toRemove);
    await tx.exec();

    if (plan.toEnd.length) {
      await supabaseAdmin
        .from('streams')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .in('id', plan.toEnd);
      // 유령 스트림의 시청자 수도 남아 있을 이유가 없다
      await Promise.all(
        plan.toEnd.map((id) => redis.del(`stream:viewers:${id}`)),
      );
    }

    if (plan.toMarkLive.length) {
      await supabaseAdmin
        .from('streams')
        .update({ status: 'live', ended_at: null })
        .in('id', plan.toMarkLive);
    }

    // 1분마다 돈다 — 바뀐 게 있을 때만 남긴다
    if (plan.toEnd.length || plan.toMarkLive.length || plan.toRemove.length) {
      console.log(
        `[Reconcile] live=${plan.live.length} ended=${plan.toEnd.length} markedLive=${plan.toMarkLive.length} removed=${plan.toRemove.length}`,
        plan.toEnd.length ? `ended ids: ${plan.toEnd.join(',')}` : '',
      );
    }

    return {
      live: plan.live.length,
      ended: plan.toEnd.length,
      markedLive: plan.toMarkLive.length,
    };
  } finally {
    await redis.del(LOCK_KEY);
  }
}
