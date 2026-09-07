import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';

// 라이브 방송 목록. 페이지네이션 방식은 /api/feed와 동일 (시작 시각 커서)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const cursor = searchParams.get('cursor');
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '10'), 1),
      20,
    );

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

    if (raw.length === 0) {
      return NextResponse.json({ data: [], cursor: null, has_more: false });
    }

    const entries: { id: string; score: string }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      entries.push({ id: raw[i], score: raw[i + 1] });
    }

    const hasMore = entries.length > limit;
    const page = entries.slice(0, limit);

    const { data: streams, error } = await supabaseAdmin
      .from('streams')
      .select(
        'id, title, description, category, tags, status, viewer_count, thumbnail_url, started_at, user_id, users!inner(id, nickname, avatar_url)',
      )
      .in(
        'id',
        page.map((e) => e.id),
      )
      .eq('status', 'live');

    if (error) {
      console.error('[Stream] live list error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch streams' },
        { status: 500 },
      );
    }

    const byId = new Map((streams ?? []).map((s) => [s.id, s]));
    const result = page
      .map((e) => byId.get(e.id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));

    const nextCursor = hasMore ? page[page.length - 1].score : null;

    return NextResponse.json({
      data: result,
      cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[Stream] live error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
