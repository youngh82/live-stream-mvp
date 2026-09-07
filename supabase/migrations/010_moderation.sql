-- ============================================
-- 010: 모더레이션 (채팅 제재)
-- ============================================
--
-- 방송자가 자기 방에서 시청자를 제재한다. 플랫폼 전역 제재는 운영자
-- 권한이라 별개다(011).
--
-- **채널은 users.id다. streams.id가 아니다.**
-- 스트림 단위로 묶으면 방송을 껐다 켤 때마다 차단이 초기화된다.

CREATE TYPE moderation_action AS ENUM (
  'timeout', 'ban', 'unban', 'delete_message'
);

-- --------------------------------------------
-- 현재 유효한 제재 (1인 1행)
--
-- 타임아웃 / 기간 차단 / 영구 차단을 따로 만들지 않는다.
-- 셋 다 expires_at 하나로 표현된다 — NULL이면 영구다.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS channel_bans (
  channel_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 방송자
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 대상
  expires_at TIMESTAMPTZ,                                            -- NULL = 영구
  reason     TEXT,
  -- 지금은 방송자 본인뿐이다. 나중에 모더레이터(부방장)가 들어올 자리.
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (channel_id, user_id),
  CONSTRAINT no_self_ban CHECK (channel_id <> user_id)
);

-- 차단 목록 화면: 만료 임박한 것부터
CREATE INDEX IF NOT EXISTS idx_channel_bans_channel
  ON channel_bans (channel_id, created_at DESC);

-- --------------------------------------------
-- 감사 로그 (append-only)
--
-- 해제하면 channel_bans 행은 사라지지만 "누가 언제 왜 차단했나"는 남아야 한다.
-- 분쟁·환불 문의에서 이 기록이 유일한 근거다.
-- payouts를 ON DELETE RESTRICT로 둔 것과 같은 이유다.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS moderation_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action           moderation_action NOT NULL,
  duration_seconds INTEGER,
  reason           TEXT,
  created_at       TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_channel
  ON moderation_logs (channel_id, created_at DESC);

-- --------------------------------------------
-- 채널별 채팅 설정
--
-- 슬로우 모드는 기존 Redis rate limit의 파라미터화이고,
-- 팔로워 전용은 follows 테이블이 생겨서 조건 한 줄이면 된다.
-- 금칙어는 백로그에 있던 항목인데 모더레이션 UI가 생기는 김에 같이 둔다.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS channel_settings (
  channel_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  slow_mode_sec  INTEGER DEFAULT 0 NOT NULL CHECK (slow_mode_sec >= 0 AND slow_mode_sec <= 300),
  followers_only BOOLEAN DEFAULT false NOT NULL,
  banned_words   TEXT[] DEFAULT '{}' NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- --------------------------------------------
-- 권한
--
-- 제재는 전부 서버 API를 거친다. 클라이언트가 직접 쓰면 남의 채널에
-- 차단을 꽂거나 자기 차단을 지울 수 있다.
--
-- 읽기는 열어둔다 — 대상 본인이 "언제까지 왜 막혔는지" 봐야 하고,
-- 방송자가 자기 차단 목록을 봐야 한다.
-- --------------------------------------------
ALTER TABLE channel_bans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Bans visible to channel owner and target" ON channel_bans;
CREATE POLICY "Bans visible to channel owner and target"
  ON channel_bans FOR SELECT
  USING (auth.uid() = channel_id OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Logs visible to channel owner" ON moderation_logs;
CREATE POLICY "Logs visible to channel owner"
  ON moderation_logs FOR SELECT
  USING (auth.uid() = channel_id);

-- 채팅 설정은 시청자도 알아야 한다 (슬로우 모드 안내 등)
DROP POLICY IF EXISTS "Channel settings are viewable by everyone" ON channel_settings;
CREATE POLICY "Channel settings are viewable by everyone"
  ON channel_settings FOR SELECT USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.channel_bans     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.moderation_logs  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.channel_settings FROM anon, authenticated;
GRANT SELECT ON public.channel_bans     TO authenticated;
GRANT SELECT ON public.moderation_logs  TO authenticated;
GRANT SELECT ON public.channel_settings TO anon, authenticated;

-- --------------------------------------------
-- 만료된 차단 정리
--
-- 판정은 조회 시 expires_at으로 하므로 이 정리는 성능·위생용이다.
-- 영구 차단(expires_at IS NULL)은 절대 건드리지 않는다.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION prune_expired_bans()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM channel_bans
  WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.prune_expired_bans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_expired_bans() TO service_role;
