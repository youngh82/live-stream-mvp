-- ============================================
-- 011: 신고 + 운영자 권한
-- ============================================
--
-- 010은 **방송자가 시청자를** 제재하는 수단이다.
-- 이 파일은 그 반대 방향 — **방송자가 문제일 때** 플랫폼이 개입하는 수단이다.
-- 불법 촬영물·미성년자 노출·저작권 침해는 트래픽이 생기면 온다.
-- 정보통신망법상 신고 접수·처리 절차도 갖춰야 한다.

-- --------------------------------------------
-- 운영자 역할
--
-- ALTER TYPE ... ADD VALUE는 트랜잭션 안에서 쓸 수 없다.
-- psql -f는 문장별 autocommit이라 그대로 실행된다.
-- --------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin';

-- 계정 정지. 하드 삭제가 아니라 기간 정지다 — 기록이 남아야 한다.
--
-- NULL = 정지 아님. 무기한 정지는 먼 미래 날짜(9999-12-31)로 표현한다.
-- 무기한을 NULL로 두면 "정지 아님"과 구분이 안 돼서 곧바로 해제로 읽힌다.
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- role·정지 컬럼은 004의 컬럼 단위 GRANT에 없으므로 클라이언트가 못 바꾼다.
-- (넣지 말 것 — 넣는 순간 누구나 스스로를 운영자로 만들 수 있다)

-- --------------------------------------------
-- 신고
-- --------------------------------------------
CREATE TYPE report_target_type AS ENUM ('stream', 'user', 'message');
CREATE TYPE report_status AS ENUM ('open', 'reviewing', 'resolved', 'rejected');

CREATE TABLE IF NOT EXISTS reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type  report_target_type NOT NULL,
  target_id    UUID NOT NULL,
  -- 신고 당시의 맥락. 방송이 끝나면 무엇을 보고 신고했는지 알 수 없어진다.
  context      TEXT,
  reason       TEXT NOT NULL,
  status       report_status DEFAULT 'open' NOT NULL,
  handled_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at   TIMESTAMPTZ,
  handler_note TEXT,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 운영자 화면은 미처리 신고를 오래된 순으로 본다
CREATE INDEX IF NOT EXISTS idx_reports_open
  ON reports (status, created_at)
  WHERE status IN ('open', 'reviewing');

-- 같은 대상에 대한 신고를 모아 보기 위한 인덱스.
-- 신고가 몰린 대상이 먼저 처리돼야 한다.
CREATE INDEX IF NOT EXISTS idx_reports_target
  ON reports (target_type, target_id, created_at DESC);

-- 도배 방지: 한 사람이 같은 대상을 여러 번 신고해도 한 건이다.
-- 신고 "횟수"가 아니라 "몇 명이 신고했는가"가 판단 근거여야 한다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_reporter
  ON reports (reporter_id, target_type, target_id);

-- --------------------------------------------
-- 권한
--
-- 신고는 서버 API로만 들어온다. 읽기는 본인 것만 — 남의 신고 내역이
-- 보이면 누가 자기를 신고했는지 역추적할 수 있다.
-- 운영자 조회는 service_role(서버)이 담당한다.
-- --------------------------------------------
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reporters can see own reports" ON reports;
CREATE POLICY "Reporters can see own reports"
  ON reports FOR SELECT
  USING (auth.uid() = reporter_id);

REVOKE INSERT, UPDATE, DELETE ON public.reports FROM anon, authenticated;
GRANT SELECT ON public.reports TO authenticated;
