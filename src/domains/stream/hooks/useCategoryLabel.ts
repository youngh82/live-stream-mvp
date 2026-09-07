'use client';

import { useTranslations } from 'next-intl';
import { isValidCategory } from '@/domains/stream/categories';

/**
 * 카테고리 id를 화면에 보여줄 이름으로 바꾼다.
 *
 * **id는 번역하지 않는다.** DB에 저장되는 값이자 취향 점수(user_taste.category)의
 * 키라서 언어에 따라 달라지면 안 된다 (categories.ts 주석 참고).
 * 번역되는 것은 표시 이름뿐이다.
 *
 * 사전에 없는 id — 나중에 카테고리를 추가하고 번역을 빠뜨린 경우 — 는
 * id를 그대로 보여준다. 빈 칸이 뜨는 것보다 낫다.
 */
export function useCategoryLabel() {
  const t = useTranslations('category');

  return (id: string | null | undefined): string | null => {
    if (!id) return null;
    return isValidCategory(id) ? t(id) : id;
  };
}
