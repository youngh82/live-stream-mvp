'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  MAX_BATCH,
  MAX_DWELL_MS,
  SKIP_THRESHOLD_MS,
  type FeedSignal,
  type SignalKind,
  type SignalTargetType,
} from '@/domains/feed/signals';

/** 이 개수가 모이거나 이 시간이 지나면 보낸다 */
const FLUSH_SIZE = 10;
const FLUSH_INTERVAL_MS = 15_000;

interface TrackTarget {
  type: SignalTargetType;
  id: string;
  category?: string | null;
}

/**
 * 피드 취향 신호 수집.
 *
 * 활성 아이템이 바뀔 때마다 이전 아이템의 체류 시간을 기록한다.
 * 짧게 넘긴 것(skip)도 신호다 — 오히려 "관심 없음"이 더 선명한 정보다.
 *
 * **보내기가 사용자 경험을 방해하면 안 된다.** 모아서 보내고, 실패는
 * 삼키고, 페이지를 떠날 때는 sendBeacon으로 넘긴다(fetch는 언로드 중에 취소된다).
 */
export function useFeedSignals() {
  const queue = useRef<FeedSignal[]>([]);
  const current = useRef<{
    target: TrackTarget;
    enteredAt: number;
    silent: boolean;
  } | null>(null);

  /**
   * 이번 세션에서 대상별로 머문 시간의 합.
   *
   * 서버로 보내는 신호와 별개로 **클라이언트가 직접 쓴다** — 피드를 한 바퀴
   * 다 본 뒤 다시 보여줄 때 "오래 본 순서"를 여기서 정한다.
   * 서버의 `user_taste`를 쓰지 않는 이유는 그게 카테고리 단위 집계라
   * "이 방송을 오래 봤다"를 답해주지 못하고, 애초에 랭킹(Phase 13)이
   * 아직 없기 때문이다.
   *
   * 조용한(silent) 구간의 체류도 여기에는 쌓는다. 서버에 안 보낼 뿐
   * 순서를 정하는 데는 여전히 쓸모 있는 정보다.
   */
  const dwellTotals = useRef<Map<string, number>>(new Map());

  const flush = useCallback((useBeacon = false) => {
    if (queue.current.length === 0) return;

    const events = queue.current.splice(0, MAX_BATCH);
    const body = JSON.stringify({ events });

    // 언로드 중에는 fetch가 취소된다. 마지막 체류 시간이 통째로 날아가는데
    // 그게 하필 가장 오래 본 아이템이라 손실이 크다.
    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(
        '/api/signals',
        new Blob([body], { type: 'application/json' }),
      );
      return;
    }

    fetch('/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // 신호는 유실돼도 된다. 재시도 큐를 만들 가치가 없다.
    });
  }, []);

  const enqueue = useCallback(
    (signal: FeedSignal) => {
      queue.current.push(signal);
      if (queue.current.length >= FLUSH_SIZE) flush();
    },
    [flush],
  );

  /** 임의 시점의 명시적 관심 행동 (채팅·후원·팔로우·프로필 이동) */
  const track = useCallback(
    (kind: SignalKind, target: TrackTarget) => {
      enqueue({
        targetType: target.type,
        targetId: target.id,
        kind,
        category: target.category ?? null,
      });
    },
    [enqueue],
  );

  /** 이전 아이템의 체류를 마감한다 */
  const closeCurrent = useCallback(() => {
    const active = current.current;
    if (!active) return;

    const dwellMs = Math.min(Date.now() - active.enteredAt, MAX_DWELL_MS);
    current.current = null;

    const total = dwellTotals.current.get(active.target.id) ?? 0;
    dwellTotals.current.set(active.target.id, total + dwellMs);

    if (active.silent) return;

    enqueue({
      targetType: active.target.type,
      targetId: active.target.id,
      kind: dwellMs < SKIP_THRESHOLD_MS ? 'skip' : 'dwell',
      dwellMs,
      category: active.target.category ?? null,
    });
  }, [enqueue]);

  /**
   * 활성 아이템이 바뀌었을 때 호출한다.
   *
   * `silent`는 **이미 이번 세션에서 보여준 항목을 다시 보여줄 때** 쓴다.
   * 피드를 다 본 뒤 다시 돌 때 같은 방송의 impression·dwell이 또 쌓이면
   * 그 방송과 카테고리의 취향 점수가 실제 관심보다 부풀고, 그 점수가
   * 곧 피드 노출 순서가 된다 — 스스로 만든 편향이다.
   *
   * 재방문은 원래 첫 시청보다 강한 선호 신호지만, 그렇게 다루려면
   * `feed_events.kind`에 종류를 추가하고 랭킹이 그걸 다르게 계산해야 한다.
   * 읽는 쪽(Phase 13)이 없는 지금은 **안 보내는 쪽이 안전하다** —
   * 잘못 쌓인 신호는 7일 뒤 정리될 때까지 랭킹을 흔든다.
   */
  const setActive = useCallback(
    (target: TrackTarget | null, options?: { silent?: boolean }) => {
      if (current.current?.target.id === target?.id) return;

      closeCurrent();
      if (!target) return;

      const silent = options?.silent ?? false;
      current.current = { target, enteredAt: Date.now(), silent };
      if (silent) return;

      enqueue({
        targetType: target.type,
        targetId: target.id,
        kind: 'impression',
        category: target.category ?? null,
      });
    },
    [closeCurrent, enqueue],
  );

  useEffect(() => {
    const timer = setInterval(() => flush(), FLUSH_INTERVAL_MS);

    // 탭을 닫거나 백그라운드로 보내면 체류가 끝난 것으로 본다.
    // 모바일에서는 pagehide/visibilitychange가 유일하게 믿을 수 있는 신호다
    // (beforeunload는 iOS Safari에서 안 온다).
    const onHide = () => {
      closeCurrent();
      flush(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };

    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      closeCurrent();
      flush(true);
    };
  }, [flush, closeCurrent]);

  /**
   * 대상별 누적 체류 시간(ms)의 사본.
   *
   * 사본을 주는 이유: 내부 Map을 그대로 넘기면 호출한 쪽이 정렬 중에
   * 값이 바뀌는 걸 보게 된다(체류는 계속 쌓인다).
   */
  const getDwellTotals = useCallback(
    () => new Map(dwellTotals.current),
    [],
  );

  return { setActive, track, getDwellTotals };
}
