'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { setLocale } from '@/i18n/actions';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/config';

/**
 * 언어 전환.
 *
 * 로케일이 URL이 아니라 쿠키에 있으므로(i18n/config.ts 참고) 링크로는 바꿀 수
 * 없다. 서버 액션으로 쿠키를 쓰고 `router.refresh()`로 서버 컴포넌트를 다시
 * 그린다 — 새로고침 없이 화면 언어가 바뀐다.
 *
 * 전환 중에는 `isPending`으로 흐리게 처리한다. 액션 왕복이 끝나기 전에는
 * 라벨이 이전 언어 그대로라, 표시가 없으면 버튼이 먹히지 않은 것처럼 보인다.
 */
export function LanguageSwitcher() {
  const t = useTranslations('settings');
  const active = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === active) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-gray-400">
        <Languages className="h-4 w-4" />
        {t('language')}
      </span>

      <div
        className={`flex items-center gap-1 rounded-full bg-gray-800 p-1 transition-opacity ${
          isPending ? 'opacity-50' : ''
        }`}
      >
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            onClick={() => choose(locale)}
            disabled={isPending}
            aria-pressed={locale === active}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              locale === active
                ? 'bg-white text-black'
                : 'text-gray-300 hover:text-white'
            }`}
          >
            {LOCALE_LABELS[locale]}
          </button>
        ))}
      </div>
    </div>
  );
}
