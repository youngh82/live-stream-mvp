import { describe, expect, it } from "vitest";
import {
  planReconciliation,
  type DbLiveStream,
  type PublishingPath,
} from "./reconcile-live";

/**
 * 이 판단이 틀리면 **방송 중인 사람이 피드에서 사라진다.** 그래서 순수 함수로
 * 떼어냈다.
 *
 * 지키는 것:
 *  1. MediaMTX가 기준이다 — Redis/Postgres가 뭐라고 하든 실제 송출이 진실
 *  2. 정렬 키(피드 커서)를 보존한다 — 재조정이 피드 순서를 뒤집으면 안 된다
 *  3. 양방향으로 맞춘다 — 유실된 on-publish도, 유실된 on-unpublish도
 */

const NOW = Date.parse("2026-09-09T12:00:00Z");
const T1 = Date.parse("2026-09-09T11:00:00Z");
const T2 = Date.parse("2026-09-09T11:30:00Z");

const path = (name: string, readyTime: string | null = null): PublishingPath => ({
  name,
  readyTime,
});
const dbRow = (id: string, started_at: string | null): DbLiveStream => ({
  id,
  started_at,
});

describe("Redis가 비었을 때 (핵심 시나리오)", () => {
  it("송출 중인 것을 전부 되살린다", () => {
    const plan = planReconciliation(
      [path("a"), path("b"), path("c")],
      [
        dbRow("a", new Date(T1).toISOString()),
        dbRow("b", new Date(T2).toISOString()),
        dbRow("c", new Date(T1).toISOString()),
      ],
      NOW,
    );
    expect(plan.live.map((l) => l.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("원래 시작 시각을 정렬 키로 쓴다 — 피드 순서가 유지된다", () => {
    // 여기서 now를 넣으면 방송 중인 사람들의 순서가 통째로 뒤바뀐다
    const plan = planReconciliation(
      [path("a"), path("b")],
      [
        dbRow("a", new Date(T1).toISOString()),
        dbRow("b", new Date(T2).toISOString()),
      ],
      NOW,
    );
    expect(plan.live).toEqual([
      { id: "a", score: T1 },
      { id: "b", score: T2 },
    ]);
    expect(plan.live.every((l) => l.score !== NOW)).toBe(true);
  });
});

describe("정렬 키 우선순위", () => {
  it("DB에 시작 시각이 없으면 MediaMTX의 readyTime을 쓴다", () => {
    const plan = planReconciliation(
      [path("a", new Date(T2).toISOString())],
      [],
      NOW,
    );
    expect(plan.live).toEqual([{ id: "a", score: T2 }]);
  });

  it("DB 시작 시각이 readyTime보다 우선한다", () => {
    const plan = planReconciliation(
      [path("a", new Date(T2).toISOString())],
      [dbRow("a", new Date(T1).toISOString())],
      NOW,
    );
    expect(plan.live[0].score).toBe(T1);
  });

  it("둘 다 없거나 깨졌으면 now로 넣는다 — 목록에서 빠뜨리지 않는다", () => {
    for (const bad of [null, "", "쓰레기값", "not-a-date"]) {
      const plan = planReconciliation(
        [path("a", bad)],
        [dbRow("a", bad)],
        NOW,
      );
      expect(plan.live, `${String(bad)}에서 누락됐다`).toEqual([
        { id: "a", score: NOW },
      ]);
    }
  });
});

describe("양방향 드리프트 보정", () => {
  it("송출 중인데 DB가 모르면 live로 표시한다 (on-publish 유실)", () => {
    const plan = planReconciliation([path("a"), path("b")], [dbRow("a", null)], NOW);
    // a는 started_at이 null이라 '원래 시각을 모르는' 상태 → 둘 다 표시 대상
    expect(plan.toMarkLive.sort()).toEqual(["a", "b"]);
  });

  it("DB는 live인데 송출이 끝났으면 종료 대상이다 (on-unpublish 유실)", () => {
    const plan = planReconciliation(
      [path("a")],
      [dbRow("a", new Date(T1).toISOString()), dbRow("ghost", new Date(T1).toISOString())],
      NOW,
    );
    expect(plan.toEnd).toEqual(["ghost"]);
    expect(plan.live.map((l) => l.id)).toEqual(["a"]);
  });

  it("송출 중인 것은 절대 종료 대상에 넣지 않는다", () => {
    const plan = planReconciliation(
      [path("a"), path("b")],
      [dbRow("a", new Date(T1).toISOString()), dbRow("b", new Date(T2).toISOString())],
      NOW,
    );
    expect(plan.toEnd).toEqual([]);
  });
});

describe("Redis 목록 (주기 실행 — U-17)", () => {
  it("송출이 끝난 유령을 목록에서 뺀다", () => {
    const plan = planReconciliation(
      [path("a")],
      [dbRow("a", new Date(T1).toISOString()), dbRow("ghost", new Date(T1).toISOString())],
      NOW,
      ["a", "ghost"],
    );
    expect(plan.toRemove).toEqual(["ghost"]);
    expect(plan.toEnd).toEqual(["ghost"]);
  });

  it("DB는 이미 ended인데 Redis에만 남은 것도 뺀다", () => {
    const plan = planReconciliation([], [], NOW, ["stale"]);
    expect(plan.toRemove).toEqual(["stale"]);
    expect(plan.toEnd).toEqual([]);
  });

  it("송출 중인 것은 절대 빼지 않는다", () => {
    const plan = planReconciliation(
      [path("a"), path("b")],
      [dbRow("a", new Date(T1).toISOString())],
      NOW,
      ["a", "b"],
    );
    expect(plan.toRemove).toEqual([]);
  });

  it("스냅샷 뒤에 시작한 방송은 건드리지 않는다 (on-publish와 겹칠 때)", () => {
    // 실행부는 DB·Redis 스냅샷 → MediaMTX 순서로 읽는다. 스냅샷 뒤에 시작한
    // 방송은 스냅샷에 없으므로 ended도, 목록 제거도 되지 않고 live로만 잡힌다.
    const plan = planReconciliation([path("new")], [], NOW, []);
    expect(plan.toEnd).toEqual([]);
    expect(plan.toRemove).toEqual([]);
    expect(plan.live.map((l) => l.id)).toEqual(["new"]);
  });
});

describe("경계", () => {
  it("아무도 방송 중이 아니면 목록을 비우고 DB의 유령을 정리한다", () => {
    const plan = planReconciliation([], [dbRow("ghost", new Date(T1).toISOString())], NOW);
    expect(plan.live).toEqual([]);
    expect(plan.toEnd).toEqual(["ghost"]);
  });

  it("전부 비어 있으면 아무 일도 하지 않는다", () => {
    expect(planReconciliation([], [], NOW)).toEqual({
      live: [],
      toRemove: [],
      toEnd: [],
      toMarkLive: [],
    });
  });

  it("같은 경로가 중복 보고돼도 한 번만 넣는다", () => {
    const plan = planReconciliation(
      [path("a"), path("a")],
      [dbRow("a", new Date(T1).toISOString())],
      NOW,
    );
    expect(plan.live).toEqual([{ id: "a", score: T1 }]);
  });

  it("MediaMTX가 목록을 주면 DB가 비어 있어도 복구된다", () => {
    // Postgres까지 뒤처져 있는 최악의 경우에도 방송은 살아나야 한다
    const plan = planReconciliation([path("a"), path("b")], [], NOW);
    expect(plan.live).toHaveLength(2);
    expect(plan.toEnd).toEqual([]);
    expect(plan.toMarkLive.sort()).toEqual(["a", "b"]);
  });
});
