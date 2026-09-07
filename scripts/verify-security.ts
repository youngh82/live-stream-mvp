/**
 * 보안 수정 검증 스크립트
 *
 * 004 마이그레이션과 관련 코드 수정이 실제로 공격을 막는지 확인한다.
 * 감사 보고서의 C-01 ~ C-05, H-01 ~ H-03, M-01 ~ M-03에 대응한다.
 *
 * 실행: pnpm verify:security
 *
 * 사전 조건: pnpm dev:all 로 Next(3000), 채팅(3001), Redis, MediaMTX가 떠 있어야 함
 * 시도하는 공격은 전부 실패하도록 되어 있어 데이터가 변하지 않는다.
 * (H-02 검사만 임시 행을 하나 넣었다가 즉시 지운다)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { io, type Socket } from 'socket.io-client';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';
const MEDIA_API = 'http://127.0.0.1:9997';

const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

let passed = 0;
let failed = 0;

function check(id: string, name: string, ok: boolean, detail: string) {
  if (ok) {
    passed++;
    console.log(`  ${GREEN}✓${OFF} ${id}  ${name}`);
  } else {
    failed++;
    console.log(`  ${RED}✗${OFF} ${id}  ${name}`);
  }
  console.log(`     ${DIM}${detail}${OFF}`);
}

function section(title: string) {
  console.log(`\n${BOLD}${title}${OFF}`);
}

// ============================================
// DB / PostgREST 계층
// ============================================
async function verifyDatabase() {
  section('데이터베이스 — 공개 anon key로 직접 공격');

  // C-01: 포인트 무한 발행
  const mint = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_points`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target_user_id: '00000000-0000-0000-0000-000000000000',
      amount: 999999,
    }),
  });
  check(
    'C-01',
    'add_points RPC로 포인트 발행 불가',
    mint.status === 401 || mint.status === 404,
    `HTTP ${mint.status} — 200/204면 발행 성공(취약)`,
  );

  // C-02: 남의 포인트 탈취
  const steal = await fetch(`${SUPABASE_URL}/rest/v1/rpc/send_donation`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_stream_id: '00000000-0000-0000-0000-000000000000',
      p_sender_id: '00000000-0000-0000-0000-000000000000',
      p_receiver_id: '00000000-0000-0000-0000-000000000000',
      p_amount: 1,
    }),
  });
  check(
    'C-02',
    'send_donation RPC 직접 호출 불가',
    steal.status === 401 || steal.status === 404,
    `HTTP ${steal.status} — 임의 sender_id로 포인트 이전이 가능하면 취약`,
  );

  // C-04: stream_key 노출
  const keys = await fetch(
    `${SUPABASE_URL}/rest/v1/streams?select=id,stream_key&limit=1`,
    { headers: { apikey: ANON_KEY } },
  );
  const keyBody = await keys.text();
  check(
    'C-04',
    'stream_key 컬럼 조회 불가',
    keys.status !== 200,
    `HTTP ${keys.status} — 200이면 방송 키가 노출됨`,
  );

  // 정상 경로가 깨지지 않았는지
  const legit = await fetch(
    `${SUPABASE_URL}/rest/v1/streams?select=id,title,status&limit=1`,
    { headers: { apikey: ANON_KEY } },
  );
  check(
    '정상',
    '허용된 컬럼 조회는 여전히 동작',
    legit.status === 200,
    `HTTP ${legit.status} — 200이어야 함 (과잉 차단 여부 확인)`,
  );

  void keyBody;
}

// ============================================
// 미디어 서버 계층
// ============================================
async function verifyMediaServer() {
  section('미디어 서버 — 관리 API 노출 범위');

  // C-05: 외부 인터페이스에서 관리 API 접근
  const host = process.env.LAN_IP;
  if (host) {
    let externalCode = 0;
    try {
      const res = await fetch(`http://${host}:9997/v3/config/global/get`, {
        signal: AbortSignal.timeout(3000),
      });
      externalCode = res.status;
    } catch {
      externalCode = 0; // 연결 거부 = 정상
    }
    check(
      'C-05',
      '외부 인터페이스에서 관리 API 접근 불가',
      externalCode === 0,
      `${host}:9997 → ${externalCode || '연결 거부'} (200이면 서버 장악 가능)`,
    );
  }

  let loopback = 0;
  try {
    const res = await fetch(`${MEDIA_API}/v3/config/global/get`, {
      signal: AbortSignal.timeout(3000),
    });
    loopback = res.status;
  } catch {
    loopback = 0;
  }
  check(
    '정상',
    '루프백에서는 관리 API 동작 (웹훅 검증에 필요)',
    loopback === 200,
    `127.0.0.1:9997 → HTTP ${loopback}`,
  );
}

// ============================================
// 웹훅 계층
// ============================================
async function verifyWebhooks() {
  section('웹훅 — 위조 호출');

  const { data: stream } = await admin
    .from('streams')
    .select('id, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!stream) {
    console.log(`  ${DIM}방송 레코드가 없어 건너뜀${OFF}`);
    return;
  }

  const live = stream.status === 'live';

  // H-03: 송출하지 않으면서 라이브로 띄우기 / 남의 방송 강제 종료
  const endpoint = live ? 'on-unpublish' : 'on-publish';
  const res = await fetch(`${APP_URL}/api/stream/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: stream.id }),
  });

  check(
    'H-03',
    live
      ? '방송 중인 스트림을 웹훅으로 강제 종료 불가'
      : '송출 없이 웹훅으로 라이브 상태 조작 불가',
    res.status === 403,
    `/api/stream/${endpoint} → HTTP ${res.status} (403이어야 함, 200이면 조작 성공)`,
  );

  const after = await admin
    .from('streams')
    .select('status')
    .eq('id', stream.id)
    .single();

  check(
    'H-03',
    '위조 시도 후 방송 상태가 그대로',
    after.data?.status === stream.status,
    `${stream.status} → ${after.data?.status}`,
  );
}

// ============================================
// 채팅 서버 계층
// ============================================
async function getAccessToken(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error) throw error;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'magiclink',
      token_hash: data.properties.hashed_token,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(JSON.stringify(json));
  return json.access_token;
}

function connect(token: string): Promise<{ socket: Socket; ms: number }> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const socket = io(WS_URL, { auth: { token } });
    socket.on('connect', () => resolve({ socket, ms: Date.now() - t0 }));
    socket.on('connect_error', reject);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function verifyChat() {
  section('채팅 서버 — 인증 · 레이트리밋 · 이벤트 위조');

  const { data: users } = await admin
    .from('users')
    .select('id')
    .limit(1)
    .single();
  if (!users) {
    console.log(`  ${DIM}유저가 없어 건너뜀${OFF}`);
    return;
  }

  const { data: authUser } =
    await admin.auth.admin.getUserById(users.id);
  const email = authUser.user?.email;
  if (!email) {
    console.log(`  ${DIM}이메일을 찾을 수 없어 건너뜀${OFF}`);
    return;
  }

  const token = await getAccessToken(email);

  // 위조 토큰 거부
  const rejected = await new Promise<boolean>((resolve) => {
    const s = io(WS_URL, { auth: { token: 'not.a.real.token' } });
    s.on('connect_error', () => {
      s.close();
      resolve(true);
    });
    s.on('connect', () => {
      s.close();
      resolve(false);
    });
    setTimeout(() => resolve(false), 4000);
  });
  check('인증', '위조 JWT로 소켓 연결 불가', rejected, '연결 거부되어야 함');

  // 7: 연결 지연
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { socket, ms } = await connect(token);
    times.push(ms);
    socket.disconnect();
    await wait(150);
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  check(
    '#7',
    'JWT 로컬 검증 + 프로필 캐시로 연결 지연 단축',
    avg < 300,
    `평균 ${avg} ms (${times.join(', ')}) — 이전 구조는 Supabase 왕복 2회로 540ms 이상 고정`,
  );

  const { data: anyStream } = await admin
    .from('streams')
    .select('id')
    .limit(1)
    .single();
  const streamId = anyStream!.id;
  const otherStream = '11111111-1111-1111-1111-111111111111';

  const { socket } = await connect(token);

  // M-01: 참가하지 않은 방에 메시지 주입
  const blocked = await new Promise<boolean>((resolve) => {
    socket.once('chat:error', () => resolve(true));
    socket.emit('chat:send', { streamId: otherStream, content: 'injection' });
    setTimeout(() => resolve(false), 1500);
  });
  check(
    'M-01',
    'join 하지 않은 방송에 메시지 주입 불가',
    blocked,
    '차단 응답이 와야 함 — 무응답이면 메시지가 통과했을 수 있음',
  );

  // M-02: 시청자 수 부풀리기
  let viewerCount = 0;
  socket.on('chat:viewer_count', ({ count }: { count: number }) => {
    viewerCount = count;
  });
  for (let i = 0; i < 20; i++) socket.emit('chat:join', { streamId });
  await wait(1200);
  check(
    'M-02',
    'chat:join 반복으로 시청자 수 조작 불가',
    viewerCount === 1,
    `join 20회 후 시청자 수 = ${viewerCount} (기대 1, 이전 구조라면 20)`,
  );

  // 9: 레이트리밋
  let accepted = 0;
  let denied = 0;
  const onMsg = () => accepted++;
  const onErr = () => denied++;
  socket.on('chat:message', onMsg);
  socket.on('chat:error', onErr);
  for (let i = 0; i < 6; i++) {
    socket.emit('chat:send', { streamId, content: `rate test ${i}` });
  }
  await wait(1500);
  socket.off('chat:message', onMsg);
  socket.off('chat:error', onErr);
  check(
    '#9',
    'Redis 레이트리밋이 초당 2건으로 제한',
    accepted <= 2 && denied >= 3,
    `1초 내 6건 전송 → 수락 ${accepted} / 차단 ${denied}`,
  );

  // H-01: 클라이언트가 후원 알림 위조
  let fakeAlert = false;
  socket.on('donation:alert', () => {
    fakeAlert = true;
  });
  socket.emit('donation:send', {
    streamId,
    amount: 1_000_000,
    message: 'free money',
    donationId: 'fake',
  });
  await wait(1500);
  check(
    'H-01',
    '클라이언트가 후원 알림을 직접 발사할 수 없음',
    !fakeAlert,
    fakeAlert
      ? '알림이 표시됨 — 결제 없이 후원 연출 가능(취약)'
      : '핸들러가 제거되어 무시됨',
  );

  // H-01 정상 경로: 서버가 발행하면 알림이 도착해야 한다
  const Redis = (await import('ioredis')).default;
  const publisher = new Redis(
    process.env.REDIS_URL || 'redis://localhost:6379',
  );

  const delivered = await new Promise<number | null>((resolve) => {
    socket.once('donation:alert', (a: { amount: number }) =>
      resolve(a.amount),
    );
    publisher.publish(
      'donation:events',
      JSON.stringify({
        donationId: 'verify-script',
        streamId,
        senderId: users.id,
        nickname: '검증',
        avatarUrl: null,
        amount: 1234,
        message: '서버 발행 테스트',
      }),
    );
    setTimeout(() => resolve(null), 2000);
  });
  await publisher.quit();

  check(
    'H-01',
    '서버가 발행한 후원 알림은 정상 전달',
    delivered === 1234,
    delivered === null
      ? '알림이 도착하지 않음 — 채팅 서버 구독이 끊겼을 수 있음'
      : `금액 ${delivered}P 수신 (발행값과 일치해야 함)`,
  );

  socket.disconnect();
}

// ============================================
// Stripe 웹훅 멱등성
// ============================================
async function verifyStripeIdempotency() {
  section('Stripe 웹훅 — 중복 충전 방지');

  const sentinel = `verify_${Date.now()}`;

  const first = await admin
    .from('processed_stripe_events')
    .insert({ event_id: sentinel, event_type: 'verify.check' });

  const second = await admin
    .from('processed_stripe_events')
    .insert({ event_id: sentinel, event_type: 'verify.check' });

  check(
    'H-02',
    '같은 Stripe 이벤트를 두 번 기록할 수 없음',
    !first.error && second.error?.code === '23505',
    `1차 ${first.error ? '실패' : '성공'} / 2차 ${second.error?.code ?? '성공(취약)'} — 23505(중복키)여야 함`,
  );

  // 검증용 행 정리
  await admin
    .from('processed_stripe_events')
    .delete()
    .eq('event_id', sentinel);

  check(
    'H-02',
    '테이블이 anon에게 노출되지 않음',
    (
      await fetch(
        `${SUPABASE_URL}/rest/v1/processed_stripe_events?select=event_id&limit=1`,
        { headers: { apikey: ANON_KEY } },
      )
    ).status !== 200,
    '결제 이벤트 기록은 서버만 읽을 수 있어야 함',
  );
}

// ============================================
// 후원 API 입력 검증
// ============================================
async function verifyDonationInput() {
  section('후원 금액 검증 — DB 함수 계층');

  // API 라우트는 쿠키 세션 기반이라 스크립트에서 로그인 상태를 만들 수 없다.
  // 대신 최종 방어선인 send_donation 함수를 service_role로 직접 호출해
  // 잘못된 금액이 거부되는지 확인한다. (API 계층 검증은 브라우저에서 확인)
  const cases = [
    { name: '음수 금액', amount: -100 },
    { name: '0원', amount: 0 },
    { name: '상한 초과 (10억)', amount: 1_000_000_000 },
  ];

  const { data: user } = await admin
    .from('users')
    .select('id')
    .limit(1)
    .single();

  for (const c of cases) {
    const { error } = await admin.rpc('send_donation', {
      p_stream_id: '00000000-0000-0000-0000-000000000000',
      p_sender_id: user!.id,
      p_receiver_id: user!.id,
      p_amount: c.amount,
      p_message: null,
    });

    check(
      'M-03',
      `${c.name} 거부`,
      Boolean(error) && error!.message.includes('Invalid amount'),
      error
        ? `거부됨: "${error.message}"`
        : '통과됨 — 후원이 실행되었을 수 있음(취약)',
    );
  }

  // 자기 자신에게 후원하는 경우도 함수 계층에서 막는다
  const { error: selfErr } = await admin.rpc('send_donation', {
    p_stream_id: '00000000-0000-0000-0000-000000000000',
    p_sender_id: user!.id,
    p_receiver_id: user!.id,
    p_amount: 100,
    p_message: null,
  });
  check(
    'M-03',
    '본인에게 후원 거부',
    Boolean(selfErr) && selfErr!.message.includes('Cannot donate to self'),
    selfErr ? `거부됨: "${selfErr.message}"` : '통과됨(취약)',
  );
}

async function main() {
  console.log(`${BOLD}보안 수정 검증${OFF}`);
  console.log(`${DIM}실패한 공격만 시도하므로 데이터는 변하지 않습니다${OFF}`);

  await verifyDatabase();
  await verifyMediaServer();
  await verifyWebhooks();
  await verifyDonationInput();
  await verifyStripeIdempotency();
  await verifyChat();

  console.log(
    `\n${BOLD}결과${OFF}  ${GREEN}통과 ${passed}${OFF}  ${failed > 0 ? RED : ''}실패 ${failed}${OFF}\n`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
