import { CompactEncrypt, compactDecrypt } from 'jose';

/**
 * 토스페이먼츠 지급대행 API 클라이언트.
 *
 * 일반 결제 API와 달리 **Request Body가 있는 POST는 전부 JWE로 암호화**해야
 * 한다. 토스와 직접 계약하지 않은 셀러에게 돈을 보내는 서비스라 보안 요구가
 * 더 강하다. 응답도 같은 키로 암호화되어 돌아온다.
 *   - alg: dir, enc: A256GCM
 *   - 커스텀 헤더 iat(ISO8601, KST), nonce(UUID) 필수
 *   - 헤더 `TossPayments-api-security-mode: ENCRYPTION`
 *   - 시크릿 키로 Basic 인증도 함께
 *
 * GET(잔액 조회, 셀러 조회)과 Body 없는 POST(지급 취소)는 암호화하지 않는다.
 *
 * 문서: https://docs.tosspayments.com/guides/v2/payouts
 */

const API_BASE = 'https://api.tosspayments.com';

export class TossPayoutError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'TossPayoutError';
  }
}

/** 지급대행 키가 설정되어 있는지. 사업자 인증 전에는 false다. */
export function isPayoutConfigured(): boolean {
  return Boolean(
    process.env.TOSS_SECRET_KEY && process.env.TOSS_PAYOUT_SECURITY_KEY,
  );
}

function credentials() {
  const secretKey = process.env.TOSS_SECRET_KEY;
  const securityKey = process.env.TOSS_PAYOUT_SECURITY_KEY;

  if (!secretKey || !securityKey) {
    throw new TossPayoutError(
      'NOT_CONFIGURED',
      '지급대행 API 키가 설정되지 않았습니다 (TOSS_SECRET_KEY, TOSS_PAYOUT_SECURITY_KEY)',
      503,
    );
  }

  // 보안 키는 64자 hex 문자열. A256GCM이 32바이트 키를 요구하므로 바이트로 변환한다.
  if (!/^[0-9a-fA-F]{64}$/.test(securityKey)) {
    throw new TossPayoutError(
      'INVALID_SECURITY_KEY',
      '보안 키는 64자 Hex 문자열이어야 합니다',
      500,
    );
  }

  return {
    authHeader: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
    securityKey: hexToBytes(securityKey),
  };
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** `yyyy-MM-dd'T'HH:mm:ss+09:00` — 토스가 요구하는 iat 형식 */
export function kstTimestamp(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.toISOString().slice(0, 19)}+09:00`;
}

export async function encryptBody(
  body: unknown,
  securityKey: Uint8Array,
): Promise<string> {
  return new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify(body)),
  )
    .setProtectedHeader({
      alg: 'dir',
      enc: 'A256GCM',
      iat: kstTimestamp(),
      nonce: crypto.randomUUID(),
    })
    .encrypt(securityKey);
}

export async function decryptBody<T>(
  jwe: string,
  securityKey: Uint8Array,
): Promise<T> {
  const { plaintext } = await compactDecrypt(jwe, securityKey);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

interface TossEnvelope<T> {
  version: string;
  traceId: string;
  entityType: string;
  entityBody: T;
}

interface TossErrorBody {
  error?: { code?: string; message?: string };
  code?: string;
  message?: string;
}

function toError(body: TossErrorBody, status: number): TossPayoutError {
  const code = body.error?.code ?? body.code ?? 'UNKNOWN';
  const message = body.error?.message ?? body.message ?? '지급대행 요청 실패';
  return new TossPayoutError(code, message, status);
}

/**
 * 암호화가 필요한 POST 요청.
 *
 * 멱등키를 넣으면 같은 요청이 두 번 가도 중복 지급되지 않는다. 다만 에러가
 * 났을 때 멱등키를 바꿔서 재시도하는 건 위험하다 — 원인을 확인하고 보내야 한다.
 */
async function encryptedPost<T>(
  path: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const { authHeader, securityKey } = credentials();

  const headers: Record<string, string> = {
    Authorization: authHeader,
    'Content-Type': 'text/plain',
    'TossPayments-api-security-mode': 'ENCRYPTION',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: await encryptBody(body, securityKey),
  });

  const text = (await res.text()).trim();

  // 성공·실패 응답 모두 암호화되어 돌아온다
  if (!text) {
    if (res.ok) return undefined as T;
    throw new TossPayoutError('EMPTY_RESPONSE', '빈 응답', res.status);
  }

  let decoded: unknown;
  try {
    decoded = await decryptBody<unknown>(text, securityKey);
  } catch {
    // 암호화 이전 단계(인증 실패 등)에서 막히면 평문 JSON이 온다
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new TossPayoutError('DECRYPT_FAILED', text.slice(0, 200), res.status);
    }
  }

  if (!res.ok) throw toError(decoded as TossErrorBody, res.status);
  return (decoded as TossEnvelope<T>).entityBody ?? (decoded as T);
}

/** 암호화가 필요 없는 요청 (GET, Body 없는 POST) */
async function plainRequest<T>(
  method: 'GET' | 'POST',
  path: string,
): Promise<T> {
  const { authHeader } = credentials();

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: authHeader },
  });

  const text = (await res.text()).trim();
  if (!text) {
    if (res.ok) return undefined as T;
    throw new TossPayoutError('EMPTY_RESPONSE', '빈 응답', res.status);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new TossPayoutError('PARSE_FAILED', text.slice(0, 200), res.status);
  }

  if (!res.ok) throw toError(decoded as TossErrorBody, res.status);

  const envelope = decoded as TossEnvelope<T>;
  return envelope.entityBody ?? (decoded as T);
}

export const tossPayoutApi = {
  createSeller: <T>(body: unknown) => encryptedPost<T>('/v2/sellers', body),
  updateSeller: <T>(sellerId: string, body: unknown) =>
    encryptedPost<T>(`/v2/sellers/${sellerId}`, body),
  getSeller: <T>(sellerId: string) =>
    plainRequest<T>('GET', `/v2/sellers/${sellerId}`),
  createPayouts: <T>(body: unknown, idempotencyKey: string) =>
    encryptedPost<T>('/v2/payouts', body, idempotencyKey),
  cancelPayout: <T>(payoutId: string) =>
    plainRequest<T>('POST', `/v2/payouts/${payoutId}/cancel`),
  getBalance: <T>() => plainRequest<T>('GET', '/v2/balances'),
};
