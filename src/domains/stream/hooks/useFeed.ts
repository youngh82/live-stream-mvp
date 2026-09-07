'use client';

import { useState, useCallback, useEffect } from 'react';

export interface FeedStream {
  id: string;
  title: string;
  category: string | null;
  status: string;
  viewer_count: number;
  thumbnail_url: string | null;
  is_following?: boolean;
  is_me?: boolean;
  started_at: string;
  whep_url: string;
  users: {
    id: string;
    nickname: string;
    avatar_url: string | null;
  };
}

export type FeedFilter = 'all' | 'following';

interface UseFeedReturn {
  streams: FeedStream[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  loadNew: () => Promise<void>;
  removeStream: (streamId: string) => void;
}

export function useFeed(filter: FeedFilter = 'all'): UseFeedReturn {
  const [streams, setStreams] = useState<FeedStream[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchFeed = useCallback(async (nextCursor?: string | null) => {
    // 첫 페이지 요청은 곧 목록 교체다(탭 전환·새로고침). 이전 탭의 방송이
    // 남아 있으면 잠깐 다른 목록이 보이므로 요청 전에 비운다.
    if (!nextCursor) {
      setLoading(true);
      setStreams([]);
      setCursor(null);
    }

    try {
      const params = new URLSearchParams({ limit: '5' });
      if (nextCursor) params.set('cursor', nextCursor);
      if (filter !== 'all') params.set('filter', filter);

      const res = await fetch(`/api/feed?${params}`);
      if (!res.ok) return;

      const { data, cursor: newCursor, has_more } = await res.json();

      if (nextCursor) {
        // 첫 페이지 상단으로 끌어올린 팔로잉 방송은 뒤 페이지의 전역
        // 목록에도 다시 나온다. 그대로 붙이면 같은 방송이 두 번 스와이프된다.
        setStreams((prev) => {
          const seen = new Set(prev.map((s: FeedStream) => s.id));
          return [
            ...prev,
            ...(data as FeedStream[]).filter((s) => !seen.has(s.id)),
          ];
        });
      } else {
        setStreams(data);
      }
      setCursor(newCursor);
      setHasMore(has_more);
    } catch (err) {
      console.error('Feed fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    await fetchFeed(cursor);
  }, [fetchFeed, cursor, hasMore, loading]);

  const refresh = useCallback(async () => {
    await fetchFeed(null);
  }, [fetchFeed]);

  /**
   * 그 사이에 새로 켜진 방송을 **뒤에 붙인다.**
   *
   * 피드 끝에 도달했을 때 부른다. `refresh`는 목록을 통째로 갈아엎어서
   * 보고 있던 화면이 사라지고 스크롤이 맨 위로 튄다 — 다 보고 나서
   * "더 없나" 확인하는 자리에서 쓸 수 있는 동작이 아니다.
   *
   * `has_more: false`는 그 순간의 스냅샷일 뿐이다. 스와이프하는 30초
   * 사이에 누가 방송을 켰을 수 있고, 새로 켠 사람을 두고 본 걸 또
   * 보여주는 게 다시보기의 가장 나쁜 형태다.
   *
   * 커서 없이 첫 페이지만 읽는다 — 새 방송은 시작 시각이 가장 최근이라
   * 정렬상 항상 첫 페이지에 있다.
   */
  const loadNew = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '5' });
      if (filter !== 'all') params.set('filter', filter);

      const res = await fetch(`/api/feed?${params}`);
      if (!res.ok) return;

      const { data } = await res.json();

      setStreams((prev) => {
        const seen = new Set(prev.map((s: FeedStream) => s.id));
        const fresh = (data as FeedStream[]).filter((s) => !seen.has(s.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    } catch {
      // 확인에 실패해도 화면은 그대로 둔다. 다음 시도에 잡히면 된다.
    }
  }, [filter]);

  /**
   * 종료된 방송을 목록에서 뺀다.
   *
   * 이게 없으면 방송이 끝난 자리에 "방송이 종료되었습니다" 화면이
   * 그대로 남아서, 스와이프로도 빠져나갈 수 없는 상태가 된다.
   */
  const removeStream = useCallback((streamId: string) => {
    setStreams((prev) => prev.filter((s) => s.id !== streamId));
  }, []);

  // 탭을 바꾸면 fetchFeed의 정체성이 바뀌므로 자동으로 다시 불러온다
  useEffect(() => {
    fetchFeed(null);
  }, [fetchFeed]);

  return { streams, loading, hasMore, loadMore, refresh, loadNew, removeStream };
}
