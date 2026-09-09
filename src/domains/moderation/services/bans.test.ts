import { beforeEach, describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import {
  BAN_NEGATIVE_TTL_SEC,
  BAN_NONE,
  BAN_PERMANENT,
  banKey,
} from "@/domains/moderation/types";
import { cacheBan, clearBanCache, isBanned } from "./bans";

/**
 * 여기서 지키는 것.
 *
 *  1. **"차단 없음"도 캐싱된다.** 이게 빠지면 평범한 유저의 모든 메시지가
 *     캐시 미스 → DB 왕복이 된다. 채팅에서는 그대로 지연으로 나타난다.
 *  2. **캐시 미스에서 DB를 읽어 다시 채운다.** 반대로 하면(Redis를 진실로 두면)
 *     Redis가 날아갈 때 영구 차단이 조용히 풀린다.
 *  3. **타임아웃 만료를 TTL이 대신 처리한다** — 별도 크론이 없으므로 TTL이
 *     틀리면 만료가 아예 동작하지 않는다.
 *
 * Redis는 가짜로 대체한다. set 호출의 인자(특히 TTL)까지 검사해야 하므로
 * 실제 서버를 띄우는 것보다 이쪽이 정확하다.
 */

/** isBanned/cacheBan이 쓰는 get·set만 구현한 가짜 Redis */
function fakeRedis() {
  const store = new Map<string, string>();
  const sets: Array<{ key: string; value: string; ttl?: number }> = [];

  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ex?: string, ttl?: number) => {
      store.set(key, value);
      sets.push({ key, value, ttl });
      return "OK";
    }),
  };

  return { redis: redis as unknown as Redis, store, sets, mock: redis };
}

const CHANNEL = "channel-1";
const USER = "user-1";
const KEY = banKey(CHANNEL, USER);

/** DB에 차단 기록이 없는 사용자 */
const noRow = vi.fn(async () => null);

beforeEach(() => {
  vi.useRealTimers();
  noRow.mockClear();
});

describe("isBanned — 캐시 적중", () => {
  it("'none'이 캐시돼 있으면 DB를 읽지 않는다", async () => {
    const { redis, store } = fakeRedis();
    store.set(KEY, BAN_NONE);

    expect(await isBanned(redis, CHANNEL, USER, noRow)).toEqual({
      banned: false,
      expiresAt: null,
    });
    expect(noRow).not.toHaveBeenCalled();
  });

  it("'perm'이 캐시돼 있으면 영구 차단이고 DB를 읽지 않는다", async () => {
    const { redis, store } = fakeRedis();
    store.set(KEY, BAN_PERMANENT);

    expect(await isBanned(redis, CHANNEL, USER, noRow)).toEqual({
      banned: true,
      expiresAt: null,
    });
    expect(noRow).not.toHaveBeenCalled();
  });

  it("만료 시각이 아직 남아 있으면 차단 상태다", async () => {
    const { redis, store } = fakeRedis();
    const at = Date.now() + 60_000;
    store.set(KEY, String(at));

    const state = await isBanned(redis, CHANNEL, USER, noRow);
    expect(state.banned).toBe(true);
    expect(state.expiresAt?.getTime()).toBe(at);
    expect(noRow).not.toHaveBeenCalled();
  });

  it("캐시된 만료 시각이 이미 지났으면 DB로 되돌아간다", async () => {
    const { redis, store } = fakeRedis();
    store.set(KEY, String(Date.now() - 1_000));

    expect(await isBanned(redis, CHANNEL, USER, noRow)).toEqual({
      banned: false,
      expiresAt: null,
    });
    expect(noRow).toHaveBeenCalledOnce();
  });

  it("캐시 값이 깨져 있으면 DB로 되돌아간다", async () => {
    const { redis, store } = fakeRedis();
    store.set(KEY, "쓰레기값");

    expect(await isBanned(redis, CHANNEL, USER, noRow)).toEqual({
      banned: false,
      expiresAt: null,
    });
    expect(noRow).toHaveBeenCalledOnce();
  });
});

