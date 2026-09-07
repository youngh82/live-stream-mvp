'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2, Search, X } from 'lucide-react';
import { BottomNav } from '@/shared/components/BottomNav';
import { LiveCard, type LiveCardStream } from '@/domains/stream/components/LiveCard';
import { useRecentSearches } from '@/domains/stream/hooks/useRecentSearches';
import { useCategoryLabel } from '@/domains/stream/hooks/useCategoryLabel';
import type { Category } from '@/domains/stream/categories';

interface CategoryChip extends Category {
  live_count: number;
}

interface SearchUser {
  id: string;
  nickname: string;
  avatar_url: string | null;
  follower_count: number;
}

interface SearchResult {
  users: SearchUser[];
  streams: (LiveCardStream & { is_live: boolean })[];
  categories: Category[];
}

/** 타이핑마다 요청하지 않는다 */
const DEBOUNCE_MS = 250;

export default function ExplorePage() {
  const t = useTranslations('explore');
  const categoryLabel = useCategoryLabel();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [chips, setChips] = useState<CategoryChip[]>([]);
  const [popular, setPopular] = useState<LiveCardStream[]>([]);
  // 결과에 검색어를 같이 들고 있는다. 그래야 "검색어가 바뀌면 결과를 지운다"는
  // 상태 갱신 없이, 지금 검색어와 일치하는 결과만 보여주는 것으로 끝난다.
  const [result, setResult] = useState<{
    term: string;
    data: SearchResult;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const recent = useRecentSearches();

  const searching_ = query.trim().length > 0;

  const loadDiscover = useCallback(async (cat: string | null) => {
    setLoading(true);
    try {
      const params = cat ? `?category=${encodeURIComponent(cat)}` : '';
      const res = await fetch(`/api/discover${params}`);
      const { data } = await res.json();
      if (data) {
        setChips(data.categories);
        setPopular(data.streams);
      }
    } catch {
      // 탐색 화면이 비는 것 외에 할 수 있는 게 없다
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 마이크로태스크로 미룬다. 이펙트 본문에서 곧바로 setState하면
    // 렌더가 연쇄로 한 번 더 도는 것을 React가 경고한다.
    queueMicrotask(() => loadDiscover(category));
  }, [category, loadDiscover]);

  // 검색: 디바운스 + 이전 요청 취소.
  // 취소하지 않으면 느린 앞 요청이 뒤 요청 결과를 덮어쓴다.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (!term) return;

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const { data } = await res.json();
        setResult({ term, data });
      } catch {
        // abort는 정상 흐름이다
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <>
      <div className="min-h-dvh bg-gray-950 text-white">
        <div className="mx-auto max-w-3xl px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-24">
          {/* 검색창 */}
          <div className="relative">
            <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') recent.add(query);
              }}
              placeholder={t('searchPlaceholder')}
              className="w-full rounded-full bg-gray-900 py-3 pr-10 pl-10 text-sm text-white outline-none ring-1 ring-gray-800 focus:ring-gray-600"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label={t('clear')}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {searching_ ? (
            <SearchResults
              result={result?.term === query.trim() ? result.data : null}
              loading={searching}
              onPickCategory={(id) => {
                setQuery('');
                setCategory(id);
              }}
            />
          ) : (
            <>
              {recent.items.length > 0 && (
                <section className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-400">
                      {t('recentSearches')}
                    </h2>
                    <button
                      onClick={recent.clear}
                      className="text-xs text-gray-600 hover:text-gray-400"
                    >
                      {t('clearAll')}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recent.items.map((term) => (
                      <button
                        key={term}
                        onClick={() => setQuery(term)}
                        className="rounded-full bg-gray-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* 카테고리 칩 */}
              <section className="mt-5">
                <h2 className="mb-2 text-sm font-semibold text-gray-400">
                  {t('categories')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    active={category === null}
                    onClick={() => setCategory(null)}
                    label={t('allCategories')}
                  />
                  {chips.map((c) => (
                    <Chip
                      key={c.id}
                      active={category === c.id}
                      onClick={() =>
                        setCategory((prev) => (prev === c.id ? null : c.id))
                      }
                      label={`${c.emoji} ${categoryLabel(c.id)}`}
                      count={c.live_count}
                    />
                  ))}
                </div>
              </section>

              <section className="mt-6">
                <h2 className="mb-3 text-sm font-semibold text-gray-400">
                  {category ? t('liveInCategory') : t('popularNow')}
                </h2>

                {loading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-600" />
                  </div>
                ) : popular.length === 0 ? (
                  <p className="py-12 text-center text-sm text-gray-600">
                    {category ? t('emptyCategory') : t('empty')}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {popular.map((s) => (
                      <LiveCard key={s.id} stream={s} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      <BottomNav />
    </>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-white font-semibold text-black'
          : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={active ? 'ml-1 text-gray-600' : 'ml-1 text-gray-500'}>
          {count}
        </span>
      )}
    </button>
  );
}

function SearchResults({
  result,
  loading,
  onPickCategory,
}: {
  result: SearchResult | null;
  loading: boolean;
  onPickCategory: (id: string) => void;
}) {
  const t = useTranslations('explore');
  const categoryLabel = useCategoryLabel();

  if (loading && !result) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-600" />
      </div>
    );
  }

  if (!result) return null;

  const empty =
    result.users.length === 0 &&
    result.streams.length === 0 &&
    result.categories.length === 0;

  if (empty) {
    return (
      <p className="py-16 text-center text-sm text-gray-600">
        {t('noResults')}
      </p>
    );
  }

  return (
    <div className="mt-5 space-y-7">
      {/* 방송자를 맨 위에 둔다 — 사람들은 대부분 "그 사람"을 찾는다 */}
      {result.users.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-400">
            {t('streamers')}
          </h2>
          <ul className="space-y-1">
            {result.users.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/u/${u.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-gray-900"
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-800">
                    {u.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatar_url}
                        alt={u.nickname}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm font-bold">
                        {u.nickname[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{u.nickname}</p>
                    <p className="text-xs text-gray-500">
                      {t('followerCount', { count: u.follower_count })}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.streams.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-400">
            {t('streams')}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {result.streams.map((s) => (
              <LiveCard key={s.id} stream={s} live={s.is_live} />
            ))}
          </div>
        </section>
      )}

      {result.categories.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-400">
            {t('categories')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {result.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => onPickCategory(c.id)}
                className="rounded-full bg-gray-900 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
              >
                {c.emoji} {categoryLabel(c.id)}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
