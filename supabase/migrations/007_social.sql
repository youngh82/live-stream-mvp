-- ============================================
-- 007: 팔로우 + 공개 프로필
-- ============================================

-- --------------------------------------------
-- 프로필 필드
-- --------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS follower_count INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS following_count INTEGER DEFAULT 0 NOT NULL;

-- 004에서 users의 UPDATE를 컬럼 단위로 잠갔다. bio만 추가로 열어준다.
-- **follower_count는 절대 열지 않는다.** 열면 클라이언트가 자기 팔로워 수를
-- 마음대로 적을 수 있다. 카운트는 아래 트리거만 건드린다.
GRANT UPDATE (bio) ON public.users TO authenticated;

-- --------------------------------------------
-- follows
--
-- 단방향이다. 맞팔 개념이 없으므로 (follower, following) 복합 PK로 충분하고
-- 이게 중복 팔로우도 막는다 — 연타로 행이 두 개 생기지 않는다.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS follows (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT no_self_follow CHECK (follower_id <> following_id)
);

-- PK가 (follower_id, ...)라 "내가 팔로우한 사람"은 인덱스를 타지만
-- "나를 팔로우한 사람"은 못 탄다. 팔로워 목록·라이브 알림 발송이 이 방향이다.
CREATE INDEX IF NOT EXISTS idx_follows_following
  ON follows (following_id, created_at DESC);

-- --------------------------------------------
-- 팔로워 수 비정규화
--
-- 프로필·검색 결과마다 count(*)를 돌면 목록 하나에 집계가 N번 붙는다.
-- 002의 프로필 자동생성과 같은 방식으로 트리거에서 유지한다.
--
-- SECURITY DEFINER인 이유: authenticated에게는 users의 카운트 컬럼
-- UPDATE 권한이 없다(위 GRANT 참고). 권한 없이 트리거만 통과시키려면
-- 함수가 소유자 권한으로 돌아야 한다.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION sync_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET follower_count = follower_count + 1 WHERE id = NEW.following_id;
    UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' THEN
    -- GREATEST: 어떤 이유로든 카운트가 어긋나도 음수로 내려가지 않게 한다
    UPDATE users SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = OLD.following_id;
    UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_follow_change ON follows;
CREATE TRIGGER on_follow_change
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION sync_follow_counts();

-- 004의 원칙: 트리거 전용 함수는 RPC로 노출될 이유가 없다
REVOKE EXECUTE ON FUNCTION public.sync_follow_counts() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------
-- RLS
--
-- **INSERT/DELETE를 본인으로 묶는 게 이 마이그레이션의 핵심이다.**
-- 빠뜨리면 anon key만으로 남의 이름으로 팔로우를 꽂거나 끊을 수 있다.
-- --------------------------------------------
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Follows are viewable by everyone" ON follows;
CREATE POLICY "Follows are viewable by everyone"
  ON follows FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can follow as themselves" ON follows;
CREATE POLICY "Users can follow as themselves"
  ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Users can unfollow as themselves" ON follows;
CREATE POLICY "Users can unfollow as themselves"
  ON follows FOR DELETE USING (auth.uid() = follower_id);

-- UPDATE 정책은 두지 않는다. 팔로우는 생기거나 사라질 뿐 수정되지 않는다.
REVOKE UPDATE ON public.follows FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
GRANT SELECT ON public.follows TO anon;

-- --------------------------------------------
-- 부수 정리: thumbnail_url은 이제 서버가 소유한다
--
-- 006의 썸네일 워커가 주기적으로 덮어쓰므로 클라이언트가 쓸 이유가 없어졌다.
-- 열어두면 방송자가 임의의 외부 URL을 넣을 수 있고 그게 피드에 그대로 걸린다.
-- --------------------------------------------
REVOKE UPDATE ON public.streams FROM anon, authenticated;
GRANT UPDATE (title, description, category, tags) ON public.streams TO authenticated;
