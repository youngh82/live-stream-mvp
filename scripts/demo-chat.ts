/**
 * 데모 채팅 참가자 (README 스크린샷·GIF용).
 *
 * `seed-demo.ts`가 만든 계정으로 로그인해 소켓에 붙고, 지정한 방송에
 * 사람처럼 띄엄띄엄 메시지를 보낸다. 스크린샷의 채팅창이 한 사람이
 * 혼잣말하는 화면이 되지 않게 하기 위한 것이다.
 *
 * **실제 로그인을 하는 이유**: 채팅 서버가 Supabase JWKS로 서명을
 * 검증하므로(`src/server/chat.ts`) 토큰을 직접 만들어 낼 수 없다.
 * 비밀번호는 `seed-demo.ts`가 실행마다 새로 만들어 `.demo-streams`에
 * 적어두며, 이 파일은 gitignore 대상이다.
 *
 *   npx tsx scripts/demo-chat.ts <streamId> [초]
 *   npx tsx scripts/demo-chat.ts --first     # 첫 번째 데모 방송에 붙는다
 */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { io, type Socket } from 'socket.io-client';
import { config } from 'dotenv';

config({ path: '.env.local' });

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!WS_URL || !SUPABASE_URL || !ANON_KEY) {
  console.error('NEXT_PUBLIC_WS_URL / SUPABASE_URL / ANON_KEY 가 필요하다');
  process.exit(1);
}

/** 방송별로 어울리는 대사. 순서대로 돌아가며 보낸다. */
const LINES = [
  'yooo this beat',
  'first time here, love the vibe',
  'where are you streaming from?',
  'the timer is so satisfying lol',
  'been lurking for 20 min, finally saying hi',
  'can you turn the mic up a bit?',
  'this is exactly what i needed today',
  'gg',
  'how long have you been doing this?',
  'ok that was clean',
  'brb making coffee, keep going',
  'the vertical layout actually works really well',
];

interface DemoUser {
  nickname: string;
  streamId: string;
}

async function loadManifest() {
  const text = await readFile('.demo-streams', 'utf8').catch(() => {
    console.error('.demo-streams 이 없다. 먼저: npx tsx scripts/seed-demo.ts');
    process.exit(1);
  });

  let password = '';
  let domain = '';
  const users: DemoUser[] = [];

  for (const line of (text as string).split('\n')) {
    if (!line.trim()) continue;
    const [a, b] = line.split('\t');
    if (a === '# password') password = b;
    else if (a === '# domain') domain = b;
    else users.push({ nickname: a, streamId: b });
  }

  return { password, domain, users };
}

async function connect(
  nickname: string,
  email: string,
  password: string,
  streamId: string,
): Promise<Socket | null> {
  const supabase = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    console.error(`  ✗ ${nickname}: ${error?.message ?? 'no session'}`);
    return null;
  }

  const socket = io(WS_URL!, {
    auth: { token: data.session.access_token },
    reconnection: false,
    // 채팅 서버는 mkcert로 발급한 개발 인증서를 쓴다. Node의 기본 신뢰
    // 저장소에는 그 루트가 없으므로 이 연결에 한해서만 검증을 끈다.
    // 프로세스 전역(NODE_TLS_REJECT_UNAUTHORIZED)으로 끄면 같은 스크립트가
    // 하는 Supabase 로그인까지 검증 없이 나간다.
    rejectUnauthorized: false,
  } as Parameters<typeof io>[1]);

  return new Promise((resolve) => {
    socket.on('connect', () => {
      socket.emit('chat:join', { streamId });
      console.log(`  ● ${nickname} joined`);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      console.error(`  ✗ ${nickname}: ${err.message}`);
      resolve(null);
    });
  });
}

async function main() {
  const arg = process.argv[2];
  const seconds = Number(process.argv[3]) || 120;
  const { password, domain, users } = await loadManifest();

  if (!password) {
    console.error('.demo-streams 에 비밀번호가 없다. seed-demo.ts 를 다시 돌려라.');
    process.exit(1);
  }

  const streamId = !arg || arg === '--first' ? users[0]?.streamId : arg;
  if (!streamId) {
    console.error('붙을 방송이 없다.');
    process.exit(1);
  }

  // 방송 주인은 시청자로 넣지 않는다 — 본인이 자기 방에 입장하는
  // 시스템 메시지가 뜨면 스크린샷이 이상해진다.
  const guests = users.filter((u) => u.streamId !== streamId).slice(0, 4);

  console.log(`방송 ${streamId} 에 ${guests.length}명 접속한다.\n`);

  const sockets: Array<{ nickname: string; socket: Socket }> = [];
  for (const guest of guests) {
    const socket = await connect(
      guest.nickname,
      `${guest.nickname}@${domain}`,
      password,
      streamId,
    );
    if (socket) sockets.push({ nickname: guest.nickname, socket });
    // 동시에 붙으면 입장 메시지가 한 덩어리로 쌓인다
    await sleep(700);
  }

  if (sockets.length === 0) {
    console.error('아무도 붙지 못했다.');
    process.exit(1);
  }

  console.log(`\n${seconds}초 동안 채팅한다. Ctrl+C 로 종료.\n`);

  let i = 0;
  const timer = setInterval(() => {
    const { nickname, socket } = sockets[i % sockets.length];
    const content = LINES[i % LINES.length];
    socket.emit('chat:send', { streamId, content });
    console.log(`  ${nickname}: ${content}`);
    i++;
  }, 2600); // rate limit(2msg/sec)에 걸리지 않게 넉넉히 띄운다

  const shutdown = () => {
    clearInterval(timer);
    for (const { socket } of sockets) socket.disconnect();
    console.log('\n종료했다.');
    process.exit(0);
  };

  setTimeout(shutdown, seconds * 1000);
  process.on('SIGINT', shutdown);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
