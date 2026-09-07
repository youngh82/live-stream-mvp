'use client';

import { useCallback, useState } from 'react';

interface UseFollowOptions {
  userId: string;
  initialFollowing?: boolean;
  initialCount?: number;
  onRequireLogin?: () => void;
}

/**
 * 팔로우 토글.
 *
 * 낙관적 갱신이다 — 누르면 즉시 반영하고 실패하면 되돌린다. 서버 왕복을
 * 기다리면 피드처럼 빠르게 스와이프하는 화면에서 버튼이 굼떠 보인다.
 *
 * 연타 방지는 서버가 멱등이라(PK 충돌을 성공으로 처리) 별도 잠금이 필요 없지만,
 * 요청이 겹치면 마지막 응답이 이전 상태를 덮어쓸 수 있어 pending 중에는 막는다.
 */
export function useFollow({
  userId,
  initialFollowing = false,
  initialCount = 0,
  onRequireLogin,
}: UseFollowOptions) {
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);

  const toggle = useCallback(async () => {
    if (pending) return;

    const next = !following;
    setFollowing(next);
    setCount((c) => Math.max(c + (next ? 1 : -1), 0));
    setPending(true);

    try {
      const res = await fetch(`/api/follow/${userId}`, {
        method: next ? 'POST' : 'DELETE',
      });

      if (!res.ok) {
        if (res.status === 401) onRequireLogin?.();
        throw new Error('failed');
      }
    } catch {
      // 롤백
      setFollowing(!next);
      setCount((c) => Math.max(c + (next ? -1 : 1), 0));
    } finally {
      setPending(false);
    }
  }, [pending, following, userId, onRequireLogin]);

  return { following, count, pending, toggle, setFollowing, setCount };
}
