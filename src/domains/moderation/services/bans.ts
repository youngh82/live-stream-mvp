import type Redis from 'ioredis';
import {
  BAN_NEGATIVE_TTL_SEC,
  BAN_NONE,
  BAN_PERMANENT,
  banKey,
} from '@/domains/moderation/types';

export interface BanState {
  banned: boolean;
  /** null이면 영구 */
  expiresAt: Date | null;
}

/** DB에서 유효한 차단을 읽는 함수. 호출부가 자기 클라이언트를 넘긴다 */
export type BanLoader = (
  channelId: string,
  userId: string,
) => Promise<{ expires_at: string | null } | null>;

/**
 * 차단 여부 확인 (캐시 우선).
 *
 * **매 메시지마다 DB를 때리면 안 된다.** 채팅 rate limit이 Redis INCR인 것과
 * 같은 이유로 차단 상태도 Redis에 둔다.
 *
 * 캐시에는 "차단 없음"도 짧게 넣는다. 안 그러면 평범한 유저의 모든 메시지가
 * 캐시 미스로 DB 조회를 유발한다.
 *
 * 타임아웃 만료는 TTL이 알아서 처리하므로 별도 크론이 필요 없다.
 */
export async function isBanned(
  redis: Redis,
  channelId: string,
  userId: string,
  load: BanLoader,
): Promise<BanState> {
  const key = banKey(channelId, userId);

  const cached = await redis.get(key);
  if (cached === BAN_NONE) return { banned: false, expiresAt: null };
  if (cached === BAN_PERMANENT) return { banned: true, expiresAt: null };
  if (cached) {
    const at = Number(cached);
    if (Number.isFinite(at) && at > Date.now()) {
      return { banned: true, expiresAt: new Date(at) };
    }
  }

  // 캐시 미스 → DB가 진실이다
  const row = await load(channelId, userId);

  if (!row) {
    await redis.set(key, BAN_NONE, 'EX', BAN_NEGATIVE_TTL_SEC);
    return { banned: false, expiresAt: null };
  }

  if (row.expires_at === null) {
    await redis.set(key, BAN_PERMANENT);
    return { banned: true, expiresAt: null };
  }

  const expiresAt = new Date(row.expires_at);
  const ttlSec = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);

  if (ttlSec <= 0) {
    // DB에는 남아 있지만 이미 지났다. 정리 배치가 아직 안 돈 것뿐이다.
    await redis.set(key, BAN_NONE, 'EX', BAN_NEGATIVE_TTL_SEC);
    return { banned: false, expiresAt: null };
  }

  await redis.set(key, String(expiresAt.getTime()), 'EX', ttlSec);
  return { banned: true, expiresAt };
}

/** 제재 직후 캐시를 갱신한다 (DB 커밋 뒤에 호출할 것) */
export async function cacheBan(
  redis: Redis,
  channelId: string,
  userId: string,
  expiresAt: Date | null,
): Promise<void> {
  const key = banKey(channelId, userId);

  if (expiresAt === null) {
    await redis.set(key, BAN_PERMANENT);
    return;
  }

  const ttlSec = Math.max(
    Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
    1,
  );
  await redis.set(key, String(expiresAt.getTime()), 'EX', ttlSec);
}

export async function clearBanCache(
  redis: Redis,
  channelId: string,
  userId: string,
): Promise<void> {
  await redis.set(banKey(channelId, userId), BAN_NONE, 'EX', BAN_NEGATIVE_TTL_SEC);
}
