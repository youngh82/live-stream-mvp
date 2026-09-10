import * as Sentry from '@sentry/nextjs';

/**
 * 브라우저 에러 수집. Next가 앱 코드보다 먼저 실행한다.
 *
 * DSN은 빌드 시점에 번들에 박힌다 (NEXT_PUBLIC_*). 공개 값이라 비밀이 아니다.
 * 없으면 초기화하지 않는다 — 개발 환경과 CI는 그대로 돈다.
 *
 * 서버와 달리 console.error는 올리지 않는다. 브라우저에는 React 경고·확장 프로그램
 * 로그가 섞여서 무료 한도를 소음으로 다 쓴다.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
