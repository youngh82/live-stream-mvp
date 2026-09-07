/**
 * 로케일 설정.
 *
 * **URL에 로케일 프리픽스를 두지 않는다.** `/en/stream/[id]` 같은 형태로 가면
 * 이미 공유된 링크와 OG 메타(`generateMetadata`의 절대 URL)가 로케일마다 갈라지고,
 * 앱 전체의 `router.push('/feed')`를 전부 로케일 인식 링크로 바꿔야 한다.
 * 대신 쿠키 하나로 결정한다 — URL은 그대로 하나로 유지된다.
 *
 * 대가: 같은 URL이 사람마다 다른 언어로 렌더된다. 그래서 언어에 의존하는
 * 페이지는 캐시하면 안 된다(현재 전부 동적 렌더라 문제되지 않는다).
 */
export const LOCALES = ['ko', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ko';

/** 사용자가 직접 고른 언어를 담는 쿠키. 고르기 전에는 존재하지 않는다. */
export const LOCALE_COOKIE = 'locale';

/** 1년. 언어 선택은 자주 바뀌지 않으므로 길게 잡는다. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** 언어 전환 UI에 쓰는 표시 이름. 각 언어는 자기 이름으로 적는다. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ko: '한국어',
  en: 'English',
};
