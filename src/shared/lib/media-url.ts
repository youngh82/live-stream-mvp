/**
 * 미디어 URL 생성.
 *
 * MediaMTX 경로 이름은 streams.id다. 이전에는 stream_key였기 때문에
 * WHEP URL을 내려주는 것만으로 송출 비밀이 전부 노출됐다 (C-04).
 */

const WHEP_BASE =
  process.env.NEXT_PUBLIC_WHEP_BASE_URL || 'http://localhost:8891';
const HLS_BASE =
  process.env.NEXT_PUBLIC_HLS_BASE_URL || 'http://localhost:8890';

export function whepUrlFor(streamId: string): string {
  return `${WHEP_BASE}/${streamId}/whep`;
}

/** 모바일 웹 방송(WHIP) 송출 엔드포인트 */
export function whipUrlFor(streamId: string): string {
  return `${WHEP_BASE}/${streamId}/whip`;
}

export function hlsUrlFor(streamId: string): string {
  return `${HLS_BASE}/${streamId}/index.m3u8`;
}
