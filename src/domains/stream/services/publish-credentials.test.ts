import { describe, expect, it } from 'vitest';
import { suppliedStreamKey } from './publish-credentials';

const KEY = '3f2b6c1e-9a4d-4e8b-b7c2-1d0e5f6a7b8c';

describe('suppliedStreamKey', () => {
  it('RTMP 쿼리와 브라우저 WHIP(Basic)는 password로 온다', () => {
    expect(suppliedStreamKey({ password: KEY })).toBe(KEY);
  });

  it('OBS WHIP(Bearer)는 token으로 온다', () => {
    expect(suppliedStreamKey({ token: KEY })).toBe(KEY);
  });

  it('MediaMTX가 빈 password를 함께 보내도 token을 쓴다', () => {
    expect(suppliedStreamKey({ password: '', token: KEY })).toBe(KEY);
  });

  it('둘 다 있으면 password가 우선한다 — 기존 경로의 동작을 바꾸지 않는다', () => {
    expect(suppliedStreamKey({ password: KEY, token: 'other' })).toBe(KEY);
  });

  it('아무것도 없으면 빈 문자열 — 호출부의 형식 검사에서 거부된다', () => {
    expect(suppliedStreamKey({})).toBe('');
  });
});
