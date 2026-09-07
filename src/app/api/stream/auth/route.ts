import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { isPublishing } from '@/shared/lib/media-server';

/**
 * MediaMTX authHTTPAddress 엔드포인트.
 *
 * MediaMTX가 publish/read 요청마다 이곳으로 POST한다.
 * 2xx = 허용, 그 외 = 거부.
 *
 * Body: { user, password, ip, action, path, protocol, id, query }
 *
 * 경로(path)는 streams.id이고 공개값이다.
 * 송출 권한은 password로 전달된 stream_key로만 판단한다.
 */

interface MediaMTXAuthRequest {
  user?: string;
  password?: string;
  ip?: string;
  action?: 'publish' | 'read' | 'playback' | 'api' | 'metrics' | 'pprof';
  path?: string;
  protocol?: string;
  query?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let body: MediaMTXAuthRequest;

  try {
    body = await request.json();
  } catch {
    return deny('malformed request');
  }

  const action = body.action ?? 'read';
  const path = (body.path ?? '').replace(/^\//, '');

  // 재생은 공개
  if (action !== 'publish') {
    return NextResponse.json({ ok: true });
  }

  // 경로는 반드시 stream id 형태여야 한다
  if (!UUID_RE.test(path)) {
    return deny(`invalid path: ${path}`);
  }

  // 비밀번호로 전달된 값이 실제 stream_key인지 확인
  // MediaMTX는 rtmp://host:1935/<path>?user=x&pass=y 형태의 query에서 뽑아 전달한다
  const suppliedKey = body.password ?? '';
  if (!UUID_RE.test(suppliedKey)) {
    return deny('missing or malformed stream key');
  }

  const { data: stream, error } = await supabaseAdmin
    .from('streams')
    .select('id, stream_key, status, user_id, users!inner(suspended_until)')
    .eq('id', path)
    .single();

  if (error || !stream) {
    return deny(`unknown stream: ${path}`);
  }

  // 계정 정지는 여기서 실효를 가진다.
  //
  // 운영자 화면에서 정지시켜도 이 확인이 없으면 다시 송출 버튼을 누르는
  // 순간 방송이 살아난다. 정지의 유일한 강제 지점이 송출 인증이다.
  const owner = stream.users as unknown as { suspended_until: string | null };
  if (owner.suspended_until && new Date(owner.suspended_until) > new Date()) {
    return deny(`suspended account: ${stream.user_id}`);
  }

  // 타이밍 공격 방지를 위한 길이 우선 비교 후 상수시간 비교
  if (!safeEqual(stream.stream_key, suppliedKey)) {
    return deny(`stream key mismatch for ${path}`);
  }

  // 같은 방송을 두 곳에서 동시에 송출하는 것 방지.
  //
  // 다만 DB의 status는 실제 송출 상태보다 뒤처질 수 있다. 모바일에서
  // 앱이 백그라운드로 가거나 네트워크가 잠깐 끊기면 MediaMTX는 세션을
  // 정리하지만 on-unpublish 웹훅이 유실될 수 있고, 그러면 status가 live로
  // 남아 정작 본인이 재접속을 못 하게 된다.
  // 미디어 서버에 실제로 송출 중인지 확인해서 유령 상태면 통과시킨다.
  if (stream.status === 'live') {
    try {
      if (await isPublishing(path)) {
        return deny(`stream already live: ${path}`);
      }
      console.warn('[Stream Auth] DB는 live지만 실제 송출 없음 — 재송출 허용', path);
    } catch {
      // 미디어 서버 조회에 실패하면 보수적으로 거부한다
      return deny(`cannot verify publish state: ${path}`);
    }
  }

  return NextResponse.json({ ok: true });
}

function deny(reason: string) {
  console.warn('[Stream Auth] denied:', reason);
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
