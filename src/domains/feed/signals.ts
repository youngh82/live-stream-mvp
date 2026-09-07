/**
 * 취향 신호 공통 정의.
 *
 * 클라이언트와 서버가 같은 규칙을 봐야 해서 도메인에 둔다.
 */

export type SignalTargetType = 'stream' | 'post';

export type SignalKind =
  | 'impression' // 화면에 떴다
  | 'dwell' // 머문 시간
  | 'skip' // 짧게 보고 넘김
  | 'chat'
  | 'donation'
  | 'follow'
  | 'profile';

export interface FeedSignal {
  targetType: SignalTargetType;
  targetId: string;
  kind: SignalKind;
  dwellMs?: number;
  category?: string | null;
}

/**
 * 체류 시간 상한.
 *
 * **클라이언트가 보내는 값이라 위조된다.** 상한을 API와 DB 양쪽에 건다.
 * 이 신호는 랭킹에만 쓰고 정산·수익에는 절대 쓰지 않는다 —
 * 조회수로 돈이 나가는 구조가 되는 순간 봇이 붙는다.
 */
export const MAX_DWELL_MS = 300_000;

/** 이보다 짧게 보고 넘기면 관심 없음(skip)으로 본다 */
export const SKIP_THRESHOLD_MS = 2_000;

/** 한 번에 보낼 수 있는 이벤트 수 */
export const MAX_BATCH = 50;

export const SIGNAL_KINDS: readonly SignalKind[] = [
  'impression',
  'dwell',
  'skip',
  'chat',
  'donation',
  'follow',
  'profile',
] as const;
