-- ============================================
-- 004: 보안 강화
-- 감사에서 실증된 C-01 ~ C-04, H-02 대응
-- ============================================

-- --------------------------------------------
-- C-01 / C-02: SECURITY DEFINER 함수의 공개 노출 차단
--
-- Supabase는 public 스키마 함수를 PostgREST RPC로 자동 노출한다.
-- add_points / send_donation은 SECURITY DEFINER이므로 anon에게
-- EXECUTE가 남아 있으면 공개 anon key만으로 포인트 발행/탈취가 가능하다.
-- 서버는 service_role로만 호출하므로 앱 동작에는 영향이 없다.
-- --------------------------------------------
REVOKE EXECUTE ON FUNCTION public.add_points(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_donation(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_points(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_donation(UUID, UUID, UUID, INTEGER, TEXT) TO service_role;

-- 트리거 전용 함수도 RPC로 노출될 이유가 없다
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;

-- 앞으로 추가될 함수가 같은 실수를 반복하지 않도록 기본 권한을 막는다
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- send_donation 자체에도 방어선을 추가 (호출자가 service_role인지 확인)
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
  -- 서버(service_role) 경유 호출만 허용. RPC 직접 호출 차단.
  IF current_setting('request.jwt.claim.role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'send_donation must be called server-side';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  IF p_sender_id = p_receiver_id THEN
    RAISE EXCEPTION 'Cannot donate to self';
  END IF;

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

  UPDATE users
  SET point_balance = point_balance + p_amount,
      updated_at = now()
  WHERE id = p_receiver_id;

  INSERT INTO donations (stream_id, sender_id, receiver_id, amount, message)
  VALUES (p_stream_id, p_sender_id, p_receiver_id, p_amount, p_message)
  RETURNING id INTO v_donation_id;

  RETURN v_donation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.send_donation(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_donation(UUID, UUID, UUID, INTEGER, TEXT) TO service_role;

-- --------------------------------------------
-- C-03: users 테이블 컬럼 단위 UPDATE 권한
--
-- RLS는 "어떤 행"을 막을 뿐 "어떤 컬럼"은 막지 않는다.
-- point_balance / role은 서버만 변경할 수 있어야 한다.
-- --------------------------------------------
REVOKE UPDATE ON public.users FROM anon, authenticated;
GRANT UPDATE (nickname, avatar_url) ON public.users TO authenticated;

-- RLS UPDATE 정책에 WITH CHECK을 명시 (수정 후 행도 본인 소유여야 함)
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- --------------------------------------------
-- C-04: stream_key 컬럼을 익명/일반 사용자에게서 격리
--
-- "Streams are viewable by everyone" 정책 때문에 stream_key가
-- 공개 anon key로 그대로 읽혔다. 행 접근은 유지하되 컬럼만 회수한다.
-- --------------------------------------------
REVOKE SELECT ON public.streams FROM anon, authenticated;
GRANT SELECT (
  id, user_id, title, description, category, tags,
  status, viewer_count, thumbnail_url, started_at, ended_at, created_at
) ON public.streams TO anon, authenticated;

-- 방송자 본인도 stream_key는 서버 API(/api/stream/register)로만 받는다.
-- 클라이언트가 직접 UPDATE 하지 못하도록 컬럼을 제한한다.
REVOKE UPDATE ON public.streams FROM anon, authenticated;
GRANT UPDATE (title, description, category, tags, thumbnail_url) ON public.streams TO authenticated;

-- --------------------------------------------
-- H-02: Stripe 웹훅 멱등성
--
-- Stripe는 at-least-once 전달이라 같은 이벤트가 두 번 올 수 있다.
-- event_id를 PK로 먼저 INSERT하고, 유니크 위반이면 중복으로 판단한다.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role 외에는 아무도 접근 못 함
REVOKE ALL ON public.processed_stripe_events FROM anon, authenticated;
