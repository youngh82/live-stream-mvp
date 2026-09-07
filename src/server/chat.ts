import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync, existsSync } from 'fs';
import { Server } from 'socket.io';
import { createClient } from '@supabase/supabase-js';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
import {
  DONATION_EVENTS_CHANNEL,
  type DonationEvent,
} from '../domains/donation/types';
import {
  LIVE_EVENTS_CHANNEL,
  type LiveStartedEvent,
} from '../domains/user/events';
import {
  MODERATION_EVENTS_CHANNEL,
  type ChannelSettings,
  type ModerationEvent,
} from '../domains/moderation/types';
import { isBanned } from '../domains/moderation/services/bans';

const PORT = parseInt(process.env.CHAT_PORT || '3001');
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

const supabase = createClient(
  SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * 앱이 HTTPS로 뜨면 채팅 서버도 TLS여야 한다.
 * https 페이지에서 http:// 소켓을 열면 mixed content로 차단되기 때문.
 * 인증서가 있으면 자동으로 TLS, 없으면 평문으로 뜬다.
 */
const CERT_PATH = process.env.TLS_CERT || 'certs/dev.crt';
const KEY_PATH = process.env.TLS_KEY || 'certs/dev.key';
const useTLS = existsSync(CERT_PATH) && existsSync(KEY_PATH);

const httpServer = useTLS
  ? createHttpsServer({
      cert: readFileSync(CERT_PATH),
      key: readFileSync(KEY_PATH),
    })
  : createHttpServer();

const io = new Server(httpServer, {
  // 개발 중에는 localhost와 LAN IP 두 오리진에서 접속하므로 목록으로 받는다
  cors: {
    origin: CORS_ORIGIN.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST'],
  },
});

// Redis 연결 3개:
//   pubClient - socket.io 어댑터 발행 + 일반 명령(레이트리밋, 시청자 수)
//   subClient - socket.io 어댑터 구독
//   eventClient - 후원 알림 구독 전용 (구독 모드 연결에서는 일반 명령 불가)
const pubClient = new Redis(REDIS_URL);
const subClient = pubClient.duplicate();
const eventClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

// ============================================
// 인증: JWT 로컬 검증 + 프로필 캐시
//
// 이전에는 소켓 연결마다 supabase.auth.getUser()로 원격 왕복을 했고,
// 프로필 조회로 한 번 더 왕복했다. 리전이 ap-southeast-2라 실측 왕복이
// 265~280ms였고, 스와이프할 때마다 이 비용을 두 번 지불했다.
// JWKS로 서명을 로컬 검증하면 왕복이 0이 된다.
// ============================================
const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const PROFILE_TTL = 300; // 5분

async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    // 대칭키(HS256)로 서명된 레거시 토큰은 JWKS로 검증할 수 없다.
    // 이 경우에만 원격 검증으로 폴백한다.
    try {
      const claims = decodeJwt(token);
      if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    } catch {
      return null;
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    return error || !user ? null : user.id;
  }
}

interface Profile {
  nickname: string;
  avatarUrl: string | null;
}

async function getProfile(userId: string): Promise<Profile> {
  const cacheKey = `user:profile:${userId}`;

  const cached = await pubClient.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as Profile;
    } catch {
      // 캐시가 깨졌으면 무시하고 다시 조회
    }
  }

  const { data } = await supabase
    .from('users')
    .select('nickname, avatar_url')
    .eq('id', userId)
    .single();

  const profile: Profile = {
    nickname: data?.nickname || 'Unknown',
    avatarUrl: data?.avatar_url || null,
  };

  await pubClient.setex(cacheKey, PROFILE_TTL, JSON.stringify(profile));
  return profile;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('인증이 필요합니다'));

  const userId = await verifyToken(token);
  if (!userId) return next(new Error('유효하지 않은 토큰입니다'));

  const profile = await getProfile(userId);

  socket.data.userId = userId;
  socket.data.nickname = profile.nickname;
  socket.data.avatarUrl = profile.avatarUrl;
  next();
});

