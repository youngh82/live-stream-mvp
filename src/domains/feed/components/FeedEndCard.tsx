'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Compass, RefreshCw, Repeat, Sparkles } from 'lucide-react';
import { FollowButton } from '@/domains/user/components/FollowButton';

/**
 * 라이브를 다 봤을 때 나오는 자리.
 *
 * **이건 에러 화면이 아니라 피드의 한 칸이다.** 스와이프에는 항상 도착지가
 * 있어야 하는데, 예전에는 마지막 방송에서 밀어도 아무 일이 없었다 —
 * 피드백이 0이라 사용자에게는 고장으로 보인다.
 *
 * 그리고 이 자리는 **Phase 12(24시간 포스트)가 들어올 자리이기도 하다.**
 * 라이브가 떨어졌을 때 무엇을 이어 붙일지가 오래 갈 구조이고, 지금의
 * 다시보기·추천은 그 자리에 잠시 앉아 있는 내용물이다. 그래서 순환 로직을
 * 피드에 흩어놓지 않고 이 컴포넌트 하나로 모아뒀다.
 *
 * 세 가지 경우가 있고, 셋 다 나갈 문이 있어야 한다:
 *
 * - `looping`   라이브가 넉넉하다. 밑에 다시 이어진다고 알려준다.
 * - `exhausted` 다시보기까지 끝났다. 볼 게 없는 이유가 "다 봤기" 때문이다.
 * - `sparse`    애초에 라이브가 적어서 순환하지 않았다.
 *
 * 뒤 둘을 나누는 이유는 문구가 사실이어야 하기 때문이다. 세 바퀴를 다 본
 * 사람에게 "지금은 라이브가 많지 않아요"라고 하면 틀린 말이다.
 * - `following` 팔로잉 탭. **추천으로 자동으로 넘기지 않는다** — 탭은
 *   필터이고, 필터를 벗어나는 건 사용자가 정할 일이다. 권유만 한다.
 */
export type FeedEndVariant =
  | 'looping'
  | 'exhausted'
  | 'sparse'
  | 'following';

interface SuggestedStreamer {
  id: string;
  nickname: string;
  avatar_url: string | null;
}

interface FeedEndCardProps {
  variant: FeedEndVariant;
  onRefresh: () => void;
  /** 팔로잉 탭에서만 쓴다. 추천 탭으로 옮긴다 */
  onGoToRecommended?: () => void;
}

/** 카드에 띄울 추천 방송자 수. 고르는 피로가 없을 만큼만 */
const MAX_SUGGESTIONS = 3;

export function FeedEndCard({
  variant,
  onRefresh,
  onGoToRecommended,
}: FeedEndCardProps) {
  const t = useTranslations('feedEnd');
  const [suggestions, setSuggestions] = useState<SuggestedStreamer[]>([]);

  /**
   * 팔로우할 만한 방송자.
   *
   * 팔로잉 탭이 비는 근본 원인은 "팔로우가 부족해서"다. 여기서 바로
   * 채울 수 있어야 다음 방문에 볼 것이 생긴다 — 지금 볼 게 없다는 사실을
   * 다음 방문의 이유로 바꾸는 자리다.
   *
   * 다시보기가 이어지는 `looping`에서는 띄우지 않는다. 밑에 볼 게 더
   * 있는데 팔로우를 권하면 흐름을 끊는다.
   */
  useEffect(() => {
    if (variant === 'looping') return;

    let cancelled = false;

    fetch('/api/discover')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.data?.streams) return;

        const seen = new Set<string>();
        const picked: SuggestedStreamer[] = [];

        for (const stream of body.data.streams) {
          // 이미 팔로우했거나 내 방송이면 권할 이유가 없다
          if (stream.is_following || stream.is_me) continue;
          if (seen.has(stream.users.id)) continue;
          seen.add(stream.users.id);
          picked.push(stream.users);
          if (picked.length >= MAX_SUGGESTIONS) break;
        }

        setSuggestions(picked);
      })
      .catch(() => {
        // 추천은 없어도 카드가 성립한다. 조용히 넘어간다.
      });

    return () => {
      cancelled = true;
    };
  }, [variant]);

  const icon =
    variant === 'looping' ? (
      <Repeat className="h-10 w-10 text-white/70" />
    ) : (
      <Sparkles className="h-10 w-10 text-white/70" />
    );

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-black px-8 pb-[calc(var(--bottom-nav-h,0px)+2rem)] text-center">
      {icon}

      <div className="space-y-1.5">
        <p className="text-lg font-semibold text-white">
          {t(`${variant}_title`)}
        </p>
        <p className="text-sm leading-relaxed text-gray-400">
          {t(`${variant}_body`)}
        </p>
      </div>

      {variant === 'following' && onGoToRecommended && (
        <button
          onClick={onGoToRecommended}
          className="flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90"
        >
          <Compass className="h-4 w-4" />
          {t('goToRecommended')}
        </button>
      )}

      {suggestions.length > 0 && (
        <div className="w-full max-w-xs space-y-2 pt-1">
          <p className="text-xs font-semibold text-gray-500">
            {t('suggestions')}
          </p>
          <ul className="space-y-1.5">
            {suggestions.map((user) => (
              <li
                key={user.id}
                className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2"
              >
                <Link
                  href={`/u/${user.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2.5"
                >
                  <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-700">
                    {user.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={user.avatar_url}
                        alt={user.nickname}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xs font-bold text-white">
                        {user.nickname[0]?.toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-sm text-white">
                    {user.nickname}
                  </span>
                </Link>
                <FollowButton userId={user.id} variant="compact" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('refresh')}
        </button>
        <Link
          href="/explore"
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
        >
          <Compass className="h-3.5 w-3.5" />
          {t('explore')}
        </Link>
      </div>
    </div>
  );
}
