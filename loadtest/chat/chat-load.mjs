// 채팅 부하: 한 방에 소켓 N개를 붙이고, 몇 명이 메시지를 보내서
// "보낸 순간 → 각 소켓에 도착"까지 걸린 시간을 잰다.
//
// 모든 소켓이 같은 기계에 있으므로 보낸 시각과 받은 시각을 같은 시계로 잰다.
// 메시지 본문에 보낸 시각을 넣는다 (`lt:<epoch ms>:<seq>`).
//
//   node chat-load.mjs --ws https://ws.example.org --stream <id> --tokens tokens.txt \
//     --n 500 --senders 5 --duration 60
//
// tokens.txt: 한 줄에 액세스 토큰 하나. 소켓은 토큰을 돌려 쓴다.
// 서버의 전송 한도는 사용자당 초당 2개라, 보내는 쪽은 초당 1개로 둔다.
import { io } from 'socket.io-client';
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const WS = args.ws;
const STREAM = args.stream;
const N = Number(args.n ?? 100);
const SENDERS = Number(args.senders ?? 5);
const DURATION = Number(args.duration ?? 60);
const JOIN_PER_SEC = Number(args['join-rate'] ?? 50);
const tokens = readFileSync(args.tokens, 'utf8').split('\n').filter(Boolean);

const sockets = [];
const latencies = [];
let joined = 0, connectErrors = 0, chatErrors = 0, systemMsgs = 0, sent = 0;

function connect(i) {
  return new Promise((resolve) => {
    const s = io(WS, {
      auth: { token: tokens[i % tokens.length] },
      transports: ['websocket'],
      reconnection: false,
    });
    s.on('connect', () => {
      s.emit('chat:join', { streamId: STREAM });
      joined++;
      resolve(s);
    });
    s.on('connect_error', () => { connectErrors++; resolve(null); });
    s.on('chat:error', () => { chatErrors++; });
    s.on('chat:system', () => { systemMsgs++; });
    s.on('chat:message', (m) => {
      const match = /^lt:(\d+):/.exec(m?.content ?? '');
      if (match) latencies.push(Date.now() - Number(match[1]));
    });
    sockets.push(s);
  });
}

const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * p / 100)];
};

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  connect(i);
  if ((i + 1) % JOIN_PER_SEC === 0) await new Promise((r) => setTimeout(r, 1000));
}
// 입장 알림 폭주가 가라앉을 때까지 기다린다. 측정 창에 섞이면 안 된다.
await new Promise((r) => setTimeout(r, 5000));
const joinSecs = (Date.now() - t0) / 1000;
console.error(`joined ${joined}/${N} in ${joinSecs.toFixed(1)}s, connect errors ${connectErrors}, system msgs ${systemMsgs}`);

latencies.length = 0;
const live = sockets.filter((s) => s.connected);
const senders = live.slice(0, SENDERS);
let seq = 0;
const timer = setInterval(() => {
  for (const s of senders) {
    s.emit('chat:send', { streamId: STREAM, content: `lt:${Date.now()}:${seq++}` });
    sent++;
  }
}, 1000);

await new Promise((r) => setTimeout(r, DURATION * 1000));
clearInterval(timer);
await new Promise((r) => setTimeout(r, 3000)); // 늦게 도착하는 것까지

const expected = sent * live.length;
console.log(JSON.stringify({
  sockets: N,
  connected: live.length,
  sent,
  expected_deliveries: expected,
  delivered: latencies.length,
  delivered_pct: expected ? +(latencies.length / expected * 100).toFixed(2) : 0,
  p50_ms: pct(latencies, 50),
  p95_ms: pct(latencies, 95),
  p99_ms: pct(latencies, 99),
  max_ms: Math.max(0, ...latencies),
  chat_errors: chatErrors,
}));
for (const s of sockets) s.close();
process.exit(0);
