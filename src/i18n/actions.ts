'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from './config';

/**
 * 언어를 바꾼다.
 *
 * 쿠키만 쓰고 DB에는 저장하지 않는다. 언어는 "이 브라우저에서 어떻게 읽고 싶은가"라
 * 계정 속성이 아니다 — 회사 PC는 영어, 폰은 한국어인 사람이 흔하다.
 * 계정에 묶으면 기기를 옮길 때마다 원치 않는 언어가 따라온다.
 *
 * 호출한 쪽에서 `router.refresh()`를 해야 서버 컴포넌트가 새 로케일로 다시 그려진다.
 */
export async function setLocale(value: string) {
  if (!isLocale(value)) return;

  (await cookies()).set(LOCALE_COOKIE, value, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
  });
}