// ============================================
// 레이트리밋: Redis 기반
//
// 이전에는 프로세스 메모리의 Map이라, 채팅 서버를 2대로 늘리는 순간
// 초당 2메시지 제한이 4메시지가 됐다. Redis INCR + TTL은 프로세스가
// 몇 개든 동일한 한도를 공유한다.
// ============================================
const RATE_LIMIT = 2; // 초당 메시지 수

async function checkRateLimit(userId: string): Promise<boolean> {
  const key = `chat:rl:${userId}`;
  const count = await pubClient.incr(key);
  if (count === 1) await pubClient.expire(key, 1);
  return count <= RATE_LIMIT;
}

/**
 * 슬로우 모드.
 *
 * 기본 rate limit과 별개다. 이건 채널이 켜는 것이고 한 명당 n초에 1회다.
 * SET NX + TTL로 "그 시간 안에 이미 보냈는가"만 본다.
 */
async function checkSlowMode(
  channelId: string,
  userId: string,
  seconds: number,
): Promise<boolean> {
  if (seconds <= 0) return true;
  const key = `chat:slow:${channelId}:${userId}`;
  const ok = await pubClient.set(key, '1', 'EX', seconds, 'NX');
  return ok === 'OK';
}

// ============================================
// 모더레이션
// ============================================

/**
 * 방송 → 채널(방송자 user id) 매핑.
 *
 * 차단은 채널 단위인데 소켓은 방송 단위로 참가한다. 매 메시지마다 조회할
 * 수 없으므로 캐시한다. 방송의 소유자는 바뀌지 않으니 오래 들고 있어도 된다.
 */
const CHANNEL_TTL = 3600;

async function getChannelId(streamId: string): Promise<string | null> {
  const key = `stream:owner:${streamId}`;
  const cached = await pubClient.get(key);
  if (cached) return cached;

  const { data } = await supabase
    .from('streams')
    .select('user_id')
    .eq('id', streamId)
    .single();

  if (!data) return null;
  await pubClient.setex(key, CHANNEL_TTL, data.user_id);
  return data.user_id;
}

const SETTINGS_TTL = 300;
const DEFAULT_SETTINGS: Omit<ChannelSettings, 'channel_id'> = {
  slow_mode_sec: 0,
  followers_only: false,
  banned_words: [],
};

async function getChannelSettings(
  channelId: string,
): Promise<Omit<ChannelSettings, 'channel_id'>> {
  const key = `chat:settings:${channelId}`;
  const cached = await pubClient.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // 깨졌으면 다시 조회
    }
  }

  const { data } = await supabase
    .from('channel_settings')
    .select('slow_mode_sec, followers_only, banned_words')
    .eq('channel_id', channelId)
    .maybeSingle();

  const settings = data ?? DEFAULT_SETTINGS;
  await pubClient.setex(key, SETTINGS_TTL, JSON.stringify(settings));
  return settings;
}

/** DB가 진실이다. 캐시 미스일 때만 여기로 온다 */
async function loadBan(channelId: string, userId: string) {
  const { data } = await supabase
    .from('channel_bans')
    .select('expires_at')
    .eq('channel_id', channelId)
    .eq('user_id', userId)
    .maybeSingle();
  return data ?? null;
}

async function checkBan(channelId: string, userId: string) {
  return isBanned(pubClient, channelId, userId, loadBan);
}

async function isFollowing(
  channelId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', userId)
    .eq('following_id', channelId)
    .maybeSingle();
  return Boolean(data);
}

function containsBannedWord(content: string, words: string[]): boolean {
  if (words.length === 0) return false;
  const lower = content.toLowerCase();
  return words.some((w) => lower.includes(w));
}

// ============================================
// 시청자 수
// ============================================
function viewerKey(streamId: string) {
  return `stream:viewers:${streamId}`;
}