describe("isBanned — 캐시 미스 후 재적재", () => {
  it("차단이 없으면 'none'을 60초 TTL로 캐싱한다", async () => {
    // 이게 이 파일에서 제일 중요한 테스트다. 빠지면 모든 일반 메시지가 DB를 때린다.
    const { redis, sets } = fakeRedis();

    expect(await isBanned(redis, CHANNEL, USER, noRow)).toEqual({
      banned: false,
      expiresAt: null,
    });
    expect(sets).toEqual([
      { key: KEY, value: BAN_NONE, ttl: BAN_NEGATIVE_TTL_SEC },
    ]);
  });

  it("두 번째 호출은 DB를 다시 읽지 않는다", async () => {
    const { redis } = fakeRedis();

    await isBanned(redis, CHANNEL, USER, noRow);
    await isBanned(redis, CHANNEL, USER, noRow);

    expect(noRow).toHaveBeenCalledOnce();
  });

  it("영구 차단은 TTL 없이 캐싱한다", async () => {
    const { redis, sets } = fakeRedis();
    const load = vi.fn(async () => ({ expires_at: null }));

    expect(await isBanned(redis, CHANNEL, USER, load)).toEqual({
      banned: true,
      expiresAt: null,
    });
    expect(sets).toEqual([{ key: KEY, value: BAN_PERMANENT, ttl: undefined }]);
  });

  it("타임아웃은 남은 시간만큼만 TTL을 건다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const { redis, sets } = fakeRedis();
    const expiresAt = new Date(Date.now() + 300_000); // 5분 뒤
    const load = vi.fn(async () => ({ expires_at: expiresAt.toISOString() }));

    const state = await isBanned(redis, CHANNEL, USER, load);
    expect(state.banned).toBe(true);
    expect(state.expiresAt?.getTime()).toBe(expiresAt.getTime());

    // TTL이 만료 시각과 어긋나면 크론이 없으므로 만료가 동작하지 않는다
    expect(sets).toEqual([
      { key: KEY, value: String(expiresAt.getTime()), ttl: 300 },
    ]);
  });

  it("DB에 남아 있어도 이미 만료된 차단은 풀린 것으로 본다", async () => {
    const { redis, sets } = fakeRedis();
    const load = vi.fn(async () => ({
      expires_at: new Date(Date.now() - 1_000).toISOString(),
    }));

    expect(await isBanned(redis, CHANNEL, USER, load)).toEqual({
      banned: false,
      expiresAt: null,
    });
    // 이때도 'none'을 캐싱해야 한다 — 아니면 만료된 차단이 매번 DB를 때린다
    expect(sets).toEqual([
      { key: KEY, value: BAN_NONE, ttl: BAN_NEGATIVE_TTL_SEC },
    ]);
  });
});

describe("cacheBan", () => {
  it("영구 차단은 TTL 없이 넣는다", async () => {
    const { redis, sets } = fakeRedis();
    await cacheBan(redis, CHANNEL, USER, null);
    expect(sets).toEqual([{ key: KEY, value: BAN_PERMANENT, ttl: undefined }]);
  });

  it("제재 직후 isBanned가 DB를 읽지 않고 차단으로 답한다", async () => {
    const { redis } = fakeRedis();
    await cacheBan(redis, CHANNEL, USER, null);

    expect(await isBanned(redis, CHANNEL, USER, noRow)).toEqual({
      banned: true,
      expiresAt: null,
    });
    expect(noRow).not.toHaveBeenCalled();
  });

  it("이미 지난 시각으로 들어와도 TTL이 최소 1초다", async () => {
    // ttl 0 이하를 그대로 넘기면 Redis가 에러를 낸다
    const { redis, sets } = fakeRedis();
    await cacheBan(redis, CHANNEL, USER, new Date(Date.now() - 60_000));
    expect(sets[0].ttl).toBe(1);
  });
});

describe("clearBanCache", () => {
  it("해제 시 'none'을 넣어 다음 메시지가 DB를 때리지 않게 한다", async () => {
    const { redis, sets } = fakeRedis();
    await clearBanCache(redis, CHANNEL, USER);
    expect(sets).toEqual([
      { key: KEY, value: BAN_NONE, ttl: BAN_NEGATIVE_TTL_SEC },
    ]);
  });
});
