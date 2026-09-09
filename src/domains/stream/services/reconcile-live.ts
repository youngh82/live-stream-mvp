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
  /** `live:streams`에 새로 써야 할 항목 (score = 정렬 키) */
  live: Array<{ id: string; score: number }>;
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
 */
export function planReconciliation(
  publishing: PublishingPath[],
  dbLive: DbLiveStream[],
  now: number,
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

  return { live, toEnd, toMarkLive };
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
    // 진실. 실패하면 여기서 던진다 — 빈 목록으로 덮어쓰지 않는다.
    const publishing = await listPublishingPaths();

    const { data: dbLive } = await supabaseAdmin
      .from('streams')
      .select('id, started_at')
      .eq('status', 'live');

    const plan = planReconciliation(publishing, dbLive ?? [], Date.now());

    // 목록을 통째로 갈아끼운다. 지웠다 넣는 사이에 피드가 빈 목록을 읽으면
    // 안 되므로 한 트랜잭션(MULTI)으로 묶는다.
    const tx = redis.multi();
    tx.del(LIVE_KEY);
    for (const item of plan.live) tx.zadd(LIVE_KEY, item.score, item.id);
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

    console.log(
      `[Reconcile] live=${plan.live.length} ended=${plan.toEnd.length} markedLive=${plan.toMarkLive.length}`,
    );

    return {
      live: plan.live.length,
      ended: plan.toEnd.length,
      markedLive: plan.toMarkLive.length,
    };
  } finally {
    await redis.del(LOCK_KEY);
  }
}
