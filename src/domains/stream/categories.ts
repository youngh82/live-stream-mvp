/**
 * 방송 카테고리 마스터 목록.
 *
 * **자유 텍스트를 쓰지 않는 이유**: 오타 하나로 분류가 갈라진다.
 * "게임"과 "게임 "과 "겜"이 각각 다른 카테고리가 되면 탐색 화면의 칩도,
 * 취향 학습의 축(user_taste.category)도 전부 무의미해진다.
 *
 * 세부 주제는 `streams.tags`(자유 입력)가 담당한다. 카테고리는 큰 칸막이만 만든다.
 *
 * **id는 바꾸지 말 것.** DB에 저장되는 값이고 취향 점수의 키다.
 * 표시 이름만 바꾸려면 label을 고친다.
 */
export interface Category {
  id: string;
  label: string;
  emoji: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: 'game', label: '게임', emoji: '🎮' },
  { id: 'talk', label: '토크', emoji: '💬' },
  { id: 'music', label: '음악', emoji: '🎵' },
  { id: 'food', label: '먹방', emoji: '🍜' },
  { id: 'sports', label: '스포츠', emoji: '⚽' },
  { id: 'study', label: '공부', emoji: '📚' },
  { id: 'art', label: '그림·창작', emoji: '🎨' },
  { id: 'daily', label: '일상', emoji: '🌤️' },
  { id: 'etc', label: '기타', emoji: '✨' },
] as const;

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function isValidCategory(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

export function getCategory(id: string | null | undefined): Category | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

/** 표시용. 모르는 값(예전 자유 입력)이 들어와도 화면이 깨지지 않게 한다 */
export function categoryLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return BY_ID.get(id)?.label ?? id;
}

/** 태그는 자유 입력이지만 무한정은 아니다 */
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 20;
