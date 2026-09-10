import * as Sentry from '@sentry/node';

/**
 * 채팅 서버·썸네일 워커의 에러 수집.
 *
 * **import 시점이 아니라 호출 시점에 초기화한다.** import는 호이스팅되어
 * `config({ path: '.env.local' })`보다 먼저 실행되므로, 여기서 바로 env를 읽으면
 * 로컬에서는 DSN이 늘 비어 보인다.
 *
 * DSN이 없으면 아무것도 하지 않는다 — 개발 환경과 CI는 그대로 돈다.
 *
 * `console.error`를 이벤트로 올린다. 서버 코드는 대부분 에러를 잡아서 로그만
 * 남기고 계속 도는 구조라, 잡히지 않은 예외만 수집하면 실제 장애의 대부분을 놓친다.
 */
export function initServerSentry(serverName: 'chat' | 'thumbnailer') {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    serverName,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    // 성능 추적은 끈다. 무료 한도를 에러에만 쓴다.
    tracesSampleRate: 0,
    integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
  });
}
