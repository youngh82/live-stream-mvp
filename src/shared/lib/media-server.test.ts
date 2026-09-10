import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublishing, isStopped } from './media-server';

/**
 * 송출 여부 확인은 **목록 API로만** 해야 한다. `paths/get/<경로>`는 그 경로의
 * 송출 인증이 진행 중일 때 막혀서, 재접속하는 방송자가 거절당했다 (ISSUES #32).
 */

function mockPaths(items: Array<{ name: string; ready: boolean }>, pageCount = 1) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ pageCount, items }), { status: 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('isPublishing', () => {
  it('목록에 ready로 있으면 송출 중이다', async () => {
    mockPaths([{ name: 'a', ready: true }]);
    expect(await isPublishing('a')).toBe(true);
  });

  it('목록에 없거나 ready가 아니면 송출 중이 아니다', async () => {
    mockPaths([{ name: 'a', ready: false }, { name: 'b', ready: true }]);
    expect(await isPublishing('a')).toBe(false);
    expect(await isPublishing('c')).toBe(false);
  });

  it('경로별 조회(paths/get)를 부르지 않는다', async () => {
    const calls = mockPaths([{ name: 'a', ready: true }]);
    await isPublishing('a');
    expect(calls.every((u) => u.includes('/v3/paths/list'))).toBe(true);
  });

  it('조회에 실패하면 던진다 — 호출하는 쪽이 보수적으로 판단한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(isPublishing('a')).rejects.toThrow();
  });
});

describe('isStopped', () => {
  it('isPublishing의 반대다', async () => {
    mockPaths([{ name: 'a', ready: true }]);
    expect(await isStopped('a')).toBe(false);
    expect(await isStopped('b')).toBe(true);
  });
});
