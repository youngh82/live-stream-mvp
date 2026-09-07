-- ============================================
-- 009: 취향 신호 수집
-- ============================================
--
-- **알고리즘은 Phase 13이지만 수집은 지금 시작한다.**
-- 오늘 안 쌓으면 3개월 뒤에도 데이터가 0이라 그때 또 몇 달을 기다린다.
--
-- 구조는 원장(feed_events) + 집계(user_taste) 두 층이다.
-- 원장은 금방 커지므로 처음부터 짧게 보관하고, 랭킹은 집계만 읽는다.

-- --------------------------------------------
-- 원장 — append-only, 7일 보관
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS feed_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('stream', 'post')),
  target_id   UUID NOT NULL,
  -- impression: 화면에 떴다 / dwell: 머문 시간 / skip: 짧게 보고 넘김
  -- chat·donation·follow·profile: 명시적 관심 행동
  kind        TEXT NOT NULL CHECK (kind IN (
                'impression', 'dwell', 'skip',
                'chat', 'donation', 'follow', 'profile'
              )),
  -- 체류 시간(ms). 클라이언트가 보내는 값이라 상한을 DB에서도 막는다.
  -- 위조해도 5분을 넘길 수 없다 — 서버 검증과 이중으로 건다.
  dwell_ms    INTEGER CHECK (dwell_ms IS NULL OR (dwell_ms >= 0 AND dwell_ms <= 300000)),
  -- 랭킹의 축. 이벤트 시점의 값을 그대로 박아둔다.
  -- 방송자가 나중에 카테고리를 바꿔도 과거 신호의 의미가 흔들리면 안 된다.
  category    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 집계 배치가 "최근 N일, 이 유저" 순으로 읽는다
CREATE INDEX IF NOT EXISTS idx_feed_events_user_time
  ON feed_events (user_id, created_at DESC);

-- 보관 기간 정리 배치용
CREATE INDEX IF NOT EXISTS idx_feed_events_created
  ON feed_events (created_at);

-- --------------------------------------------
-- 집계 — 랭킹은 이 테이블만 읽는다
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS user_taste (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  score      REAL NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, category)
);

-- --------------------------------------------
-- 권한
--
-- 신호는 **서버(service role)만** 쓴다.
-- 클라이언트가 직접 INSERT할 수 있으면 자기 취향 점수를 마음대로 만들고,
-- 그건 곧 피드 노출 조작이다. 수집은 /api/signals가 검증한 뒤에만 한다.
-- 읽기도 열지 않는다 — 남의 시청 이력은 민감 정보다.
-- --------------------------------------------
ALTER TABLE feed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_taste  ENABLE ROW LEVEL SECURITY;

-- 정책 없음 = service_role 외에는 아무도 접근 못 함 (004의 processed_stripe_events와 같은 방식)
REVOKE ALL ON public.feed_events FROM anon, authenticated;
REVOKE ALL ON public.user_taste  FROM anon, authenticated;

-- --------------------------------------------
-- 원장 정리
--
-- 7일이 지난 신호는 지운다. 집계(user_taste)에 이미 반영된 뒤이므로
-- 원장을 들고 있을 이유가 없고, 이 테이블은 방치하면 가장 먼저 커진다.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION prune_feed_events(p_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM feed_events
  WHERE created_at < now() - (p_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.prune_feed_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_feed_events(INTEGER) TO service_role;
