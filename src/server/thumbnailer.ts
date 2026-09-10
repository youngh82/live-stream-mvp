import { config } from 'dotenv';
config({ path: '.env.local' });
import { initServerSentry } from './sentry';
initServerSentry('thumbnailer');

import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import Redis from 'ioredis';

/**
 * 썸네일 생성 워커.
 *
 * 라이브 중인 방송에서 주기적으로 한 프레임을 떠서 Supabase Storage에 올리고
 * `streams.thumbnail_url`을 갱신한다. 피드·탐색·검색·공유 OG 이미지가 전부
 * 이 값을 쓴다.
 *
 * **왜 별도 프로세스인가**: ffmpeg는 초 단위로 도는 무거운 작업이라
 * Next.js 요청 경로에 두면 API 응답이 그만큼 늦어진다. 채팅 서버와 같은
 * 이유로 프로세스를 분리한다.
 *
 * **왜 HLS를 읽는가**: MediaMTX는 스냅샷 API를 제공하지 않는다. RTSP를 켜는
 * 방법도 있지만 미디어 설정을 건드리면 보안 회귀 검사 범위가 넓어진다.
 * HLS는 이미 `hlsAlwaysRemux: true`로 항상 켜져 있고 재생 인증도 공개라
 * (`/api/stream/auth`의 read 분기) 설정 변경 없이 바로 읽을 수 있다.
 */

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const HLS_INTERNAL =
  process.env.MEDIA_HLS_INTERNAL_URL || 'http://127.0.0.1:8890';
const BUCKET = 'thumbnails';

/** 한 바퀴 도는 주기 */
const INTERVAL_MS = parseInt(process.env.THUMBNAIL_INTERVAL_MS || '30000');
/** ffmpeg 한 건이 이 시간을 넘기면 포기한다 */
const FFMPEG_TIMEOUT_MS = 15000;
/** 동시에 돌리는 ffmpeg 수. 라이브가 많아도 CPU를 다 먹지 않게 한다 */
const CONCURRENCY = parseInt(process.env.THUMBNAIL_CONCURRENCY || '3');
/** 세로 9:16 기준. 목록 카드에 쓰는 크기라 크게 뽑을 이유가 없다 */
const WIDTH = 360;

const redis = new Redis(REDIS_URL);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * HLS에서 한 프레임을 떠 JPEG 버퍼로 반환한다.
 *
 * 방송이 막 시작해 세그먼트가 아직 없거나, 오디오만 나가는 중이면 실패한다.
 * 실패는 정상적인 상황이라 다음 주기에 다시 시도할 뿐 에러로 취급하지 않는다.
 */
function grabFrame(streamId: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-loglevel', 'error',
      // LL-HLS는 파트 단위로 갱신된다. 라이브 엣지에서 바로 받도록.
      '-i', `${HLS_INTERNAL}/${streamId}/index.m3u8`,
      '-frames:v', '1',
      '-vf', `scale=${WIDTH}:-2`,
      '-q:v', '4',
      '-f', 'image2',
      '-',
    ]);

    const chunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ff.kill('SIGKILL');
      resolve(null);
    }, FFMPEG_TIMEOUT_MS);

    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    // stderr를 흘려보내지 않으면 파이프 버퍼가 차서 ffmpeg가 멈춘다
    ff.stderr.on('data', () => {});

    ff.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });

    ff.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      resolve(code === 0 && buf.length > 0 ? buf : null);
    });
  });
}

async function updateThumbnail(streamId: string): Promise<boolean> {
  const frame = await grabFrame(streamId);
  if (!frame) return false;

  const path = `${streamId}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, frame, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '60',
    });

  if (uploadError) {
    console.error('[Thumbnail] 업로드 실패', streamId, uploadError.message);
    return false;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // 파일 경로가 고정이라 URL도 고정이다. 쿼리로 버전을 붙이지 않으면
  // 브라우저·CDN이 첫 썸네일을 계속 보여준다.
  const versioned = `${publicUrl}?v=${Date.now()}`;

  const { error } = await supabase
    .from('streams')
    .update({ thumbnail_url: versioned })
    .eq('id', streamId)
    .eq('status', 'live');

  if (error) {
    console.error('[Thumbnail] DB 갱신 실패', streamId, error.message);
    return false;
  }

  return true;
}

/** 동시 실행 수를 제한하며 전부 처리한다 */
async function runPool(ids: string[]) {
  let index = 0;
  let ok = 0;

  async function worker() {
    while (index < ids.length) {
      const id = ids[index++];
      if (await updateThumbnail(id)) ok++;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker),
  );
  return ok;
}

async function tick() {
  try {
    // 라이브 목록의 단일 출처는 피드와 같은 Redis ZSET이다.
    // DB status로 읽으면 on-unpublish 웹훅이 유실됐을 때 유령 방송을 계속 뜬다.
    const ids = await redis.zrevrange('live:streams', 0, -1);
    if (ids.length === 0) return;

    const ok = await runPool(ids);
    console.log(`[Thumbnail] ${ok}/${ids.length} 갱신`);
  } catch (err) {
    console.error('[Thumbnail] tick 실패:', err);
  }
}

async function main() {
  // ffmpeg가 없으면 조용히 아무것도 안 하는 대신 바로 알린다
  const probe = spawn('ffmpeg', ['-version']);
  probe.on('error', () => {
    console.error('[Thumbnail] ffmpeg를 찾을 수 없습니다. `brew install ffmpeg`');
    process.exit(1);
  });
  probe.stdout.on('data', () => {});

  console.log(`[Thumbnail] 시작 (${INTERVAL_MS}ms 주기, HLS ${HLS_INTERNAL})`);

  // setInterval은 앞 tick이 늦어지면 겹친다. 끝난 뒤에 다음 것을 잡는다.
  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    redis.quit().finally(() => process.exit(0));
  });
}

main();
