-- ============================================
-- 008: 검색 인덱스
-- ============================================
--
-- Elasticsearch / Algolia는 이 규모에서 과잉이다. Postgres로 충분하다.
--
-- **trigram을 쓰고 tsvector 전문검색을 쓰지 않는 이유**: 한국어 사전이 없어서
-- tsvector는 형태소를 못 나눈다. "게임방송"을 "게임"으로 못 찾는다.
-- trigram은 사전 없이 부분일치가 되므로 한국어에서 오히려 유리하다.
--
-- 초성 검색(ㅇㅈㅎ → 유재석)은 하지 않는다. 별도 컬럼과 변환 로직이 필요하고
-- MVP 가치가 낮다. 필요해지면 nickname_chosung 생성 컬럼을 추가하면 된다.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 방송자 검색 (닉네임 부분일치)
CREATE INDEX IF NOT EXISTS idx_users_nickname_trgm
  ON users USING gin (nickname gin_trgm_ops);

-- 방송 제목 검색
CREATE INDEX IF NOT EXISTS idx_streams_title_trgm
  ON streams USING gin (title gin_trgm_ops);

-- 카테고리별 라이브 목록 (탐색 화면의 칩)
-- 부분 인덱스라 종료된 방송 수만 개가 쌓여도 인덱스가 커지지 않는다
CREATE INDEX IF NOT EXISTS idx_streams_category_live
  ON streams (category, viewer_count DESC)
  WHERE status = 'live';

-- 태그 검색 (배열 포함 여부)
CREATE INDEX IF NOT EXISTS idx_streams_tags
  ON streams USING gin (tags);
