/**
 * 환전 시스템 검증.
 *
 * 토스 API 키 없이 확인할 수 있는 것을 전부 확인한다:
 *   - 금액 계산 불변식 (gross = fee + withholding + net)
 *   - JWE 암복호화가 토스 스펙(dir/A256GCM, iat/nonce)과 맞는지
 *   - 웹훅 서명 검증 로직
 *   - DB 함수: 후원이 revenue_balance로 가는지, 환전 차감·복원이 맞는지,
 *     홀드 기간이 실제로 막는지, 권한이 잠겨 있는지
 *
 * 실행: pnpm verify:payout
 * DB 검사는 임시 유저 2명을 만들었다가 지운다.
 */
import { config } from 'dotenv';

// dotenv/config는 .env만 읽는다. 이 프로젝트는 .env.local을 쓴다.
config({ path: '.env.local' });
import { createHmac } from 'crypto';
import { Client } from 'pg';
import { CompactEncrypt, compactDecrypt, decodeProtectedHeader } from 'jose';
import {
  calculateFees,
  validatePayoutAmount,
  MIN_PAYOUT,
} from '../src/domains/payout/services/fees';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── 1. 금액 계산 ────────────────────────────────────────────
function testFees() {
  console.log('\n[금액 계산]');

  for (const gross of [10_000, 12_345, 99_999, 1_000_000, 7]) {
    const f = calculateFees(gross, 'INDIVIDUAL');
    check(
      `분해 합계 일치 (${gross.toLocaleString()})`,
      f.gross === f.fee + f.withholding + f.net,
      `${f.fee} + ${f.withholding} + ${f.net} ≠ ${f.gross}`,
    );
    check(
      `음수 없음 (${gross.toLocaleString()})`,
      f.fee >= 0 && f.withholding >= 0 && f.net >= 0,
    );
  }

  const corp = calculateFees(100_000, 'CORPORATE');
  check('법인은 원천징수 없음', corp.withholding === 0);

  const indiv = calculateFees(100_000, 'INDIVIDUAL');
  check(
    '개인은 원천징수 있음',
    indiv.withholding > 0 && indiv.net < corp.net,
  );

  check(
    '최소 금액 미만은 거부',
    validatePayoutAmount(MIN_PAYOUT - 1, 10_000_000) !== null,
  );
  check(
    '가용액 초과는 거부',
    validatePayoutAmount(MIN_PAYOUT, MIN_PAYOUT - 1) !== null,
  );
  check('소수점은 거부', validatePayoutAmount(10_000.5, 10_000_000) !== null);
  check(
    '정상 금액은 통과',
    validatePayoutAmount(MIN_PAYOUT, 10_000_000) === null,
  );
}

// ── 2. JWE (토스 ENCRYPTION 보안) ──────────────────────────
async function testJwe() {
  console.log('\n[JWE 암복호화]');

  const hex = 'ab'.repeat(32); // 64자 hex
  const key = Uint8Array.from(Buffer.from(hex, 'hex'));
  check('보안 키가 32바이트로 변환됨', key.length === 32);

  const body = {
    refPayoutId: 'test-1',
    amount: { currency: 'KRW', value: 5000 },
  };
  const iat = `${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19)}+09:00`;

  const jwe = await new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify(body)),
  )
    .setProtectedHeader({
      alg: 'dir',
      enc: 'A256GCM',
      iat,
      nonce: crypto.randomUUID(),
    })
    .encrypt(key);

  check('compact 직렬화 5파트', jwe.split('.').length === 5);

  const header = decodeProtectedHeader(jwe) as Record<string, unknown>;
  check('alg=dir', header.alg === 'dir');
  check('enc=A256GCM', header.enc === 'A256GCM');
  check(
    'iat 형식 yyyy-MM-ddTHH:mm:ss+09:00',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(String(header.iat)),
  );
  check('nonce 존재', typeof header.nonce === 'string');

  const { plaintext } = await compactDecrypt(jwe, key);
  check(
    '왕복 후 동일',
    new TextDecoder().decode(plaintext) === JSON.stringify(body),
  );

  const wrongKey = Uint8Array.from(Buffer.from('cd'.repeat(32), 'hex'));
  let rejected = false;
  try {
    await compactDecrypt(jwe, wrongKey);
  } catch {
    rejected = true;
  }
  check('다른 키로는 복호화 실패', rejected);
}

