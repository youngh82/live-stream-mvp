'use client';

import { useTranslations } from 'next-intl';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/**
 * 제재 기간(초)을 사람이 읽는 문구로.
 *
 * 단위를 나누는 기준은 "나누어떨어지는 가장 큰 단위"다. 3600초를
 * "60분"이라고 쓰면 버튼이 길어지기만 하고 읽히지는 않는다.
 * 복수형은 언어마다 규칙이 달라 사전의 ICU plural에 맡긴다.
 */
export function useDurationLabel() {
  const t = useTranslations('moderation');

  return (seconds: number | null): string => {
    if (seconds === null) return t('durationPermanent');
    if (seconds >= DAY) return t('durationDays', { count: seconds / DAY });
    if (seconds >= HOUR) return t('durationHours', { count: seconds / HOUR });
    if (seconds >= MINUTE)
      return t('durationMinutes', { count: seconds / MINUTE });
    return t('durationSeconds', { count: seconds });
  };
}
