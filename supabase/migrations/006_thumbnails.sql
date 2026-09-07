-- ============================================
-- 006: 썸네일 저장소
-- ============================================
--
-- 탐색·검색 화면은 썸네일이 없으면 성립하지 않는다(검은 사각형 목록에서는
-- 아무도 고르지 않는다). S3 대신 Supabase Storage를 쓰는 이유는 단순하다 —
-- 이미 있는 자격증명으로 되고 새 인프라가 붙지 않는다.
--
-- 공개 버킷이다. 썸네일은 방송 목록에 그대로 노출되는 값이라 비밀이 없고,
-- 비공개로 두면 조회마다 서명 URL을 발급해야 해서 피드가 느려진다.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('thumbnails', 'thumbnails', true, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 2097152,
      allowed_mime_types = ARRAY['image/jpeg'];

-- 쓰기는 서버(service role)만 한다.
-- service role은 RLS를 우회하므로 INSERT/UPDATE 정책을 따로 두지 않는다.
-- 정책을 열어주면 로그인한 아무나 남의 방송 썸네일을 덮어쓸 수 있다.
DROP POLICY IF EXISTS "thumbnails_public_read" ON storage.objects;
CREATE POLICY "thumbnails_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'thumbnails');
