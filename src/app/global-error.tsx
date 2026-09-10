'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * 루트 레이아웃까지 무너졌을 때의 마지막 화면.
 *
 * 렌더 중 에러는 React가 삼켜서 전역 핸들러에 닿지 않는다 — 여기서 직접 보내야 한다.
 *
 * 루트 레이아웃을 대체하므로 next-intl 프로바이더가 없다. 그래서 문구를
 * messages/*.json에 두지 못하고 두 언어를 같이 적는다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-black p-6 text-center text-white">
        <p>문제가 생겼습니다. / Something went wrong.</p>
        <button
          onClick={reset}
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
        >
          다시 시도 / Try again
        </button>
      </body>
    </html>
  );
}
