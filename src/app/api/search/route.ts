import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import { CATEGORIES } from '@/domains/stream/categories';

/**
 * 통합 검색.
 *
 * 우선순위는 **방송자 > 라이브 방송 > 카테고리**다. 사람들은 대부분
 * "그 사람"을 찾지 "그 제목"을 찾지 않는다.
 *
 * 결과를 한 목록에 섞지 않고 섹션으로 나눈다. 종류가 다른 것을 하나의
 * 점수로 줄 세우면 무엇을 보고 있는지 알 수 없어진다.
 *
 * 부분일치는 pg_trgm GIN 인덱스가 받는다(008). ilike가 그 인덱스를 탄다.
 */

const MIN_QUERY = 1;
const MAX_QUERY = 50;
const LIMIT = 10;

/** ilike 패턴에서 특별한 의미를 갖는 문자를 무력화한다 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function GET(request: NextRequest) {
  try {
    const raw = (request.nextUrl.searchParams.get('q') || '').trim();

    if (raw.length < MIN_QUERY) {
      return NextResponse.json({
        data: { users: [], streams: [], categories: [] },
        error: null,
      });
    }

    const q = raw.slice(0, MAX_QUERY);
    const pattern = `%${escapeLike(q)}%`;

    // 방송자: 팔로워 많은 순
    const usersQuery = supabaseAdmin
      .from('users')
      .select('id, nickname, avatar_url, follower_count')
      .ilike('nickname', pattern)
      .order('follower_count', { ascending: false })
      .limit(LIMIT);

    // 방송: 제목 부분일치.
    // 종료된 방송도 넣되 라이브를 위로 올린다 — 지금 볼 수 있는 것이 먼저다.
    const streamsQuery = supabaseAdmin
      .from('streams')
      .select(
        'id, title, category, status, viewer_count, thumbnail_url, started_at, user_id, users!inner(id, nickname, avatar_url)',
      )
      .ilike('title', pattern)
      .order('status', { ascending: true }) // 'ended' < 'idle' < 'live' 이므로 아래에서 다시 정렬한다
      .limit(LIMIT * 2);

    const [{ data: users }, { data: streams }] = await Promise.all([
      usersQuery,
      streamsQuery,
    ]);

    // 라이브 여부의 단일 출처는 Redis다. DB status는 웹훅 유실로 어긋날 수 있다.
    const ids = (streams ?? []).map((s) => s.id);
    const scores = ids.length ? await redis.zmscore('live:streams', ids) : [];
    const liveIds = new Set(
      ids.filter((_, i) => scores[i] !== null),
    );

    const sortedStreams = (streams ?? [])
      .map((s) => ({ ...s, is_live: liveIds.has(s.id) }))
      .sort((a, b) => {
        if (a.is_live !== b.is_live) return a.is_live ? -1 : 1;
        return (b.viewer_count ?? 0) - (a.viewer_count ?? 0);
      })
      .slice(0, LIMIT);

    // 카테고리는 목록이 9개뿐이라 DB에 갈 필요가 없다
    const lower = q.toLowerCase();
    const categories = CATEGORIES.filter(
      (c) => c.label.includes(q) || c.id.includes(lower),
    );

    return NextResponse.json({
      data: { users: users ?? [], streams: sortedStreams, categories },
      error: null,
    });
  } catch (err) {
    console.error('[Search] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
