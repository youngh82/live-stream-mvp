/**
 * 지급대행 키 점검.
 *
 * 받은 키로 실제 환전 테스트가 가능한 상태인지 확인한다.
 * 실제 돈이 움직이는 요청은 보내지 않는다 — 잔액 조회(GET)만 호출한다.
 *
 * 실행: pnpm payout:check
 */
import { config } from 'dotenv';

// dotenv/config는 .env만 읽는다. 이 프로젝트는 .env.local을 쓴다.
config({ path: '.env.local' });

const line = (s = '') => console.log(s);
const ok = (s: string) => console.log(`  ✅ ${s}`);
const bad = (s: string) => console.log(`  ❌ ${s}`);
const warn = (s: string) => console.log(`  ⚠️  ${s}`);

/**
 * 토스 키 종류 판별.
 *
 * 결제 키는 중간에 gck/gsk, API 개별 연동 키는 ck/sk가 들어간다.
 * **지급대행은 API 개별 연동 키(sk)를 쓴다.** 결제 키(gsk)로는 안 된다.
 */
function classify(key: string): { env: string; kind: string; usable: boolean } {
  const env = key.startsWith('live_') ? '라이브' : key.startsWith('test_') ? '테스트' : '알 수 없음';

  if (/^(test|live)_gsk_/.test(key))
    return { env, kind: '결제 시크릿 키 (gsk)', usable: false };
  if (/^(test|live)_sk_/.test(key))
    return { env, kind: 'API 개별 연동 시크릿 키 (sk)', usable: true };
  if (/^(test|live)_gck_/.test(key))
    return { env, kind: '결제 클라이언트 키 (gck)', usable: false };
  if (/^(test|live)_ck_/.test(key))
    return { env, kind: 'API 개별 연동 클라이언트 키 (ck)', usable: false };

  return { env, kind: '알 수 없는 형식', usable: false };
}

async function main() {
  line('토스 지급대행 키 점검');

  const secretKey = process.env.TOSS_SECRET_KEY;
  const securityKey = process.env.TOSS_PAYOUT_SECURITY_KEY;

  // ── 1. 시크릿 키 ───────────────────────────────
  line();
  line('[1] TOSS_SECRET_KEY');
  if (!secretKey) {
    bad('설정되지 않음');
  } else {
    const { env, kind, usable } = classify(secretKey);
    line(`  값: ${secretKey.slice(0, 12)}…${secretKey.slice(-4)}`);
    line(`  환경: ${env} / 종류: ${kind}`);
    if (usable) {
      ok('지급대행에 쓸 수 있는 키 형식입니다');
    } else {
      bad('지급대행에 쓸 수 없는 키입니다');
      warn('개발자센터 > API 키 > "API 개별 연동 키"의 시크릿 키가 필요합니다 (test_sk_...)');
      warn('결제용 키(gsk/gck)나 클라이언트 키로는 지급대행 API를 호출할 수 없습니다');
    }
  }

  // ── 2. 보안 키 ────────────────────────────────
  line();
  line('[2] TOSS_PAYOUT_SECURITY_KEY');
  if (!securityKey) {
    bad('설정되지 않음');
    warn('지급대행의 POST 요청은 전부 이 키로 JWE 암호화해야 합니다. 없으면 계좌 등록·지급 요청이 불가능합니다');
    warn('개발자센터 > API 키 > API 개별 키 > "보안 키" (64자 Hex)');
  } else if (!/^[0-9a-fA-F]{64}$/.test(securityKey)) {
    bad(`형식이 맞지 않음 (길이 ${securityKey.length}, 64자 Hex여야 함)`);
  } else {
    ok('64자 Hex — 형식 정상');
  }

  // ── 3. 실제 호출 ──────────────────────────────
  line();
  line('[3] 지급대행 권한 확인 (GET /v2/balances)');

  if (!secretKey) {
    warn('시크릿 키가 없어 건너뜁니다');
    line();
    line('결론: 아직 테스트할 수 없습니다.');
    return;
  }

  const auth = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  let res: Response;
  try {
    res = await fetch('https://api.tosspayments.com/v2/balances', {
      headers: { Authorization: auth },
    });
  } catch (e) {
    bad(`네트워크 오류: ${e instanceof Error ? e.message : e}`);
    return;
  }

  const text = (await res.text()).trim();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* 평문이 아닐 수 있다 */
  }

  const code = String(
    (body.error as { code?: string })?.code ?? body.code ?? '',
  );

  if (res.ok) {
    ok(`호출 성공 (HTTP ${res.status}) — 지급대행이 활성화되어 있습니다`);
    line(`  응답: ${text.slice(0, 200)}`);
    line();
    if (securityKey && /^[0-9a-fA-F]{64}$/.test(securityKey)) {
      line('결론: 환전 전 구간을 테스트할 수 있습니다. pnpm dev 후 /payout 으로 가세요.');
    } else {
      line('결론: 조회는 되지만 보안 키가 없어 계좌 등록·지급 요청은 불가능합니다.');
    }
    return;
  }

  bad(`호출 실패 (HTTP ${res.status}${code ? `, ${code}` : ''})`);
  line(`  응답: ${text.slice(0, 300)}`);
  line();

  if (['UNAUTHORIZED_KEY', 'INVALID_API_KEY', 'INCORRECT_BASIC_AUTH_FORMAT'].includes(code)) {
    warn('키 자체가 인증되지 않았습니다. API 개별 연동 키의 시크릿 키가 맞는지 확인하세요');
  } else if (res.status === 403 || res.status === 404) {
    warn('키는 유효하지만 지급대행 권한이 없어 보입니다');
    warn('토스페이먼츠에 "지급대행 서비스 이용 신청"이 되어 있어야 합니다 (사업자 심사 포함)');
  }

  line('결론: 아직 환전 테스트를 할 수 없습니다.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
