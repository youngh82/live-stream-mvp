-- ============================================
-- 005: 환전(지급대행) 시스템
--
-- 핵심은 API 연동이 아니라 **잔액을 두 종류로 쪼개는 것**이다.
-- 지금까지 users.point_balance 하나에 "충전한 돈"과 "후원받은 돈"이
-- 같이 들어 있었다. 여기에 환전을 붙이면 이렇게 된다:
--
--   카드로 100만원 충전 → 내 부계정에 후원 → 환전 → 현금
--
-- 수수료가 카드깡 시세(10~15%)보다 싸면 그대로 카드깡 도구가 된다.
-- 계정 2개면 되고 사후 탐지로는 못 막는다. 그래서 잔액을 나눈다:
--
--   point_balance   = 충전 포인트. 후원에만 쓴다. 환전 불가.
--   revenue_balance = 수익 포인트. 후원으로만 들어온다. 환전만 가능.
--
-- 수익 포인트를 다시 후원에 쓸 수 있으면 A→B→A 돌리기로 경로가
-- 되살아나므로, send_donation은 point_balance만 차감한다.
-- ============================================

-- --------------------------------------------
-- 1. 수익 잔액 분리
-- --------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS revenue_balance INTEGER DEFAULT 0 NOT NULL
    CHECK (revenue_balance >= 0);

COMMENT ON COLUMN users.point_balance IS '충전 포인트. 후원에만 사용. 환전 불가(카드깡 차단)';
COMMENT ON COLUMN users.revenue_balance IS '수익 포인트. 후원 수령분. 환전만 가능';

-- 서버만 건드릴 수 있어야 한다 (004의 컬럼 단위 권한 패턴 유지)
REVOKE UPDATE ON public.users FROM anon, authenticated;
GRANT UPDATE (nickname, avatar_url) ON public.users TO authenticated;

-- --------------------------------------------
-- 2. 지급대행 계좌 (토스 셀러)
-- --------------------------------------------
CREATE TYPE payout_business_type AS ENUM
  ('INDIVIDUAL', 'INDIVIDUAL_BUSINESS', 'CORPORATE');

-- 토스 셀러 상태를 그대로 따라간다.
--   APPROVAL_REQUIRED  등록 직후(개인/개인사업자). 본인인증 문자 발송됨. 지급 불가
--   PARTIALLY_APPROVED 주 1천만원 미만 지급 가능
--   KYC_REQUIRED       주 1천만원 초과 시도 시. 지급 불가. KYC 심사 필요
--   APPROVED           한도 없음
CREATE TYPE payout_account_status AS ENUM
  ('APPROVAL_REQUIRED', 'PARTIALLY_APPROVED', 'KYC_REQUIRED', 'APPROVED');

CREATE TABLE payout_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  provider TEXT NOT NULL DEFAULT 'toss',
  -- 토스가 발급한 셀러 id. 지급 요청의 destination이 된다
  provider_seller_id TEXT UNIQUE,
  -- 우리가 발급하는 셀러 식별자. 토스 제약: 7~20자, 등록 후 수정 불가
  ref_seller_id TEXT UNIQUE NOT NULL,

  business_type payout_business_type NOT NULL,
  status payout_account_status NOT NULL DEFAULT 'APPROVAL_REQUIRED',

  -- 표시용. 전체 계좌번호는 보관하지 않는다 — 토스가 갖고 있고
  -- 지급은 provider_seller_id로만 하므로 우리가 들고 있을 이유가 없다.
  bank_code TEXT NOT NULL,
  account_masked TEXT NOT NULL,
  holder_name TEXT NOT NULL,

  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TRIGGER payout_accounts_updated_at
  BEFORE UPDATE ON payout_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- --------------------------------------------
-- 3. 환전 요청
-- --------------------------------------------
-- 토스 Payout 상태를 그대로 따라간다.
--   REQUESTED → IN_PROGRESS → COMPLETED | FAILED
--   REQUESTED → CANCELED (예약 지급만 취소 가능)
CREATE TYPE payout_status AS ENUM
  ('REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELED');

CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- 우리 식별자(멱등키 겸용)와 토스 식별자
  ref_payout_id TEXT UNIQUE NOT NULL,
  provider_payout_id TEXT UNIQUE,

  -- 금액 분해. 전부 원 단위 정수이고 gross = fee + withholding + net
  gross_amount INTEGER NOT NULL CHECK (gross_amount > 0),
  fee_amount INTEGER NOT NULL CHECK (fee_amount >= 0),
  withholding_amount INTEGER NOT NULL CHECK (withholding_amount >= 0),
  net_amount INTEGER NOT NULL CHECK (net_amount > 0),
  fee_rate NUMERIC(5,4) NOT NULL,

  status payout_status NOT NULL DEFAULT 'REQUESTED',
  schedule_type TEXT NOT NULL DEFAULT 'SCHEDULED',
  payout_date DATE,

  error_code TEXT,
  error_message TEXT,

  requested_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  completed_at TIMESTAMPTZ,

  CONSTRAINT payouts_amount_split
    CHECK (gross_amount = fee_amount + withholding_amount + net_amount)
);

CREATE INDEX idx_payouts_user ON payouts (user_id, requested_at DESC);
CREATE INDEX idx_payouts_open ON payouts (status)
  WHERE status IN ('REQUESTED', 'IN_PROGRESS');

-- --------------------------------------------
-- 4. 홀드 기간
--
-- 후원 결제가 차지백되면 이미 지급한 돈은 회수하지 못한다.
-- (토스 문서: "지급대행으로 지급한 정산 금액은 회수하기 어렵습니다")
-- 그래서 최근 N일 안에 받은 후원은 환전 가능액에서 뺀다.
--
-- 별도 원장 테이블 없이 계산한다. revenue_balance는 후원(+)과
-- 환전(-)으로만 변하므로, 최근 후원 합계를 빼면 그게 가용액이다.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION available_revenue(p_user_id UUID, p_hold_days INTEGER DEFAULT 14)
RETURNS INTEGER AS $$
DECLARE
  v_balance INTEGER;
  v_held INTEGER;
