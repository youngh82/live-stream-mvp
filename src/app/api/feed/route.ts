import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import { whepUrlFor } from '@/shared/lib/media-url';
import { createClient } from '@/shared/lib/supabase-server';
import { getFollowingSet } from '@/domains/user/services/follows';

/**
 * 숏폼 세로 피드 API.
 *
 * 페이지네이션은 Redis ZSET(score = 방송 시작 시각)에서 처리한다.
 * viewer_count를 커서로 쓰던 이전 방식은 값이 10초마다 바뀌어서
 * 페이지 경계의 방송이 중복되거나 누락됐다. 시작 시각은 라이브 중
 * 변하지 않으므로 커서로 안정적이다.
 *
 * 또한 이전에는 zrevrange(0, -1)로 전체 라이브 목록을 가져와
 * .in() 절에 넣었기 때문에 동시 라이브가 200개를 넘으면
 * 쿼리스트링 길이 초과로 피드 전체가 실패했다. 이제 페이지 크기만큼만 읽는다.
 *
 * `filter=following`이면 내가 팔로우한 사람의 라이브만 준다.
 */

const STREAM_COLUMNS =
  'id, title, category, status, viewer_count, thumbnail_url, started_at, user_id, users!inner(id, nickname, avatar_url)';

/** 첫 페이지 상단에 끼워 넣을 팔로잉 라이브 개수 */
const FOLLOWING_BOOST = 10;
/** 팔로우 목록 상한. 이보다 많으면 최근 팔로우한 쪽을 본다 */
const MAX_FOLLOWING = 1000;

type StreamRow = {
  id: string;
  user_id: string;
  [key: string]: unknown;
};

function decorate(
  rows: StreamRow[],
  following: Set<string>,
  viewerId: string | null,
) {
  return rows.map((s) => ({
    ...s,
    // 경로 이름이 stream id이므로 URL에 비밀이 없다 (C-04)
    whep_url: whepUrlFor(s.id),
    is_following: following.has(s.user_id),
    // 내 방송이면 피드에서도 채팅 제재 메뉴를 쓸 수 있어야 한다
    is_me: viewerId === s.user_id,
  }));
}

/** 내가 팔로우한 사람들의 라이브 방송 */
async function followingLiveStreams(limit: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { viewerId: null, rows: [] as StreamRow[] };

  const { data: follows } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', user.id)
    .order('created_at', { ascending: false })
    .limit(MAX_FOLLOWING);

  const ids = (follows ?? []).map((f) => f.following_id);
  if (ids.length === 0) return { viewerId: user.id, rows: [] as StreamRow[] };

  const { data: streams } = await supabaseAdmin
    .from('streams')
    .select(STREAM_COLUMNS)
    .in('user_id', ids)
    .eq('status', 'live')
    .order('started_at', { ascending: false })
    .limit(limit);

  const rows = (streams ?? []) as unknown as StreamRow[];
  if (rows.length === 0) return { viewerId: user.id, rows };

  // DB의 status는 실제 송출보다 뒤처질 수 있다. on-unpublish 웹훅이 유실되면
  // live로 남은 유령 방송이 생긴다(ISSUES.md #18). 라이브의 단일 출처인
  // Redis ZSET에 있는 것만 통과시킨다.
  const scores = await redis.zmscore(
    'live:streams',
    rows.map((s) => s.id),
  );

  return {
    viewerId: user.id,
    rows: rows.filter((_, i) => scores[i] !== null),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const cursor = searchParams.get('cursor');
    const filter = searchParams.get('filter') === 'following' ? 'following' : 'all';
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '5'), 1),
      20,
    );

    // ------------------------------------------------------------------
    // 팔로잉 탭
    //
    // 커서를 두지 않는다. 내가 팔로우한 사람 중 지금 켜져 있는 사람은
    // 많아야 수십 명이라 한 번에 주는 편이 단순하고, 페이지 경계에서
    // 방송이 켜지고 꺼지며 생기는 중복·누락 문제도 없다.
    // ------------------------------------------------------------------
    if (filter === 'following') {
      const { rows, viewerId } = await followingLiveStreams(50);
      const following = new Set(rows.map((s) => s.user_id));

      return NextResponse.json({
        data: decorate(rows, following, viewerId),
        cursor: null,
        has_more: false,
      });
    }

    // 커서(=이전 페이지 마지막 방송의 시작 시각) 미만인 것부터, limit+1개만
    const max = cursor && /^\d+$/.test(cursor) ? `(${cursor}` : '+inf';

    const raw = await redis.zrevrangebyscore(
      'live:streams',
      max,
      '-inf',
      'WITHSCORES',
      'LIMIT',
      0,
      limit + 1,
    );

    // [member, score, member, score, ...] 형태를 평탄화
    const entries: { id: string; score: string }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      entries.push({ id: raw[i], score: raw[i + 1] });
    }

    const hasMore = entries.length > limit;
    const page = entries.slice(0, limit);

    const { data: streams, error } = page.length
      ? await supabaseAdmin
          .from('streams')
          .select(STREAM_COLUMNS)
          .in(
            'id',
            page.map((e) => e.id),
          )
          .eq('status', 'live')
      : { data: [], error: null };

    if (error) {
      console.error('[Feed] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch feed' },
        { status: 500 },
      );
    }

    // DB는 .in() 순서를 보장하지 않으므로 Redis 정렬 순서로 재배열한다
    const byId = new Map(
      ((streams ?? []) as unknown as StreamRow[]).map((s) => [s.id, s]),
    );
    let ordered = page
      .map((e) => byId.get(e.id))
      .filter((s): s is StreamRow => Boolean(s));

    // ------------------------------------------------------------------
    // 첫 페이지 상단에 팔로잉 라이브를 끌어올린다.
    //
    // ZSET score(시작 시각)를 사람마다 바꾸면 전역 캐시가 깨지므로,
    // 개인화는 이렇게 조회 시점의 병합으로만 한다. 끌어올린 방송은
    // 뒤 페이지의 전역 목록에도 다시 나오는데, 그건 클라이언트가
    // id로 중복 제거한다(useFeed).
    // ------------------------------------------------------------------
    const { rows: boosted } = cursor
      ? { rows: [] as StreamRow[] }
      : await followingLiveStreams(FOLLOWING_BOOST);

    if (boosted.length > 0) {
      const boostedIds = new Set(boosted.map((s) => s.id));
      ordered = [...boosted, ...ordered.filter((s) => !boostedIds.has(s.id))];
    }

    // 팔로우 상태를 한 번에 붙인다. 아이템마다 조회하면 페이지당 N번 왕복한다.
    const { following, viewerId } = await getFollowingSet(
      ordered.map((s) => s.user_id),
    );

    const nextCursor = hasMore ? page[page.length - 1].score : null;

    return NextResponse.json({
      data: decorate(ordered, following, viewerId),
      cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[Feed] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
