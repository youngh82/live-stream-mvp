'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { FeedItem } from '@/domains/stream/components/FeedItem';
import {
  FeedEndCard,
  type FeedEndVariant,
} from '@/domains/feed/components/FeedEndCard';
import type { FeedFilter, FeedStream } from '@/domains/stream/hooks/useFeed';
import { useFeedSignals } from '@/domains/feed/hooks/useFeedSignals';

interface SwipeFeedProps {
  streams: FeedStream[];
  onLoadMore?: () => void;
  hasMore: boolean;
  onRemove?: (streamId: string) => void;
  filter: FeedFilter;
  /** 끝에 닿았을 때 그 사이 새로 켜진 방송을 뒤에 붙인다 */
  onLoadNew?: () => void;
  onRefresh: () => void;
  /** 팔로잉 탭의 끝 카드에서 추천 탭으로 옮긴다 */
  onGoToRecommended?: () => void;
}

/**
 * 같은 방송 묶음을 최대 몇 번까지 보여줄지 (첫 바퀴 포함).
 *
 * 3바퀴면 사용자도 충분히 봤다고 느끼고, 그 이상은 DOM만 쌓인다.
 * 바퀴마다 항목이 뒤에 붙으므로 무한 순환은 메모리도 같이 늘린다.
 */
const MAX_PASSES = 3;

/**
 * 다시보기를 시작할 최소 라이브 수.
 *
 * 2개를 번갈아 보여주는 건 어떤 안내를 붙여도 초라하고, 방금 본 방송이
 * 곧바로 다시 나오면 개선이 아니라 고장으로 읽힌다. 그 구간에서는
 * 순환하지 않고 다른 길(새로고침·탐색·팔로우)을 준다.
 */
const MIN_STREAMS_TO_LOOP = 3;

type FeedEntry =
  | { kind: 'stream'; key: string; stream: FeedStream; repeat: boolean }
  | {
      kind: 'end';
      key: string;
      variant: FeedEndVariant;
      isLast: boolean;
      /** 이 카드가 몇 번째 바퀴 끝인가. 같은 바퀴를 두 번 붙이지 않기 위한 값 */
      pass: number;
    };

