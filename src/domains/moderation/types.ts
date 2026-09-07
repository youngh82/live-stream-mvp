export type ModerationAction = 'timeout' | 'ban' | 'unban' | 'delete_message';

export interface ChannelBan {
  channel_id: string;
  user_id: string;
  /** null이면 영구 */
  expires_at: string | null;
  reason: string | null;
  created_at: string;
}

export interface ChannelSettings {
  channel_id: string;
  slow_mode_sec: number;
  followers_only: boolean;
  banned_words: string[];
}

/**
 * 제재 이벤트 채널.
 *
 * 제재 API가 DB 커밋 후 발행하고, 채팅 서버가 구독해서 즉시 반영한다.
 * 이게 없으면 이미 접속해 있는 사람은 재접속 전까지 계속 떠들 수 있다.
 *
 * 다중 서버를 가정한다 — 채팅 서버는 이미 Redis Pub/Sub 어댑터를 쓰므로
 * 제재도 같은 경로로 흘려야 한 대에만 적용되는 사고가 없다.
 */
export const MODERATION_EVENTS_CHANNEL = 'mod:events';

export type ModerationEvent =
  | {
      type: 'ban';
      channelId: string;
      targetId: string;
      /** null이면 영구 */
      expiresAt: string | null;
      reason: string | null;
    }
  | { type: 'unban'; channelId: string; targetId: string }
  | { type: 'delete_message'; channelId: string; streamId: string; messageId: string }
  | { type: 'settings'; channelId: string };

/**
 * 차단 상태 캐시 키.
 *
 * **Redis는 캐시고 DB가 진실이다.** 캐시 미스(재시작·eviction)에서는
 * DB를 조회해 다시 채운다. 반대로 하면 Redis가 날아갈 때 영구 차단이 풀린다.
 *
 * 값: 'perm' = 영구 / 그 외 = 만료 시각(ms). TTL이 타임아웃 만료를 대신
 * 처리하므로 별도 크론이 필요 없다.
 */
export function banKey(channelId: string, userId: string): string {
  return `ban:${channelId}:${userId}`;
}

/** 캐시 미스와 "차단 없음"을 구분하기 위한 표식 */
export const BAN_NONE = 'none';
export const BAN_PERMANENT = 'perm';
/** "차단 없음"을 캐싱해두는 시간. 매 메시지마다 DB를 때리지 않기 위한 것 */
export const BAN_NEGATIVE_TTL_SEC = 60;

/**
 * 제재 기간 선택지. 초 단위이고, `null`은 영구다.
 *
 * 라벨을 같이 들고 있지 않는 이유: "30초"·"1시간" 같은 문구는 언어마다
 * 단위와 복수형이 달라서 상수에 박아두면 번역할 수 없다. 값만 두고
 * 표시는 `useDurationLabel`이 사전의 복수형 규칙으로 만든다.
 */
export const TIMEOUT_PRESETS = [30, 300, 600, 3600] as const;

export const BAN_PRESETS = [86400, 604800, 2592000, null] as const;

export const MAX_BANNED_WORDS = 50;
export const MAX_BANNED_WORD_LENGTH = 30;

/**
 * 신고 사유.
 *
 * **화면에 보이는 문구가 아니라 이 코드가 DB에 저장된다.**
 * 신고자의 언어로 된 문장을 저장하면 운영자의 신고 큐에 여러 언어가 섞이고,
 * "같은 사유로 몇 명이 신고했나"를 세는 것도 문자열 비교라 언어가 갈리는
 * 순간 깨진다. `Category.id`를 고정한 것과 같은 이유다 — **바꾸지 말 것.**
 *
 * 표시 문구는 `report.reason_<code>` 메시지에 있다.
 */
export const REPORT_REASONS = [
  'sexual',
  'violence',
  'harassment',
  'illegal',
  'copyright',
  'minor',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
