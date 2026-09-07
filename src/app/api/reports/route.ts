import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/shared/lib/supabase-server';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import { redis } from '@/shared/lib/redis';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TARGET_TYPES = ['stream', 'user', 'message'] as const;
const MAX_REASON = 500;

/** 1분에 5건. 신고 폭탄 방지 */
const RATE_WINDOW_SEC = 60;
const RATE_LIMIT = 5;

/**
 * 신고 접수.
 *
 * 같은 사람이 같은 대상을 여러 번 신고해도 한 건이다(DB 유니크 인덱스).
 * 판단 근거는 신고 "횟수"가 아니라 "몇 명이 신고했는가"여야 한다 —
 * 아니면 한 사람이 반복 신고로 아무나 내릴 수 있다.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 });
    }

    const key = `ratelimit:reports:${user.id}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_WINDOW_SEC);
    if (count > RATE_LIMIT) {
      return NextResponse.json(
        { error: '신고가 너무 많습니다. 잠시 후 다시 시도해주세요' },
        { status: 429 },
      );
    }

    const { targetType, targetId, reason, context } = await request.json();

    if (!TARGET_TYPES.includes(targetType)) {
      return NextResponse.json({ error: '잘못된 대상입니다' }, { status: 400 });
    }
    if (!UUID_RE.test(targetId ?? '')) {
      return NextResponse.json({ error: '잘못된 대상입니다' }, { status: 400 });
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return NextResponse.json(
        { error: '신고 사유를 입력해주세요' },
        { status: 400 },
      );
    }
    if (targetType === 'user' && targetId === user.id) {
      return NextResponse.json(
        { error: '자기 자신은 신고할 수 없습니다' },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin.from('reports').insert({
      reporter_id: user.id,
      target_type: targetType,
      target_id: targetId,
      reason: reason.trim().slice(0, MAX_REASON),
      context:
        typeof context === 'string' ? context.trim().slice(0, 500) : null,
    });

    // 23505 = 이미 신고함. 중복 신고를 에러로 돌리면 "신고가 안 됐나?" 싶어
    // 다시 누르게 된다. 접수된 상태이므로 성공으로 응답한다.
    if (error && error.code !== '23505') {
      console.error('[Report] insert error:', error);
      return NextResponse.json(
        { error: '신고 접수에 실패했습니다' },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: { ok: true }, error: null });
  } catch (err) {
    console.error('[Report] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
