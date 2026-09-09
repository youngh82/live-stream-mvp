/**
 * MediaMTX 관리 API 클라이언트.
 *
 * on-publish / on-unpublish 웹훅은 공개 엔드포인트라 누구나 호출할 수 있다.
 * 공유 시크릿 대신 미디어 서버에 "정말 송출 중인가?"를 되물어 확인한다.
 * 공격자는 stream_key 없이 경로를 ready 상태로 만들 수 없으므로
 * 이 확인만으로 위조 웹훅이 차단된다.
 */

const API_BASE = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';

interface PathInfo {
  name: string;
  ready: boolean;
  readyTime: string | null;
  tracks: string[];
}

async function getPath(path: string): Promise<PathInfo | null> {
  try {
    const res = await fetch(
      `${API_BASE}/v3/paths/get/${encodeURIComponent(path)}`,
      { signal: AbortSignal.timeout(3000), cache: 'no-store' },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`MediaMTX API ${res.status}`);
    return (await res.json()) as PathInfo;
  } catch (err) {
    console.error('[MediaMTX] API 조회 실패:', err);
    throw err;
  }
}

/** 해당 경로가 실제로 송출 중인지 확인 */
export async function isPublishing(path: string): Promise<boolean> {
  const info = await getPath(path);
  return info?.ready === true;
}

/** 해당 경로의 송출이 실제로 끝났는지 확인 */
export async function isStopped(path: string): Promise<boolean> {
  const info = await getPath(path);
  return info === null || info.ready === false;
}

/**
 * 송출 세션 강제 종료.
 *
 * **`streams.status`만 'ended'로 바꾸면 화면에서만 사라지고 송출은 계속된다.**
 * 목록에서 안 보일 뿐 URL을 아는 사람은 그대로 본다. 운영자가 방송을 내릴 때는
 * 미디어 서버의 세션을 실제로 끊어야 한다.
 *
 * MediaMTX에는 "경로를 끊는" API가 없다. 프로토콜별 연결 목록에서 해당 경로를
 * 찾아 하나씩 kick한다. 방송자는 여러 프로토콜 중 하나로 들어와 있으므로
 * 전부 훑는다.
 */
const PUBLISH_ENDPOINTS = [
  'rtmpconns',
  'webrtcsessions',
  'rtspsessions',
  'srtconns',
] as const;

interface SessionItem {
  id: string;
  path?: string;
  state?: string;
}

export async function kickPublisher(path: string): Promise<number> {
  let kicked = 0;

  for (const endpoint of PUBLISH_ENDPOINTS) {
    try {
      const res = await fetch(`${API_BASE}/v3/${endpoint}/list`, {
        signal: AbortSignal.timeout(3000),
        cache: 'no-store',
      });
      if (!res.ok) continue;

      const { items } = (await res.json()) as { items?: SessionItem[] };

      for (const item of items ?? []) {
        if (item.path !== path) continue;
        // 시청자까지 끊을 필요는 없다. 송출이 끊기면 알아서 끝난다.
        if (item.state && item.state !== 'publish') continue;

        const kickRes = await fetch(
          `${API_BASE}/v3/${endpoint}/kick/${encodeURIComponent(item.id)}`,
          { method: 'POST', signal: AbortSignal.timeout(3000) },
        );
        if (kickRes.ok) kicked++;
      }
    } catch (err) {
      // 한 프로토콜이 실패해도 나머지는 시도한다
      console.error(`[MediaMTX] ${endpoint} kick 실패:`, err);
    }
  }

  return kicked;
}

/** 지금 실제로 송출 중인 경로 하나 */
export interface PublishingPath {
  /** 경로 이름 = streams.id */
  name: string;
  /** MediaMTX가 이 경로를 ready로 본 시각. 없을 수 있다 */
  readyTime: string | null;
}

/**
 * 지금 송출 중인 모든 경로.
 *
 * 재조정(reconcile-live.ts)의 기준이 되는 **유일한 진실**이다.
 * Redis도 Postgres도 웹훅을 받아 적은 사본일 뿐이고, 웹훅은 유실될 수 있다.
 *
 * 페이지네이션이 있다. 기본 페이지 크기를 넘기면 나머지를 조용히 놓치고,
 * 그러면 멀쩡히 방송 중인 사람이 재조정 후 피드에서 사라진다.
 */
export async function listPublishingPaths(): Promise<PublishingPath[]> {
  const found: PublishingPath[] = [];
  const perPage = 500;

  for (let page = 0; ; page++) {
    const res = await fetch(
      `${API_BASE}/v3/paths/list?page=${page}&itemsPerPage=${perPage}`,
      { signal: AbortSignal.timeout(5000), cache: 'no-store' },
    );
    if (!res.ok) throw new Error(`MediaMTX API ${res.status}`);

    const body = (await res.json()) as {
      pageCount?: number;
      items?: Array<{ name?: string; ready?: boolean; readyTime?: string | null }>;
    };

    for (const item of body.items ?? []) {
      if (item.ready !== true || !item.name) continue;
      found.push({ name: item.name, readyTime: item.readyTime ?? null });
    }

    if (page + 1 >= (body.pageCount ?? 1)) break;
  }

  return found;
}
