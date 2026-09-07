import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import { CATEGORIES } from '@/domains/stream/categories';
import { getFollowingSet } from '@/domains/user/services/follows';

/**
 * 탐색 화면 데이터.
 *
 * **검색창만 두면 빈 화면이 된다.** 검색은 "이름을 아는 사람"을 위한 것이고
 * 대부분의 유저는 찾을 이름이 없다. 그래서 진입 화면에는 고를 것이 있어야 한다.
 *
 * - 카테고리별 라이브 수 (칩)
 * - 지금 인기 라이브 (시청자 많은 순)
 *
 * `category` 파라미터를 주면 그 카테고리의 라이브만 준다.
 */
const LIMIT = 20;

export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get('category');

    // 라이브의 단일 출처는 Redis ZSET이다 (피드와 같은 규칙).
    // DB status로 읽으면 웹훅 유실로 남은 유령 방송이 탐색 화면에 걸린다.
    const liveIds = await redis.zrevrange('live:streams', 0, 499);

    if (liveIds.length === 0) {
      return NextResponse.json({
        data: {
          categories: CATEGORIES.map((c) => ({ ...c, live_count: 0 })),
          streams: [],
        },
        error: null,
      });
    }

    let query = supabaseAdmin
      .from('streams')
      .select(
        'id, title, category, viewer_count, thumbnail_url, started_at, user_id, users!inner(id, nickname, avatar_url)',
      )
      .in('id', liveIds)
      .eq('status', 'live')
      .order('viewer_count', { ascending: false });

    if (category) query = query.eq('category', category);

    const { data: streams, error } = await query.limit(LIMIT);

    if (error) {
      console.error('[Discover] error:', error);
      return NextResponse.json(
        { error: 'Failed to load' },
        { status: 500 },
      );
    }

    // 칩에 붙일 개수는 카테고리 필터와 무관하게 전체 기준이어야 한다.
    // 필터를 건 결과로 세면 고른 칩만 숫자가 남고 나머지가 0이 된다.
    const { data: all } = await supabaseAdmin
      .from('streams')
      .select('category')
      .in('id', liveIds)
      .eq('status', 'live');

    const counts = new Map<string, number>();
    for (const row of all ?? []) {
      if (!row.category) continue;
      counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    }

    // 팔로우 여부를 같이 준다. 피드 끝의 "팔로우해볼 만한 방송자" 추천이
    // 이미 팔로우한 사람을 빼려면 이 값이 필요하다. 한 번에 붙인다 —
    // 카드마다 조회하면 목록 길이만큼 왕복한다.
    const rows = (streams ?? []) as Array<{ user_id: string }>;
    const { following, viewerId } = await getFollowingSet(
      rows.map((s) => s.user_id),
    );

    return NextResponse.json({
      data: {
        categories: CATEGORIES.map((c) => ({
          ...c,
          live_count: counts.get(c.id) ?? 0,
        })),
        streams: rows.map((s) => ({
          ...s,
          is_following: following.has(s.user_id),
          is_me: viewerId === s.user_id,
        })),
      },
      error: null,
    });
  } catch (err) {
    console.error('[Discover] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
