'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'recent-searches';
const MAX = 8;

/**
 * 최근 검색어.
 *
 * **서버에 저장하지 않는다.** 기기 하나에서만 의미가 있고, 검색 이력은
 * 민감할 수 있어서 굳이 계정에 붙일 이유가 없다. localStorage로 충분하다.
 *
 * 사파리 프라이빗 모드 등에서는 접근 자체가 예외를 던지므로 전부 감싼다.
 */
export function useRecentSearches() {
  const [items, setItems] = useState<string[]>([]);

  // 서버에는 localStorage가 없으므로 초기값은 반드시 빈 배열이어야 한다.
  // 초기화 함수에서 바로 읽으면 서버(빈 배열)와 클라이언트(저장값)의
  // 첫 렌더가 달라져 하이드레이션이 깨진다. 그래서 마운트 후에 채운다.
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) setItems(JSON.parse(raw));
      } catch {
        // 저장소를 못 쓰는 환경. 기능만 빠지고 화면은 정상 동작한다.
      }
    });
  }, []);

  const persist = useCallback((next: string[]) => {
    setItems(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const add = useCallback(
    (term: string) => {
      const value = term.trim();
      if (!value) return;
      persist([value, ...items.filter((i) => i !== value)].slice(0, MAX));
    },
    [items, persist],
  );

  const remove = useCallback(
    (term: string) => persist(items.filter((i) => i !== term)),
    [items, persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  return { items, add, remove, clear };
}