async function handleLeave(
  socket: ReturnType<typeof io.sockets.sockets.get>,
  streamId: string,
) {
  if (!socket) return;

  // M-02: 실제로 참가 중인 방일 때만 감소시킨다
  if (socket.data.streamId !== streamId) return;

  const room = `stream:${streamId}`;
  socket.leave(room);
  socket.data.streamId = null;

  const count = await pubClient.hincrby(viewerKey(streamId), 'count', -1);
  const safeCount = Math.max(0, count);
  if (count < 0) await pubClient.hset(viewerKey(streamId), 'count', '0');

  io.to(room).emit('chat:viewer_count', { count: safeCount });
  // 문장이 아니라 코드를 보낸다. 서버는 접속자의 언어를 모르고,
  // 같은 방에 언어가 다른 사람들이 같이 있다 — 문장을 만들어 보내면
  // 모두가 서버 한 곳이 고른 언어를 본다. 문구는 클라이언트가 만든다.
  io.to(room).emit('chat:system', {
    event: 'left',
    nickname: socket.data.nickname,
    type: 'system',
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

io.on('connection', (socket) => {
  console.log(
    `[Chat] Connected: ${socket.data.nickname} (${socket.data.userId})`,
  );

  // 개인 알림 룸. 접속과 동시에 들어간다.
  // 방송 room(stream:*)과 달리 로그인한 동안 계속 유지되며,
  // 팔로우한 방송자의 라이브 시작 알림이 이리로 온다.
  socket.join(`user:${socket.data.userId}`);

  socket.on('chat:join', async ({ streamId }: { streamId: string }) => {
    if (!UUID_RE.test(streamId ?? '')) return;

    // M-02: 중복 참가 방지.
    //
    // 이전에는 join할 때마다 무조건 HINCRBY +1을 해서, 같은 소켓으로
    // 1000번 emit하면 시청자 수가 1000이 됐다. 그 값이 DB에 반영되고
    // 피드 정렬 기준이었으므로 추천 순위 조작으로 이어졌다.
    if (socket.data.streamId === streamId) return;

    // 다른 방에 있었다면 먼저 정리
    if (socket.data.streamId) {
      await handleLeave(socket, socket.data.streamId);
    }

    const room = `stream:${streamId}`;
    socket.join(room);
    socket.data.streamId = streamId;
    socket.data.channelId = await getChannelId(streamId);

    // 차단자도 방에는 들여보낸다. 다만 상태를 알려준다.
    //
    // 조용히 무시하면 유저는 자기 메시지가 왜 안 보이는지 모른 채
    // "채팅이 고장났다"고 신고한다. 남은 시간과 사유를 명시하는 편이
    // 서로에게 낫다.
    if (socket.data.channelId) {
      const ban = await checkBan(socket.data.channelId, socket.data.userId);
      if (ban.banned) {
        socket.emit('chat:banned', {
          expiresAt: ban.expiresAt?.toISOString() ?? null,
        });
      }
    }

    const count = await pubClient.hincrby(viewerKey(streamId), 'count', 1);
    io.to(room).emit('chat:viewer_count', { count });
    io.to(room).emit('chat:system', {
      event: 'joined',
      nickname: socket.data.nickname,
      type: 'system',
    });
  });

  socket.on('chat:leave', async ({ streamId }: { streamId: string }) => {
    await handleLeave(socket, streamId);
  });

  socket.on(
    'chat:send',
    async ({
      streamId,
      content,
    }: {
      streamId: string;
      content: string;
    }) => {
      // M-01: 참가하지 않은 방에는 보낼 수 없다.
      //
      // 이전에는 streamId를 그대로 믿고 브로드캐스트해서, 소켓 하나로
      // 모든 방송에 동시에 도배할 수 있었다.
      if (socket.data.streamId !== streamId) {
        socket.emit('chat:error', { message: '참여하지 않은 방송입니다' });
        return;
      }

      if (!content || typeof content !== 'string') return;

      const trimmed = content.trim();
      if (trimmed.length === 0 || trimmed.length > 200) {
        socket.emit('chat:error', { message: '메시지는 1~200자여야 합니다' });
        return;
      }

      if (!(await checkRateLimit(socket.data.userId))) {
        socket.emit('chat:error', {
          message: '메시지를 너무 빠르게 보내고 있습니다',
        });
        return;
      }

      // ------------------------------------------------------------------
      // 모더레이션
      //
      // 여기가 채팅 제재의 실제 방어선이다. 클라이언트가 액션 시트를
      // 안 그려도, 소켓을 직접 열어도 여기서 막힌다.
      // ------------------------------------------------------------------
      const channelId =
        socket.data.channelId ?? (await getChannelId(streamId));
      socket.data.channelId = channelId;

      if (channelId) {
        // 방송자 본인은 자기 채널의 제재를 받지 않는다
        if (channelId !== socket.data.userId) {
          const ban = await checkBan(channelId, socket.data.userId);
          if (ban.banned) {
            socket.emit('chat:banned', {
              expiresAt: ban.expiresAt?.toISOString() ?? null,
            });
            return;
          }

          const settings = await getChannelSettings(channelId);

          if (settings.followers_only) {
            if (!(await isFollowing(channelId, socket.data.userId))) {
              socket.emit('chat:error', {
                message: '팔로워만 채팅할 수 있습니다',
              });
              return;
            }
          }

          if (
            !(await checkSlowMode(
              channelId,
              socket.data.userId,
              settings.slow_mode_sec,
            ))
          ) {
            socket.emit('chat:error', {
              message: `슬로우 모드입니다 (${settings.slow_mode_sec}초에 1회)`,
            });
            return;
          }

          if (containsBannedWord(trimmed, settings.banned_words)) {
            socket.emit('chat:error', {
              message: '사용할 수 없는 단어가 포함되어 있습니다',
            });
            return;
          }
        }
      }

      const sanitized = trimmed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      io.to(`stream:${streamId}`).emit('chat:message', {
        id: crypto.randomUUID(),
        userId: socket.data.userId,
        nickname: socket.data.nickname,
        avatarUrl: socket.data.avatarUrl,
        content: sanitized,
        type: 'message' as const,
        createdAt: new Date().toISOString(),
      });
    },
  );

  // H-01: 클라이언트의 donation:send 핸들러는 제거됨.
  // 후원 알림은 아래 Redis 구독을 통해 서버에서만 발행된다.

  socket.on('disconnect', async () => {
    if (socket.data.streamId) {
      await handleLeave(socket, socket.data.streamId);
    }
    console.log(`[Chat] Disconnected: ${socket.data.nickname}`);
  });
});

// ============================================
// 후원 알림 구독 (H-01)
//
// /api/donation/send 가 DB 트랜잭션 커밋 후에만 발행한다.
// 여기에 도착한 금액은 실제로 차감된 금액과 항상 일치한다.
// ============================================
eventClient.subscribe(
  DONATION_EVENTS_CHANNEL,
  LIVE_EVENTS_CHANNEL,
  MODERATION_EVENTS_CHANNEL,
  (err) => {
    if (err) console.error('[Chat] 이벤트 채널 구독 실패:', err);
    else console.log('[Chat] 후원·라이브·모더레이션 채널 구독됨');
  },
);

/**
 * 제재를 접속 중인 소켓에 즉시 반영한다.
 *
 * 이게 없으면 방금 차단당한 사람이 재접속 전까지 계속 떠들 수 있다.
 * Redis Pub/Sub를 거치므로 채팅 서버가 여러 대여도 전부 반영된다.
 */
function handleModerationEvent(event: ModerationEvent) {
  switch (event.type) {
    case 'ban':
      io.to(`user:${event.targetId}`).emit('chat:banned', {
        expiresAt: event.expiresAt,
        reason: event.reason,
      });
      break;

    case 'unban':
      io.to(`user:${event.targetId}`).emit('chat:unbanned', {});
      break;

    case 'delete_message':
      // 채팅은 저장되지 않으므로 삭제는 "모두의 화면에서 지운다"는 뜻이다
      io.to(`stream:${event.streamId}`).emit('chat:delete', {
        messageId: event.messageId,
      });
      break;

    case 'settings':
      // 캐시만 버린다. 다음 메시지에서 다시 읽는다.
      pubClient.del(`chat:settings:${event.channelId}`).catch(() => {});
      break;
  }
}

/**
 * 팔로워에게 라이브 시작을 알린다.
 *
 * 팔로워 목록을 한 번에 다 읽지 않고 페이지 단위로 돈다. 팔로워가 많은
 * 방송자에서 메모리가 튀는 것을 막고, 앞 페이지 알림이 먼저 나가 체감이 빠르다.
 *
 * 이 함수가 느려도 방송 시작에는 영향이 없다 — on-publish 웹훅은 이미
 * 이벤트만 던지고 응답을 끝냈다.
 */
const FOLLOWER_PAGE = 1000;

async function notifyFollowers(event: LiveStartedEvent) {
  let from = 0;
  let sent = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', event.streamerId)
      .range(from, from + FOLLOWER_PAGE - 1);

    if (error) {
      console.error('[Chat] 팔로워 조회 실패:', error.message);
      return;
    }
    if (!data || data.length === 0) break;

    for (const { follower_id } of data) {
      io.to(`user:${follower_id}`).emit('notification:live', {
        streamId: event.streamId,
        streamerId: event.streamerId,
        nickname: event.nickname,
        avatarUrl: event.avatarUrl,
        title: event.title,
      });
    }

    sent += data.length;
    if (data.length < FOLLOWER_PAGE) break;
    from += FOLLOWER_PAGE;
  }

  if (sent > 0) {
    console.log(`[Chat] 라이브 알림 ${sent}명에게 발송 (${event.nickname})`);
  }
}

eventClient.on('message', (channel, raw) => {
  if (channel === MODERATION_EVENTS_CHANNEL) {
    try {
      handleModerationEvent(JSON.parse(raw) as ModerationEvent);
    } catch {
      console.error('[Chat] 모더레이션 이벤트 파싱 실패');
    }
    return;
  }

  if (channel === LIVE_EVENTS_CHANNEL) {
    try {
      notifyFollowers(JSON.parse(raw) as LiveStartedEvent);
    } catch {
      console.error('[Chat] 라이브 이벤트 파싱 실패');
    }
    return;
  }

  if (channel !== DONATION_EVENTS_CHANNEL) return;

  let event: DonationEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    console.error('[Chat] 후원 이벤트 파싱 실패');
    return;
  }

  const room = `stream:${event.streamId}`;

  io.to(room).emit('donation:alert', {
    id: event.donationId,
    senderId: event.senderId,
    nickname: event.nickname,
    avatarUrl: event.avatarUrl,
    amount: event.amount,
    message: event.message,
  });

  io.to(room).emit('chat:message', {
    id: crypto.randomUUID(),
    userId: event.senderId,
    nickname: event.nickname,
    avatarUrl: event.avatarUrl,
    // 금액 표기(자릿수 구분)와 문구는 보는 사람의 로케일을 따라야 하므로
    // 여기서 문자열로 굳히지 않고 원본 값을 그대로 넘긴다.
    donation: { amount: event.amount, message: event.message || null },
    content: '',
    type: 'donation' as const,
    createdAt: new Date().toISOString(),
  });
});

// ============================================
// 시청자 수 DB 동기화 (10초 주기)
//
// KEYS는 Redis를 블로킹하는 명령이라 SCAN으로 교체했다.
// 방이 많아져도 이벤트 루프와 Redis를 멈추지 않는다.
// ============================================
setInterval(async () => {
  try {
    let cursor = '0';
    do {
      const [next, keys] = await pubClient.scan(
        cursor,
        'MATCH',
        'stream:viewers:*',
        'COUNT',
        100,
      );
      cursor = next;

      for (const key of keys) {
        const streamId = key.replace('stream:viewers:', '');
        const countStr = await pubClient.hget(key, 'count');
        const count = Math.max(0, parseInt(countStr || '0'));

        await supabase
          .from('streams')
          .update({ viewer_count: count })
          .eq('id', streamId)
          .eq('status', 'live');
      }
    } while (cursor !== '0');
  } catch (err) {
    console.error('[Chat] Viewer count sync error:', err);
  }
}, 10_000);

httpServer.listen(PORT, () => {
  console.log(
    `[Chat] Server running on port ${PORT} (${useTLS ? 'TLS' : '평문'})`,
  );
});
