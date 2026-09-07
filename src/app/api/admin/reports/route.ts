import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { requireAdmin } from '@/domains/moderation/services/admin';

/**
 * 신고 큐.
 *
 * 대상별로 묶어서 준다 — 같은 방송에 신고가 20건 몰렸으면 20줄이 아니라
 * 한 줄에 "신고 20건"으로 보여야 무엇이 급한지 보인다.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get('status') ?? 'open';

  const { data: reports, error } = await supabaseAdmin
    .from('reports')
    .select(
      'id, target_type, target_id, reason, context, status, created_at, reporter_id',
    )
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error('[Admin] reports error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  // 대상별 집계
  const groups = new Map<
    string,
    {
      target_type: string;
      target_id: string;
      count: number;
      reasons: string[];
      report_ids: string[];
      first_at: string;
    }
  >();

  for (const r of reports ?? []) {
    const key = `${r.target_type}:${r.target_id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (existing.reasons.length < 5) existing.reasons.push(r.reason);
      existing.report_ids.push(r.id);
    } else {
      groups.set(key, {
        target_type: r.target_type,
        target_id: r.target_id,
        count: 1,
        reasons: [r.reason],
        report_ids: [r.id],
        first_at: r.created_at,
      });
    }
  }

  // 신고 대상의 이름을 붙인다. id만 보여주면 판단이 불가능하다.
  const userIds = [...groups.values()]
    .filter((g) => g.target_type === 'user')
    .map((g) => g.target_id);
  const streamIds = [...groups.values()]
    .filter((g) => g.target_type === 'stream')
    .map((g) => g.target_id);

  const [{ data: users }, { data: streams }] = await Promise.all([
    userIds.length
      ? supabaseAdmin.from('users').select('id, nickname').in('id', userIds)
      : Promise.resolve({ data: [] }),
    streamIds.length
      ? supabaseAdmin
          .from('streams')
          .select('id, title, status, user_id, users!inner(nickname)')
          .in('id', streamIds)
      : Promise.resolve({ data: [] }),
  ]);

  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const streamById = new Map((streams ?? []).map((s) => [s.id, s]));

  const items = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map((g) => ({
      ...g,
      target:
        g.target_type === 'user'
          ? (userById.get(g.target_id) ?? null)
          : g.target_type === 'stream'
            ? (streamById.get(g.target_id) ?? null)
            : null,
    }));

  return NextResponse.json({ data: items, error: null });
}
