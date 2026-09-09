import { describe, expect, it } from "vitest";
import {
  MAX_BATCH,
  MAX_DWELL_MS,
  SIGNAL_KINDS,
  type FeedSignal,
} from "@/domains/feed/signals";
import { normalizeSignalEvents } from "./normalize-signals";

/**
 * 이 입력은 전부 위조 가능하다. 통과한 값이 그대로 피드 랭킹이 되므로,
 * 여기서 막지 못하면 자기 방송을 추천 상위로 밀어 올릴 수 있다.
 *
 * 지키는 것:
 *  1. dwell 5분 상한 (MAX_DWELL_MS)
 *  2. 배치 크기 상한 (MAX_BATCH)
 *  3. user_id는 항상 서버가 넣는다 — 클라이언트가 보낸 값을 절대 믿지 않는다
 *  4. 형식이 틀린 이벤트는 400이 아니라 조용히 버린다
 */

const UUID = "11111111-2222-4333-8444-555555555555";
const USER = "99999999-8888-4777-8666-555555555555";

const valid = (over: Partial<FeedSignal> = {}): FeedSignal => ({
  targetType: "stream",
  targetId: UUID,
  kind: "dwell",
  ...over,
});

describe("dwell 상한", () => {
  it("5분을 넘는 값은 5분으로 자른다", () => {
    const [row] = normalizeSignalEvents(USER, [
      valid({ dwellMs: MAX_DWELL_MS + 1 }),
    ]);
    expect(row.dwell_ms).toBe(MAX_DWELL_MS);
  });

  it("터무니없이 큰 값도 5분으로 잘린다", () => {
    for (const bogus of [1e9, Number.MAX_SAFE_INTEGER, 86_400_000]) {
      const [row] = normalizeSignalEvents(USER, [valid({ dwellMs: bogus })]);
      expect(row.dwell_ms, `${bogus}가 통과했다`).toBe(MAX_DWELL_MS);
    }
  });

  it("상한 경계값은 그대로 통과한다", () => {
    const [row] = normalizeSignalEvents(USER, [valid({ dwellMs: MAX_DWELL_MS })]);
    expect(row.dwell_ms).toBe(MAX_DWELL_MS);
  });

  it("음수는 0으로 올린다", () => {
    const [row] = normalizeSignalEvents(USER, [valid({ dwellMs: -5000 })]);
    expect(row.dwell_ms).toBe(0);
  });

  it("소수는 버림한다 (DB 컬럼이 정수다)", () => {
    const [row] = normalizeSignalEvents(USER, [valid({ dwellMs: 1234.9 })]);
    expect(row.dwell_ms).toBe(1234);
  });

  it("NaN·Infinity·문자열·누락은 null이 된다", () => {
    const bogus = [NaN, Infinity, -Infinity, "5000", null, undefined, {}];
    for (const d of bogus) {
      const [row] = normalizeSignalEvents(USER, [
        valid({ dwellMs: d as number }),
      ]);
      expect(row.dwell_ms, `${String(d)}가 숫자로 통과했다`).toBeNull();
    }
  });

  it("정상 범위 값은 손대지 않는다", () => {
    const [row] = normalizeSignalEvents(USER, [valid({ dwellMs: 4_200 })]);
    expect(row.dwell_ms).toBe(4_200);
  });
});

describe("배치 상한", () => {
  it("MAX_BATCH를 넘으면 앞에서부터 잘라낸다", () => {
    const events = Array.from({ length: MAX_BATCH + 25 }, () => valid());
    expect(normalizeSignalEvents(USER, events)).toHaveLength(MAX_BATCH);
  });

  it("상한 이하면 전부 통과한다", () => {
    const events = Array.from({ length: MAX_BATCH }, () => valid());
    expect(normalizeSignalEvents(USER, events)).toHaveLength(MAX_BATCH);
  });

  it("잘라내기가 필터보다 먼저다 — 쓰레기로 배치를 채워 상한을 우회할 수 없다", () => {
    // 앞쪽을 무효 이벤트로 채우고 뒤에 유효한 것을 붙인다.
    // slice가 먼저이므로 뒤의 것들은 아예 보이지 않아야 한다.
    const junk = Array.from({ length: MAX_BATCH }, () => ({ nope: true }));
    const events = [...junk, ...Array.from({ length: 10 }, () => valid())];
    expect(normalizeSignalEvents(USER, events)).toHaveLength(0);
  });
});

describe("형식 검증", () => {
  it("targetId가 UUID가 아니면 버린다", () => {
    for (const bad of ["", "not-a-uuid", "1; DROP TABLE feed_events", UUID + "x"]) {
      expect(
        normalizeSignalEvents(USER, [valid({ targetId: bad })]),
        `${bad}가 통과했다`,
      ).toHaveLength(0);
    }
  });

  it("정의되지 않은 kind는 버린다", () => {
    expect(
      normalizeSignalEvents(USER, [valid({ kind: "purchase" as never })]),
    ).toHaveLength(0);
  });

  it("정의된 kind는 전부 통과한다", () => {
    for (const kind of SIGNAL_KINDS) {
      expect(normalizeSignalEvents(USER, [valid({ kind })]), kind).toHaveLength(1);
    }
  });

  it("targetType은 stream과 post만 받는다", () => {
    expect(
      normalizeSignalEvents(USER, [valid({ targetType: "user" as never })]),
    ).toHaveLength(0);
  });

  it("null·문자열·숫자가 배열에 섞여 있어도 터지지 않는다", () => {
    const rows = normalizeSignalEvents(USER, [
      null,
      "hello",
      42,
      undefined,
      [],
      valid(),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("배열이 아니면 빈 결과다 (던지지 않는다)", () => {
    for (const bad of [null, undefined, {}, "events", 0]) {
      expect(normalizeSignalEvents(USER, bad)).toEqual([]);
    }
  });

  it("category는 문자열일 때만 살린다", () => {
    expect(
      normalizeSignalEvents(USER, [valid({ category: "game" })])[0].category,
    ).toBe("game");
    for (const bad of [123, {}, true, null, undefined]) {
      expect(
        normalizeSignalEvents(USER, [valid({ category: bad as string })])[0]
          .category,
      ).toBeNull();
    }
  });
});

describe("user_id는 서버가 정한다", () => {
  it("클라이언트가 보낸 user_id를 무시한다", () => {
    // 이걸 믿으면 남의 계정으로 취향 신호를 심을 수 있다
    const [row] = normalizeSignalEvents(USER, [
      { ...valid(), user_id: "attacker", userId: "attacker" },
    ]);
    expect(row.user_id).toBe(USER);
  });

  it("모든 행에 같은 user_id가 붙는다", () => {
    const rows = normalizeSignalEvents(USER, [valid(), valid(), valid()]);
    expect(rows.every((r) => r.user_id === USER)).toBe(true);
  });

  it("알 수 없는 필드는 행에 새어 들어가지 않는다", () => {
    const [row] = normalizeSignalEvents(USER, [
      { ...valid(), score: 9999, is_admin: true },
    ]);
    expect(Object.keys(row).sort()).toEqual([
      "category",
      "dwell_ms",
      "kind",
      "target_id",
      "target_type",
      "user_id",
    ]);
  });
});