export function SwipeFeed({
  streams,
  onLoadMore,
  hasMore,
  onRemove,
  filter,
  onLoadNew,
  onRefresh,
  onGoToRecommended,
}: SwipeFeedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const { setActive, getDwellTotals } = useFeedSignals();

  /**
   * 다시 보여주는 바퀴들. 방송 id만 순서대로 담는다.
   *
   * 첫 바퀴는 여기 없다 — 그건 `streams` 자체다. 목록을 복사해두지 않는
   * 이유는 방송이 끝나면 `streams`에서 빠지는데, 사본을 들고 있으면 끝난
   * 방송이 뒤 바퀴에 계속 남기 때문이다. 렌더할 때 살아 있는 것만
   * 통과시키면 몇 바퀴째에 있든 한 번에 사라진다.
   */
  const [extraPasses, setExtraPasses] = useState<string[][]>([]);
  /** 다음 바퀴를 이미 붙인 카드의 번호. 같은 카드에 두 번 반응하지 않는다 */
  const handledPassRef = useRef(-1);

  const byId = useMemo(() => new Map(streams.map((s) => [s.id, s])), [streams]);

  /**
   * 다시보기를 더 붙일 수 있는가.
   *
   * 팔로잉 탭은 라이브가 몇 개든 순환하지 않는다. 규모와 무관하게 짧은
   * 목록이고, 사용자가 "이 사람들만"이라고 고른 결과이기 때문이다.
   * 벗어나는 건 끝 카드에서 권유만 하고 선택은 사용자에게 남긴다.
   */
  const canLoop =
    filter === 'all' &&
    streams.length >= MIN_STREAMS_TO_LOOP &&
    extraPasses.length + 1 < MAX_PASSES;

  const lastVariant: FeedEndVariant =
    filter === 'following'
      ? 'following'
      : canLoop
        ? 'looping'
        : // 한 바퀴라도 돌았다면 볼 게 없는 이유가 "적어서"가 아니라
          // "다 봐서"다. 문구가 사실과 어긋나면 안내가 아니라 잡음이 된다.
          extraPasses.length > 0
          ? 'exhausted'
          : 'sparse';

  /**
   * 화면에 세울 항목들.
   *
   * 바퀴마다 끝에 카드를 하나씩 둔다. **카드 뒤에 다음 바퀴를 붙이는 것이
   * 중요하다** — 카드 앞에 끼워 넣으면 카드를 보고 있던 사용자의 화면이
   * 삽입된 방송으로 바뀐다. 뒤에 붙이면 스크롤 위치가 그대로다.
   */
  const entries = useMemo<FeedEntry[]>(() => {
    const passes = [streams.map((s) => s.id), ...extraPasses];
    const seen = new Set<string>();
    const list: FeedEntry[] = [];

    passes.forEach((pass, passIndex) => {
      for (const id of pass) {
        const stream = byId.get(id);
        if (!stream) continue;

        // 같은 방송이 여러 바퀴에 들어가므로 id만으로는 key가 겹친다.
        // 겹치면 React가 DOM을 잘못 재사용해서 재생이 엉킨다.
        list.push({
          kind: 'stream',
          key: `${id}:${passIndex}`,
          stream,
          repeat: seen.has(id),
        });
        seen.add(id);
      }

      const isLast = passIndex === passes.length - 1;
      // 아직 더 불러올 게 있으면 첫 바퀴는 끝난 게 아니다
      if (isLast && hasMore) return;
      if (list.length === 0) return;

      list.push({
        kind: 'end',
        key: `end:${passIndex}`,
        // 지나간 카드는 뒤에 내용이 있으니 언제나 "이어집니다"이다
        variant: isLast ? lastVariant : 'looping',
        isLast,
        pass: passIndex,
      });
    });

    return list;
  }, [streams, extraPasses, byId, hasMore, lastVariant]);

  /**
   * 마지막 끝 카드에 도착했을 때.
   *
   * 두 가지를 한다. 먼저 **그 사이 새로 켜진 방송이 있는지 확인한다** —
   * 새로 켠 사람을 두고 본 걸 또 보여주는 게 다시보기의 가장 나쁜
   * 형태다. 그리고 순환 조건이면 다음 바퀴를 카드 뒤에 붙인다.
   *
   * 카드에 **도착한 시점**에 미리 붙여둔다. 스크롤 스냅에는 "지나가려는
   * 동작"을 잡아낼 방법이 없어서, 사용자가 미는 순간 이미 아래에 내용이
   * 있어야 한다.
   */
  const handleReachEnd = useCallback(
    (pass: number) => {
      // 관찰 콜백은 같은 카드에 대해 여러 번 불린다. 렌더마다 ref 콜백이
      // 새로 만들어져 모든 요소를 다시 observe하는데, `observe()`는 이미
      // 교차 중인 요소에 대해서도 콜백을 한 번 더 부르기 때문이다
      // (개발 모드의 StrictMode는 이를 다시 두 배로 만든다).
      // 그래서 "몇 번째 카드까지 처리했는가"를 들고 한 번만 반응한다.
      if (handledPassRef.current >= pass) return;
      handledPassRef.current = pass;

      // 마지막으로 보던 방송의 체류를 먼저 마감한다. 이걸 안 하면 방금
      // 본 방송만 체류 0으로 계산돼서 다시보기 순서의 맨 뒤로 밀린다 —
      // 하필 관심이 가장 확실한 방송이다.
      setActive(null);

      onLoadNew?.();
      if (!canLoop) return;

      setExtraPasses((prev) => {
        const dwell = getDwellTotals();

        // 오래 본 순서. 체류가 같으면(둘 다 0이면) 원래 순서를 지킨다.
        const next = streams
          .map((s, i) => ({ id: s.id, dwell: dwell.get(s.id) ?? 0, i }))
          .sort((a, b) => b.dwell - a.dwell || a.i - b.i)
          .map((s) => s.id);

        // 방금 본 방송이 곧바로 다시 나오면 순환이 고장으로 보인다.
        // 가장 오래 본 방송이 마지막에 보던 것일 확률이 높아 자주 걸린다.
        const previous = prev[prev.length - 1] ?? streams.map((s) => s.id);
        if (next.length > 1 && next[0] === previous[previous.length - 1]) {
          next.push(next.shift()!);
        }

        return [...prev, next];
      });
    },
    [canLoop, streams, getDwellTotals, onLoadNew, setActive],
  );

  /**
   * 관찰 콜백은 한 번만 만들어지므로 최신 핸들러를 ref로 건네준다.
   * 의존성에 넣어 관찰자를 다시 만들면 스크롤 도중 관찰이 끊긴다.
   */
  const reachEndRef = useRef(handleReachEnd);
  useEffect(() => {
    reachEndRef.current = handleReachEnd;
  }, [handleReachEnd]);

  // Observe which item is in view
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (observed) => {
        for (const entry of observed) {
          if (!entry.isIntersecting) continue;

          const el = entry.target as HTMLElement;
          const index = Number(el.getAttribute('data-index'));
          if (!isNaN(index)) setActiveIndex(index);

          // 다음 바퀴를 붙이는 건 화면 상태 동기화가 아니라 사용자가
          // 끝까지 왔다는 사건이다. 이펙트가 아니라 여기서 처리한다.
          if (el.dataset.lastEnd === 'true') {
            reachEndRef.current(Number(el.dataset.pass));
          }
        }
      },
      {
        root: containerRef.current,
        threshold: 0.6,
      },
    );

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  // Observe new items
  const setItemRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(index, el);
      observerRef.current?.observe(el);
    } else {
      const existing = itemRefs.current.get(index);
      if (existing) {
        observerRef.current?.unobserve(existing);
        itemRefs.current.delete(index);
      }
    }
  }, []);

  /**
   * 취향 신호.
   *
   * 활성 아이템이 바뀌는 이 지점이 체류 시간을 잴 수 있는 유일한 자리다.
   * 수집 자체는 훅이 큐에 모았다가 보낸다 — 스와이프마다 요청이 나가면
   * 전환 즉시 재생이라는 본질을 해친다.
   *
   * 두 번째 이후로 보여주는 항목은 `silent`다. 다시보기로 쌓인 신호가
   * 취향 점수를 부풀리면 그 점수가 곧 다음 피드의 순서가 된다
   * (useFeedSignals의 setActive 주석 참고).
   */
  useEffect(() => {
    const active = entries[activeIndex];

    if (!active || active.kind === 'end') {
      setActive(null);
      return;
    }

    setActive(
      {
        type: 'stream',
        id: active.stream.id,
        category: active.stream.category,
      },
      { silent: active.repeat },
    );
  }, [activeIndex, entries, setActive]);

  // Trigger load more when approaching the end
  useEffect(() => {
    if (hasMore && activeIndex >= entries.length - 2) {
      onLoadMore?.();
    }
  }, [activeIndex, entries.length, hasMore, onLoadMore]);

  return (
    <div
      ref={containerRef}
      className="h-dvh w-full snap-y snap-mandatory overflow-y-scroll bg-black"
      style={{ scrollbarWidth: 'none' }}
    >
      {entries.map((entry, index) => (
        <div
          key={entry.key}
          ref={(el) => setItemRef(index, el)}
          data-index={index}
          data-last-end={entry.kind === 'end' && entry.isLast ? 'true' : undefined}
          data-pass={entry.kind === 'end' ? entry.pass : undefined}
          className="h-dvh w-full snap-start snap-always"
        >
          {entry.kind === 'stream' ? (
            <FeedItem
              stream={entry.stream}
              isActive={index === activeIndex}
              onRemove={onRemove}
            />
          ) : (
            <FeedEndCard
              variant={entry.variant}
              onRefresh={onRefresh}
              onGoToRecommended={onGoToRecommended}
            />
          )}
        </div>
      ))}
    </div>
  );
}
