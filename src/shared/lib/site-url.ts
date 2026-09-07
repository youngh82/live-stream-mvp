/**
 * 공유 링크·OG 메타데이터용 절대 URL.
 *
 * OG 태그의 이미지·URL은 상대 경로를 쓸 수 없다. 카톡/트위터 크롤러는
 * 우리 도메인을 모르기 때문이다. 그래서 절대 URL을 만들 기준점이 필요하다.
 *
 * APP_URL은 `pnpm certs:dev`가 갱신하고 배포 환경에서는 실제 도메인이 들어간다.
 */
export function siteUrl(): string {
  const raw =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000');

  // 뒤 슬래시가 붙어 있으면 `${base}/stream/...`이 //로 겹친다
  return raw.replace(/\/+$/, '');
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}
