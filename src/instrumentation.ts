import * as Sentry from '@sentry/nextjs';

/**
 * 서버 컴포넌트·라우트 핸들러에서 잡히지 않은 에러를 Sentry로 보낸다.
 * DSN이 없으면 init이 안 되어 있어서 아무 일도 하지 않는다.
 */
export const onRequestError = Sentry.captureRequestError;

/**
 * 서버 기동 시 한 번 실행된다 (Next.js instrumentation hook).
 *
 * 하는 일은 둘이다: Sentry 초기화, 그리고 **라이브 목록 재조정**.
 * `live:streams`가 Redis에만 있어서, Redis가 재시작하면 방송 중인 스트림이
 * 피드에서 전부 사라진다. 되살려주는 이벤트는 `on-publish` 웹훅뿐인데
 * 그건 방송이 시작될 때만 오므로, 이미 송출 중인 사람은 영영 복구되지 않는다.
 * 자세한 근거는 domains/stream/services/reconcile-live.ts 주석에 있다.
 */
export async function register() {
  // Edge 런타임에는 Redis도 Postgres도 없다. Node 서버에서만 돈다.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // 재조정보다 먼저 — 기동 중 에러도 잡혀야 한다.
  // console.error를 이벤트로 올리는 이유는 src/server/sentry.ts 주석과 같다.
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      serverName: 'app',
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
      tracesSampleRate: 0,
      integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
    });
  }

  const { reconcileLiveStreams } = await import(
    '@/domains/stream/services/reconcile-live'
  );

  // **기동을 막지 않는다 — await하지 않는다.** Next는 register()가 끝나야 요청을
  // 받는데, Redis가 죽어 있으면 ioredis가 명령을 큐에 쌓고 연결될 때까지
  // 영원히 기다린다. await하면 앱 전체가(/api/health까지) 응답하지 않는다.
  // 재조정에 실패하면 피드는 그냥 예전처럼 비어 있을 뿐이다.
  reconcileLiveStreams()
    .then((result) => {
      if (result.skipped) {
        console.log('[Reconcile] 다른 인스턴스가 수행 중이라 건너뜀');
      }
    })
    .catch((err) => {
      console.error('[Reconcile] 기동 시 재조정 실패:', err);
    });
}