BEGIN
  SELECT revenue_balance INTO v_balance FROM users WHERE id = p_user_id;
  IF v_balance IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_held
  FROM donations
  WHERE receiver_id = p_user_id
    AND created_at > now() - (p_hold_days || ' days')::INTERVAL;

  RETURN GREATEST(v_balance - v_held, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- --------------------------------------------
-- 5. 환전 요청 (원자적 차감 + 기록)
--
-- 금액 계산은 서버(payout/fees.ts)가 하고 여기로 넘어온다.
-- 이 함수는 "잔액이 충분한가"를 잠금 아래에서 확인하고 차감만 한다.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION request_payout(
  p_user_id UUID,
  p_ref_payout_id TEXT,
  p_gross INTEGER,
  p_fee INTEGER,
  p_withholding INTEGER,
  p_net INTEGER,
  p_fee_rate NUMERIC,
  p_schedule_type TEXT,
  p_payout_date DATE,
  p_hold_days INTEGER DEFAULT 14
)
RETURNS UUID AS $$
DECLARE
  v_payout_id UUID;
  v_balance INTEGER;
  v_available INTEGER;
  v_status payout_account_status;
BEGIN
  -- 서버 경유 호출만 허용 (004와 같은 방어선)
  IF current_setting('request.jwt.claim.role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'request_payout must be called server-side';
  END IF;

  IF p_gross IS NULL OR p_gross <= 0 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  IF p_gross <> p_fee + p_withholding + p_net THEN
    RAISE EXCEPTION 'Amount split mismatch';
  END IF;

  SELECT status INTO v_status FROM payout_accounts WHERE user_id = p_user_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Payout account not registered';
  END IF;
  IF v_status NOT IN ('PARTIALLY_APPROVED', 'APPROVED') THEN
    RAISE EXCEPTION 'Payout account not approved: %', v_status;
  END IF;

  -- 잔액을 잠그고 확인한다. 동시 요청 두 건이 같은 잔액을 쓰는 걸 막는다.
  SELECT revenue_balance INTO v_balance
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_available := available_revenue(p_user_id, p_hold_days);

  IF v_available < p_gross THEN
    RAISE EXCEPTION 'Insufficient available revenue: % < %', v_available, p_gross;
  END IF;

  -- 요청 시점에 바로 차감한다(예약). 실패/취소되면 되돌린다.
  UPDATE users
  SET revenue_balance = revenue_balance - p_gross,
      updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO payouts (
    user_id, ref_payout_id, gross_amount, fee_amount,
    withholding_amount, net_amount, fee_rate, schedule_type, payout_date
  ) VALUES (
    p_user_id, p_ref_payout_id, p_gross, p_fee,
    p_withholding, p_net, p_fee_rate, p_schedule_type, p_payout_date
  )
  RETURNING id INTO v_payout_id;

  RETURN v_payout_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- --------------------------------------------
-- 6. 환전 실패/취소 시 잔액 복원
--
-- 웹훅(payout.changed)이 FAILED를 알려주면 호출된다.
-- 같은 payout에 두 번 호출돼도 한 번만 복원되도록 상태로 잠근다.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION revert_payout(
  p_payout_id UUID,
  p_status payout_status,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_gross INTEGER;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'revert_payout must be called server-side';
  END IF;

  IF p_status NOT IN ('FAILED', 'CANCELED') THEN
    RAISE EXCEPTION 'revert_payout expects FAILED or CANCELED';
  END IF;

  -- 아직 열려 있는 건만 되돌린다. 이미 COMPLETED거나 이미 되돌린 건은 건너뛴다.
  UPDATE payouts
  SET status = p_status,
      error_code = p_error_code,
      error_message = p_error_message,
      completed_at = now()
  WHERE id = p_payout_id
    AND status IN ('REQUESTED', 'IN_PROGRESS')
  RETURNING user_id, gross_amount INTO v_user_id, v_gross;

  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE users
  SET revenue_balance = revenue_balance + v_gross,
      updated_at = now()
  WHERE id = v_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- --------------------------------------------
-- 7. send_donation: 수신자를 revenue_balance로
--
-- 004 버전에서 UPDATE 대상 컬럼 하나만 바뀐다. 나머지 방어선
-- (service_role 확인, 금액 범위, 자기후원 금지)은 그대로 유지한다.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION send_donation(
  p_stream_id UUID,
  p_sender_id UUID,
  p_receiver_id UUID,
  p_amount INTEGER,
  p_message TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_donation_id UUID;
  v_balance INTEGER;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'send_donation must be called server-side';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  IF p_sender_id = p_receiver_id THEN
    RAISE EXCEPTION 'Cannot donate to self';
  END IF;

  -- 보내는 쪽은 충전 포인트에서만 나간다.
  -- 수익 포인트로 후원할 수 있으면 A→B→A 돌리기가 가능해진다.
  SELECT point_balance INTO v_balance
  FROM users
  WHERE id = p_sender_id
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  UPDATE users
  SET point_balance = point_balance - p_amount,
      updated_at = now()
  WHERE id = p_sender_id;

  -- 받는 쪽은 수익 포인트로 들어간다. 환전만 가능하고 후원에는 못 쓴다.
  UPDATE users
  SET revenue_balance = revenue_balance + p_amount,
      updated_at = now()
  WHERE id = p_receiver_id;

  INSERT INTO donations (stream_id, sender_id, receiver_id, amount, message)
  VALUES (p_stream_id, p_sender_id, p_receiver_id, p_amount, p_message)
  RETURNING id INTO v_donation_id;

  RETURN v_donation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- --------------------------------------------
-- 8. 토스 웹훅 멱등 (H-02와 같은 패턴)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS processed_toss_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- --------------------------------------------
-- 9. 권한
--
-- 004의 원칙 그대로: 돈을 움직이는 함수는 service_role만.
-- ALTER DEFAULT PRIVILEGES가 이미 걸려 있지만 명시적으로 한 번 더 회수한다.
-- --------------------------------------------
REVOKE EXECUTE ON FUNCTION public.request_payout(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, NUMERIC, TEXT, DATE, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_payout(UUID, payout_status, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.available_revenue(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_donation(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_payout(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, NUMERIC, TEXT, DATE, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_payout(UUID, payout_status, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.available_revenue(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_donation(UUID, UUID, UUID, INTEGER, TEXT) TO service_role;

-- --------------------------------------------
-- 10. RLS
--
-- 본인 것만 읽기. 쓰기는 서버(service_role)만.
-- 계좌 등록/환전 신청은 전부 API를 거친다.
-- --------------------------------------------
ALTER TABLE payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_toss_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own payout account is viewable"
  ON payout_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Own payouts are viewable"
  ON payouts FOR SELECT
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.payout_accounts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payouts FROM anon, authenticated;
REVOKE ALL ON public.processed_toss_events FROM anon, authenticated;
