import { NextResponse } from 'next/server';
import { redis } from '@/shared/lib/redis';
import { supabaseAdmin } from '@/shared/lib/supabase-admin';

/**
 * 의존성 헬스체크.
 *
 * **"앱이 200을 준다"는 살아있다는 뜻이 아니다.** Redis가 죽으면 라이브 목록이
 * 비고, Postgres가 죽으면 로그인이 안 되는데, 페이지 자체는 멀쩡히 뜬다.
 * 그래서 셋을 각각 따로 찔러보고 어느 것이 죽었는지 이름으로 알려준다.
 *
 * 셋 중 하나라도 죽으면 503이다. 업타임 모니터가 이 상태코드만 보고 판단한다.
 *
 * 인증을 걸지 않는다 — 모니터링 도구가 붙어야 하기 때문이다. 대신 **이유는
 * 내보내지 않는다.** 연결 실패 메시지에는 호스트명·포트·자격증명 흔적이 섞이고,
 * 그건 공개 엔드포인트에 실을 것이 못 된다. 원인은 로그에만 남긴다.
 */

// 항상 실제로 찔러본다. 캐시된 200은 헬스체크가 아니다.
export const dynamic = 'force-dynamic';

/** 하나가 느리다고 헬스체크 전체가 매달리면 안 된다 */
const TIMEOUT_MS = 3_000;

type CheckResult = { ok: true } | { ok: false; error: string };

async function withTimeout(
  name: string,
  fn: () => Promise<unknown>,
): Promise<CheckResult> {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Health] ${name} 실패:`, message);
    return { ok: false, error: message };
  }
}

export async function GET() {
  const [redisCheck, postgresCheck, mediaCheck] = await Promise.all([
    withTimeout('redis', () => redis.ping()),

    // 가장 싼 실제 쿼리. 행을 읽지 않고 개수만 센다.
    withTimeout('postgres', async () => {
      const { error } = await supabaseAdmin
        .from('streams')
        .select('id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
    }),

    // 관리 API는 루프백 바인딩이라 외부에서 못 부른다. 앱만 확인할 수 있다.
    withTimeout('mediamtx', async () => {
      const base = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';
      const res = await fetch(`${base}/v3/paths/list`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }),
  ]);

  const checks = {
    redis: redisCheck.ok,
    postgres: postgresCheck.ok,
    mediamtx: mediaCheck.ok,
  };
  const healthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    { status: healthy ? 200 : 503 },
  );
}
