// 빌드 설정 전용 경로. "@sentry/nextjs"에서 가져오면 v11부터 동작하지 않는다 (빌드 로그 경고)
import { withSentryConfig } from "@sentry/nextjs/config";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { networkInterfaces } from "os";

/**
 * 개발 서버에 접속을 허용할 호스트 목록.
 *
 * Next 16은 localhost가 아닌 origin에서 오는 /_next/static 요청을 기본 차단한다.
 * 폰에서 LAN IP로 접속하면 HTML은 오지만 JS 청크가 막혀서 React가 붙지 않고,
 * 화면은 뜨는데 버튼이 전혀 동작하지 않는 상태가 된다.
 *
 * IP는 Wi-Fi를 옮기면 바뀌므로 하드코딩하지 않고 실행 시점에 읽는다.
 */
function localNetworkHosts(): string[] {
  const hosts: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) hosts.push(addr.address);
    }
  }
  return hosts;
}

const nextConfig: NextConfig = {
  // 개발 중 좌하단 Next.js Dev Tools 인디케이터 숨김
  devIndicators: false,

  // 모바일 웹 방송 테스트를 위해 같은 Wi-Fi의 기기에서 접속을 허용한다
  allowedDevOrigins: localNetworkHosts(),
};

// 로케일은 URL이 아니라 쿠키로 정한다 — src/i18n/config.ts 주석 참고
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * 브라우저 에러의 스택트레이스를 원본 파일·줄로 보이게 소스맵을 Sentry에 올린다.
 *
 * 값은 전부 빌드 환경에서 온다 (GitHub Actions → Dockerfile.app). 토큰은 build arg가
 * 아니라 secret mount로 들어온다 — 이미지 히스토리에 남기지 않기 위해서다.
 * 토큰이 없으면(로컬 빌드) 업로드만 건너뛰고 빌드는 그대로 된다.
 *
 * 올린 뒤 .next 안의 .map 파일은 지운다(기본값) — 원본 코드를 공개로 서빙하지 않는다.
 */
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // node_modules 청크까지 올려서 라이브러리 안에서 난 에러도 읽을 수 있게
  widenClientFileUpload: true,
  telemetry: false,
});