// ── 3. 웹훅 서명 ───────────────────────────────────────────
function testWebhookSignature() {
  console.log('\n[웹훅 서명 검증]');

  const securityKey = 'ab'.repeat(32);
  const payload = JSON.stringify({ eventType: 'payout.changed' });
  const time = '2024-09-05T12:19:21+09:00';
  const message = `${payload}:${time}`;

  const sigHex = createHmac('sha256', Buffer.from(securityKey, 'hex'))
    .update(message)
    .digest('base64');
  const sigUtf8 = createHmac('sha256', Buffer.from(securityKey, 'utf8'))
    .update(message)
    .digest('base64');

  // 라우트와 같은 로직을 여기서 재현한다
  const verify = (header: string) => {
    const keys = [
      Buffer.from(securityKey, 'utf8'),
      Buffer.from(securityKey, 'hex'),
    ];
    const digests = keys.map((k) =>
      createHmac('sha256', k).update(message).digest(),
    );
    return header
      .split(',')
      .map((p) => Buffer.from(p.trim().replace(/^v1:/, ''), 'base64'))
      .some((c) => digests.some((d) => d.equals(c)));
  };

  check('hex 키 서명 통과', verify(`v1:${sigHex}`));
  check('utf8 키 서명 통과', verify(`v1:${sigUtf8}`));
  check('두 개 중 하나만 맞아도 통과', verify(`v1:AAAA,v1:${sigHex}`));
  check('위조 서명 거부', !verify('v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='));
  check('빈 서명 거부', !verify('v1:'));
}

