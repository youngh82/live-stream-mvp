import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isLocale, type Locale } from './config';

/**
 * 요청마다 로케일을 정한다. 우선순위는 명시 > 추정이다.
 *
 * 1. 쿠키 — 사용자가 직접 고른 값. 다른 무엇보다 우선한다.
 * 2. `Accept-Language` — 고른 적이 없는 첫 방문자의 브라우저 설정.
 * 3. 기본값(ko).
 *
 * 2번이 있어야 영어권 방문자가 한국어 화면을 먼저 보고 이탈하지 않는다.
 */
async function resolveLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const accepted = (await headers()).get('accept-language');
  if (accepted) {
    // "en-US,en;q=0.9,ko;q=0.8" → ['en-us', 'en', 'ko']
    // q값 정렬까지 하지 않는 이유: 브라우저가 이미 선호 순으로 보낸다.
    const tags = accepted
      .split(',')
      .map((part) => part.split(';')[0].trim().toLowerCase())
      .filter(Boolean);

    for (const tag of tags) {
      // 'en-US'는 'en'으로 취급한다. 지역 변형을 따로 두지 않는다.
      const base = tag.split('-')[0];
      if (isLocale(base)) return base;
    }
  }

  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,

    /**
     * 이름 있는 날짜 포맷.
     *
     * next-intl에는 기본으로 딸려오는 이름이 없다 — 선언하지 않고
     * `format.dateTime(d, 'short')`를 부르면 MISSING_FORMAT으로 던진다.
     * 여기 한 곳에 두면 후원 내역·제재 목록·환전 내역의 날짜 표기가
     * 화면마다 어긋나지 않는다.
     */
    formats: {
      dateTime: {
        short: {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        },
        full: {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        },
      },
    },
  };
});

export { LOCALES };
