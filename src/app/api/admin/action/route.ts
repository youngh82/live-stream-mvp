import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';
import { requireAdmin } from '@/domains/moderation/services/admin';
import { kickPublisher } from '@/shared/lib/media-server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 무기한 정지의 표현.
 *
 * `suspended_until = NULL`은 이미 "정지 아님"이다. 무기한을 NULL로 두면
 * 둘을 구분할 수 없어서 무기한 정지가 곧바로 해제로 읽힌다.
 * Postgres의 'infinity'를 쓰면 JS에서 Invalid Date가 되어 비교가 false가 되므로
 * (=정지가 안 걸린다) 실제 날짜를 쓴다.
 */
const PERMANENT_SUSPENSION = new Date('9999-12-31T23:59:59Z').toISOString();

type AdminAction = 'end_stream' | 'suspend_user' | 'unsuspend_user' | 'resolve' | 'reject';

/**
 * 운영자 조치.
 *
 * **방송 강제 종료는 DB 상태만 바꾸면 안 된다.** status를 'ended'로 적어도
 * 목록에서 사라질 뿐 송출은 계속되고, URL을 아는 사람은 그대로 본다.
 * MediaMTX 세션을 실제로 끊어야 끝난다.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
    }

    const { action, targetId, reportIds, days, note } = (await request.json()) as {
      action: AdminAction;
      targetId?: string;
      reportIds?: string[];
      days?: number;
      note?: string;
    };

    switch (action) {
      case 'end_stream': {
        if (!UUID_RE.test(targetId ?? '')) {
          return NextResponse.json({ error: '잘못된 대상입니다' }, { status: 400 });
        }

        // 먼저 실제 송출을 끊는다. DB부터 바꾸면 "종료됨"으로 보이는데
        // 여전히 나가고 있는 창이 생긴다.
        const kicked = await kickPublisher(targetId!);

        await supabaseAdmin
          .from('streams')
          .update({ status: 'ended', ended_at: new Date().toISOString() })
          .eq('id', targetId!);

        await redis.zrem('live:streams', targetId!);

        console.warn(
          `[Admin] ${admin.nickname}이(가) 방송 ${targetId} 강제 종료 (세션 ${kicked}개)`,
        );

        return NextResponse.json({ data: { kicked }, error: null });
      }

      case 'suspend_user': {
        if (!UUID_RE.test(targetId ?? '')) {
          return NextResponse.json({ error: '잘못된 대상입니다' }, { status: 400 });
        }

        // days가 없으면 무기한이다
        const until =
          typeof days === 'number' && days > 0
            ? new Date(Date.now() + days * 86400_000).toISOString()
            : PERMANENT_SUSPENSION;

        await supabaseAdmin
          .from('users')
          .update({
            suspended_until: until,
            suspended_reason: note?.slice(0, 500) ?? null,
          })
          .eq('id', targetId!);

        // 정지된 사람이 방송 중이면 같이 내린다
        const { data: liveStreams } = await supabaseAdmin
          .from('streams')
          .select('id')
          .eq('user_id', targetId!)
          .eq('status', 'live');

        for (const s of liveStreams ?? []) {
          await kickPublisher(s.id);
          await supabaseAdmin
            .from('streams')
            .update({ status: 'ended', ended_at: new Date().toISOString() })
            .eq('id', s.id);
          await redis.zrem('live:streams', s.id);
        }

        console.warn(`[Admin] ${admin.nickname}이(가) ${targetId} 정지 (${until ?? '무기한'})`);
        return NextResponse.json({ data: { until }, error: null });
      }

      case 'unsuspend_user': {
        if (!UUID_RE.test(targetId ?? '')) {
          return NextResponse.json({ error: '잘못된 대상입니다' }, { status: 400 });
        }
        await supabaseAdmin
          .from('users')
          .update({ suspended_until: null, suspended_reason: null })
          .eq('id', targetId!);
        return NextResponse.json({ data: { ok: true }, error: null });
      }

      case 'resolve':
      case 'reject': {
        if (!Array.isArray(reportIds) || reportIds.length === 0) {
          return NextResponse.json({ error: '처리할 신고가 없습니다' }, { status: 400 });
        }
        await supabaseAdmin
          .from('reports')
          .update({
            status: action === 'resolve' ? 'resolved' : 'rejected',
            handled_by: admin.id,
            handled_at: new Date().toISOString(),
            handler_note: note?.slice(0, 500) ?? null,
          })
          .in('id', reportIds.slice(0, 200));

        return NextResponse.json({ data: { ok: true }, error: null });
      }

      default:
        return NextResponse.json({ error: '알 수 없는 조치입니다' }, { status: 400 });
    }
  } catch (err) {
    console.error('[Admin] action error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
