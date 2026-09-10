import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublishing, isStopped, kickPublisher } from './media-server';

/**
 * 송출 여부는 **연결 목록 API로만** 확인해야 한다. 경로 API(`paths/get`,
 * `paths/list`)는 그 경로의 송출 인증이 진행 중일 때 막혀서, 재접속하는 방송자가
 * 거절당했다 (ISSUES #32).
 */

type Item = { id: string; path?: string; state?: string };

/** 엔드포인트별 가짜 응답. 없는 엔드포인트는 꺼진 프로토콜처럼 404 */
function mockApi(byEndpoint: Record<string, Item[]>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const m = /\/v3\/(\w+)\/(list|kick)/.exec(url);
    if (m?.[2] === 'kick') return new Response('', { status: 200 });
    const items = m && byEndpoint[m[1]];
    if (!items) return new Response('', { status: 404 });
    return new Response(JSON.stringify({ items }), { status: 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('isPublishing', () => {
  it('어느 프로토콜이든 state=publish인 연결이 있으면 송출 중이다', async () => {
    mockApi({ rtmpconns: [], webrtcsessions: [{ id: '1', path: 'a', state: 'publish' }] });
    expect(await isPublishing('a')).toBe(true);
  });

  it('시청 중이거나 인증 대기 중인 연결은 송출로 치지 않는다', async () => {
    mockApi({
      rtmpconns: [{ id: '1', path: 'a', state: 'idle' }],
      webrtcsessions: [{ id: '2', path: 'a', state: 'read' }],
    });
    expect(await isPublishing('a')).toBe(false);
  });

  it('경로 API(paths/*)를 부르지 않는다', async () => {
    const calls = mockApi({ rtmpconns: [{ id: '1', path: 'a', state: 'publish' }] });
    await isPublishing('a');
    expect(calls.some((c) => c.includes('/v3/paths/'))).toBe(false);
  });

  it('미디어 서버에 닿지 못하면 던진다 — 인증은 보수적으로 거절한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(isPublishing('a')).rejects.toThrow();
  });
});

describe('isStopped', () => {
  it('isPublishing의 반대다', async () => {
    mockApi({ rtmpconns: [{ id: '1', path: 'a', state: 'publish' }] });
    expect(await isStopped('a')).toBe(false);
    expect(await isStopped('b')).toBe(true);
  });
});

describe('kickPublisher', () => {
  it('그 경로의 송출 연결만 끊는다', async () => {
    const calls = mockApi({
      rtmpconns: [
        { id: 'pub', path: 'a', state: 'publish' },
        { id: 'other', path: 'b', state: 'publish' },
      ],
      webrtcsessions: [{ id: 'viewer', path: 'a', state: 'read' }],
    });
    expect(await kickPublisher('a')).toBe(1);
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([
      expect.stringContaining('/v3/rtmpconns/kick/pub'),
    ]);
  });
});
