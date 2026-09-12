/**
 * 송출 인증 요청에서 stream_key를 꺼낸다.
 *
 * 클라이언트마다 키를 싣는 자리가 다르고, MediaMTX는 그걸 인증 요청의
 * 서로 다른 필드로 넘긴다:
 *
 *   RTMP  (OBS 기본)        rtmp://…/<id>?user=streamer&pass=<key>  → password
 *   WHIP  (모바일 브라우저)  Authorization: Basic streamer:<key>      → password
 *   WHIP  (OBS 30+)          Authorization: Bearer <key>              → token
 *
 * **OBS의 WHIP 설정에는 Bearer Token 칸 하나뿐이다.** 사용자명·비밀번호를 줄
 * 방법이 없어서, token을 보지 않으면 OBS WHIP 송출은 전부 401이 된다.
 * RTMP는 AAC 오디오를 보내는데 WebRTC 시청자는 AAC를 재생하지 못한다 —
 * OBS로 소리까지 내보내려면 WHIP(Opus)가 필요하다 (ISSUES U-1).
 *
 * 둘 다 있으면 password가 우선한다. 기존 두 경로의 동작을 바꾸지 않기 위해서다.
 * 형식 검증(UUID)은 호출하는 쪽이 한다.
 */
export function suppliedStreamKey(body: {
  password?: string;
  token?: string;
}): string {
  return body.password || body.token || '';
}