// ── 4. DB 함수 ────────────────────────────────────────────
async function testDatabase() {
  console.log('\n[DB 함수]');

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('  ⏭  DATABASE_URL 없음 — DB 검사 건너뜀');
    return;
  }

  const db = new Client({ connectionString: url });
  await db.connect();

  const streamer = crypto.randomUUID();
  const viewer = crypto.randomUUID();
  const streamId = crypto.randomUUID();
  // 재실행 시 ref_payout_id 유니크 제약에 걸리지 않게 실행마다 다른 값을 쓴다
  const run = crypto.randomUUID().slice(0, 8);

  try {
    // auth.users FK 때문에 트랜잭션 안에서 제약을 미룰 수 없다.
    // 테스트용 행을 직접 넣고 끝나면 지운다.
    await db.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now()),
              ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $4, '', now(), now())`,
      [streamer, `t-${streamer}@test.local`, viewer, `t-${viewer}@test.local`],
    );

    // 트리거가 users 행을 만든다. 닉네임만 갱신하고 잔액을 세팅한다.
    await db.query(
      `UPDATE users SET point_balance = 0, revenue_balance = 0 WHERE id = ANY($1)`,
      [[streamer, viewer]],
    );
    await db.query(`UPDATE users SET point_balance = 100000 WHERE id = $1`, [
      viewer,
    ]);

    await db.query(
      `INSERT INTO streams (id, user_id, title, stream_key, status)
       VALUES ($1, $2, 'test', $3, 'live')`,
      [streamId, streamer, crypto.randomUUID()],
    );

    // 4-1. 후원이 수익 잔액으로 가는가
    await db.query(`SELECT send_donation($1, $2, $3, $4, NULL)`, [
      streamId,
      viewer,
      streamer,
      50_000,
    ]);

    const after = await db.query(
      `SELECT point_balance, revenue_balance FROM users WHERE id = ANY($1) ORDER BY id = $2`,
      [[streamer, viewer], streamer],
    );
    const s = await db.query(
      `SELECT point_balance, revenue_balance FROM users WHERE id = $1`,
      [streamer],
    );
    const v = await db.query(
      `SELECT point_balance, revenue_balance FROM users WHERE id = $1`,
      [viewer],
    );
    void after;

    check(
      '후원금이 수신자 revenue_balance로 들어감',
      s.rows[0].revenue_balance === 50_000,
      `revenue=${s.rows[0].revenue_balance}`,
    );
    check(
      '수신자 충전 포인트는 그대로 (카드깡 차단)',
      s.rows[0].point_balance === 0,
      `point=${s.rows[0].point_balance}`,
    );
    check(
      '발신자 충전 포인트에서 차감',
      v.rows[0].point_balance === 50_000,
      `point=${v.rows[0].point_balance}`,
    );

    // 4-2. 홀드 기간이 막는가 (방금 받은 후원이라 가용액 0이어야 한다)
    const held = await db.query(`SELECT available_revenue($1, 14) AS a`, [
      streamer,
    ]);
    check(
      '방금 받은 후원은 홀드로 막힘',
      held.rows[0].a === 0,
      `available=${held.rows[0].a}`,
    );

    // 후원 시각을 과거로 돌려 홀드를 통과시킨다
    await db.query(
      `UPDATE donations SET created_at = now() - interval '30 days' WHERE receiver_id = $1`,
      [streamer],
    );
    const free = await db.query(`SELECT available_revenue($1, 14) AS a`, [
      streamer,
    ]);
    check(
      '홀드 기간 지나면 가용액이 됨',
      free.rows[0].a === 50_000,
      `available=${free.rows[0].a}`,
    );

    // 4-3. 계좌 없이 환전 시도 → 거부
    let noAccount = false;
    try {
      await db.query(
        `SELECT request_payout($1,$2,$3,$4,$5,$6,$7,$8,$9,14)`,
        [streamer, `ref-1-${run}`, 10000, 2000, 264, 7736, 0.2, 'SCHEDULED', '2030-01-02'],
      );
    } catch {
      noAccount = true;
    }
    check('계좌 미등록이면 환전 거부', noAccount);

    // 계좌를 승인 상태로 등록
    await db.query(
      `INSERT INTO payout_accounts (user_id, provider_seller_id, ref_seller_id, business_type, status, bank_code, account_masked, holder_name)
       VALUES ($1, $2, $3, 'INDIVIDUAL', 'PARTIALLY_APPROVED', '004', '123****789', '테스트')`,
      [streamer, `seller-${streamer.slice(0, 8)}`, streamer.replace(/-/g, '').slice(0, 20)],
    );

    // 4-4. 금액 분해가 안 맞으면 거부
    let mismatch = false;
    try {
      await db.query(
        `SELECT request_payout($1,$2,$3,$4,$5,$6,$7,$8,$9,14)`,
        [streamer, `ref-bad-${run}`, 10000, 2000, 264, 9999, 0.2, 'SCHEDULED', '2030-01-02'],
      );
    } catch {
      mismatch = true;
    }
    check('gross ≠ fee+세금+net 이면 거부', mismatch);

    // 4-5. 가용액 초과 거부
    let over = false;
    try {
      await db.query(
        `SELECT request_payout($1,$2,$3,$4,$5,$6,$7,$8,$9,14)`,
        [streamer, `ref-over-${run}`, 60000, 12000, 1584, 46416, 0.2, 'SCHEDULED', '2030-01-02'],
      );
    } catch {
      over = true;
    }
    check('가용액 초과 환전 거부', over);

    // 4-6. 정상 환전 → 즉시 차감
    const f = calculateFees(30_000, 'INDIVIDUAL');
    const created = await db.query(
      `SELECT request_payout($1,$2,$3,$4,$5,$6,$7,$8,$9,14) AS id`,
      [streamer, `ref-ok-${run}`, f.gross, f.fee, f.withholding, f.net, f.feeRate, 'SCHEDULED', '2030-01-02'],
    );
    const payoutId = created.rows[0].id;

    const afterReq = await db.query(
      `SELECT revenue_balance FROM users WHERE id = $1`,
      [streamer],
    );
    check(
      '환전 신청 시 수익 잔액 즉시 차감',
      afterReq.rows[0].revenue_balance === 20_000,
      `revenue=${afterReq.rows[0].revenue_balance}`,
    );

    // 4-7. 실패 시 복원
    const reverted = await db.query(
      `SELECT revert_payout($1, 'FAILED', 'BANK_ERROR', '은행 오류') AS ok`,
      [payoutId],
    );
    check('실패 처리 성공', reverted.rows[0].ok === true);

    const afterRevert = await db.query(
      `SELECT revenue_balance FROM users WHERE id = $1`,
      [streamer],
    );
    check(
      '실패하면 수익 잔액 복원',
      afterRevert.rows[0].revenue_balance === 50_000,
      `revenue=${afterRevert.rows[0].revenue_balance}`,
    );

    // 4-8. 두 번 복원해도 돈이 늘지 않아야 한다
    const second = await db.query(
      `SELECT revert_payout($1, 'FAILED', NULL, NULL) AS ok`,
      [payoutId],
    );
    const afterDouble = await db.query(
      `SELECT revenue_balance FROM users WHERE id = $1`,
      [streamer],
    );
    check('중복 복원은 무시됨', second.rows[0].ok === false);
    check(
      '중복 복원해도 잔액 그대로',
      afterDouble.rows[0].revenue_balance === 50_000,
      `revenue=${afterDouble.rows[0].revenue_balance}`,
    );

    // 4-9. 권한: anon/authenticated는 실행 불가
    const perm = await db.query(
      `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              p.proname
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('request_payout','revert_payout','available_revenue','send_donation')`,
    );
    for (const row of perm.rows) {
      check(
        `${row.proname}: anon/authenticated 실행 차단`,
        row.anon === false && row.auth === false,
      );
    }
  } finally {
    // payouts.user_id는 ON DELETE RESTRICT다 — 금전 기록이 유저 삭제로
    // 조용히 사라지면 안 되기 때문. 테스트 데이터는 명시적으로 지운다.
    await db.query(`DELETE FROM payouts WHERE user_id = ANY($1)`, [
      [streamer, viewer],
    ]);
    await db.query(`DELETE FROM payout_accounts WHERE user_id = ANY($1)`, [
      [streamer, viewer],
    ]);
    await db.query(`DELETE FROM auth.users WHERE id = ANY($1)`, [
      [streamer, viewer],
    ]);
    await db.end();
  }
}

async function main() {
  console.log('환전 시스템 검증');
  testFees();
  await testJwe();
  testWebhookSignature();
  await testDatabase();

  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
