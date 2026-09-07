import { supabaseAdmin } from '@/shared/lib/supabase-admin';
import type { SignalKind, SignalTargetType } from '@/domains/feed/signals';

/**
 * 서버가 관측한 신호를 기록한다.
 *
 * **팔로우·후원처럼 조작하면 이득이 생기는 신호는 클라이언트에서 받지 않는다.**
 * 체류 시간은 위조돼도 자기 피드만 이상해지지만, "후원했다"는 신호를 위조하면
 * 남의 방송을 추천 상위로 밀어 올릴 수 있다. 그래서 이 경로만 쓴다.
 * (후원 알림을 클라이언트 emit에서 걷어낸 것과 같은 이유 — ISSUES.md #18)
 *
 * 실패해도 던지지 않는다. 신호 기록이 팔로우나 후원을 막으면 안 된다.
 */
export async function recordSignal(params: {
  userId: string;
  targetType: SignalTargetType;
  targetId: string;
  kind: SignalKind;
  category?: string | null;
}): Promise<void> {
  try {
    await supabaseAdmin.from('feed_events').insert({
      user_id: params.userId,
      target_type: params.targetType,
      target_id: params.targetId,
      kind: params.kind,
      category: params.category ?? null,
    });
  } catch (err) {
    console.error('[Signals] record failed:', err);
  }
}

/**
 * 방송자의 현재 카테고리.
 *
 * 취향의 축은 카테고리인데 팔로우 신호에는 방송이 끼어 있지 않다.
 * 그 사람의 최근 방송 카테고리로 대신한다.
 */
export async function categoryOfStreamer(
  userId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('streams')
    .select('category')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.category ?? null;
}
