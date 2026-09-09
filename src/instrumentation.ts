/**
 * 서버 기동 시 한 번 실행된다 (Next.js instrumentation hook).
 *
 * 여기서 하는 일은 **라이브 목록 재조정** 하나다.
 * `live:streams`가 Redis에만 있어서, Redis가 재시작하면 방송 중인 스트림이
 * 피드에서 전부 사라진다. 되살려주는 이벤트는 `on-publish` 웹훅뿐인데
 * 그건 방송이 시작될 때만 오므로, 이미 송출 중인 사람은 영영 복구되지 않는다.
 * 자세한 근거는 domains/stream/services/reconcile-live.ts 주석에 있다.
 */
export async function register() {
  // Edge 런타임에는 Redis도 Postgres도 없다. Node 서버에서만 돈다.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { reconcileLiveStreams } = await import(
    '@/domains/stream/services/reconcile-live'
  );

  try {
    const result = await reconcileLiveStreams();
    if (result.skipped) {
      console.log('[Reconcile] 다른 인스턴스가 수행 중이라 건너뜀');
    }
  } catch (err) {
    // **기동을 막지 않는다.** 미디어 서버가 아직 안 떴을 수 있고,
    // 그 때문에 앱 전체가 안 뜨면 훨씬 나쁘다.
    // 재조정에 실패하면 피드는 그냥 예전처럼 비어 있을 뿐이다.
    console.error('[Reconcile] 기동 시 재조정 실패:', err);
  }
}
