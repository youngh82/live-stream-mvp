import { defineConfig } from "vitest/config";

/**
 * 유닛 테스트만 돌린다. 스택(Redis/MediaMTX/Supabase)이 떠야 하는 검증은
 * scripts/verify-*.ts 쪽이고, 그건 vitest가 아니라 tsx로 따로 실행한다.
 *
 * 환경변수를 일부러 주입하지 않는다 — fees.ts의 수수료율은 모듈 로드 시점에
 * process.env에서 읽으므로, 비워두면 항상 기본값으로 고정된다.
 */
export default defineConfig({
  resolve: {
    // tsconfig.json의 "@/*" 경로를 그대로 쓴다
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
