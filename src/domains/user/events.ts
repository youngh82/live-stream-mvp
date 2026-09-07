/**
 * 팔로우 알림 채널.
 *
 * `/api/stream/on-publish`가 방송 시작을 발행하고, 채팅 서버가 구독해서
 * 팔로워들의 `user:{id}` 룸으로 전달한다.
 *
 * **웹훅 안에서 팔로워를 순회하지 않는 것이 핵심이다.** 팔로워가 1만 명이면
 * 그 순회가 on-publish 응답을 붙잡고, MediaMTX는 웹훅 타임아웃을 송출 실패로
 * 취급한다. 즉 인기 방송자일수록 방송이 안 켜지는 사고가 난다.
 * 웹훅은 이벤트 하나만 던지고 즉시 200을 준다.
 */
export const LIVE_EVENTS_CHANNEL = 'follow:live_events';

export interface LiveStartedEvent {
  streamId: string;
  streamerId: string;
  nickname: string;
  avatarUrl: string | null;
  title: string;
}
