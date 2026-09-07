'use client';

import { useState } from 'react';
import { useFeed, type FeedFilter } from '@/domains/stream/hooks/useFeed';
import { SwipeFeed } from '@/domains/stream/components/SwipeFeed';
import { BottomNav, BOTTOM_NAV_HEIGHT } from '@/shared/components/BottomNav';
import { FeedEndCard } from '@/domains/feed/components/FeedEndCard';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

/**
 * 하단 탭 높이를 CSS 변수로 내려보낸다.
 *
 * 예전에는 라이브가 있으면 BottomNav를 통째로 숨겼다. 채팅 입력창(z-20)이
 * BottomNav(z-50)에 가려서였는데, 그 대가로 방송을 보는 동안 "방송하기"·
 * "내 정보"로 이동할 방법이 사라졌다. 이제는 탭을 계속 띄워두고
 * 채팅창이 탭 위에 자리잡도록 높이만 알려준다.
 */
/** 상단 탭이 차지하는 높이. StreamOverlay가 이만큼 내려온다 */
const FEED_TOP_HEIGHT = '3rem';

const navOffset = {
  '--bottom-nav-h': BOTTOM_NAV_HEIGHT,
  '--feed-top-h': FEED_TOP_HEIGHT,
} as React.CSSProperties;

const TABS: FeedFilter[] = ['all', 'following'];

/**
 * 상단 탭.
 *
 * 오버레이 위에 떠 있어야 해서 z-40이다. Player의 소리 토글(z-30)보다
 * 위이되 BottomNav(z-50)보다는 아래다. 배경을 깔지 않고 그라디언트에
 * 얹어 영상 화면을 최대한 가리지 않는다.
 */
function FeedTabs({
  value,
  onChange,
}: {
  value: FeedFilter;
  onChange: (v: FeedFilter) => void;
}) {
  const t = useTranslations('feed');

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/40 p-1 backdrop-blur">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              value === tab
                ? 'bg-white text-black'
                : 'text-white/70 hover:text-white'
            }`}
          >
            {t(`tab_${tab}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function FeedPage() {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const { streams, loading, hasMore, loadMore, refresh, loadNew, removeStream } =
    useFeed(filter);

  const tabs = <FeedTabs value={filter} onChange={setFilter} />;

  if (loading) {
    return (
      <>
        {tabs}
        <div className="flex h-dvh items-center justify-center bg-black">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
        <BottomNav />
      </>
    );
  }

  /*
   * 볼 게 하나도 없는 경우.
   *
   * 피드 끝과 **같은 카드를 쓴다.** 둘 다 "지금 볼 게 없다"는 같은 상태이고,
   * 화면을 따로 두면 한쪽에만 나가는 길을 붙이게 된다. 실제로 그랬다 —
   * 예전 빈 화면에는 새로고침뿐이라, 팔로잉 탭에서 가장 흔한 경우인
   * "아직 아무도 팔로우하지 않음"에서 할 수 있는 게 없었다.
   */
  if (streams.length === 0) {
    return (
      <div style={navOffset}>
        {tabs}
        <div className="h-dvh bg-black">
          <FeedEndCard
            variant={filter === 'following' ? 'following' : 'sparse'}
            onRefresh={refresh}
            onGoToRecommended={() => setFilter('all')}
          />
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div style={navOffset}>
      {tabs}
      <SwipeFeed
        // 탭을 바꾸면 다시보기 상태(순서·바퀴 수)를 처음부터 다시 만든다.
        // 같은 컴포넌트를 재사용하면 팔로잉에서 쌓인 순서가 추천 탭에 남는다.
        key={filter}
        streams={streams}
        onLoadMore={loadMore}
        hasMore={hasMore}
        onRemove={removeStream}
        filter={filter}
        onLoadNew={loadNew}
        onRefresh={refresh}
        onGoToRecommended={() => setFilter('all')}
      />
      <BottomNav />
    </div>
  );
}
