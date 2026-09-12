import { defineConfig, devices } from '@playwright/test';

/**
 * 끝에서 끝까지(E2E): 실제 브라우저 둘(방송자·시청자)로 방송 → 시청 → 채팅 → 후원 → 종료.
 *
 * 앱·채팅·미디어 서버·Supabase·Redis가 떠 있어야 한다 — CI의 `e2e` 잡이 세운다.
 * 유닛 테스트(vitest)는 src/**\/*.test.ts만 보므로 e2e/*.spec.ts와 섞이지 않는다.
 */
export default defineConfig({
  testDir: './e2e',
  // 방송 연결·영상 재생·웹훅까지 기다리므로 넉넉하게
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // 한 방송을 두 브라우저가 공유한다 — 병렬로 돌리면 서로의 방송을 건드린다
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 세로 화면 앱이라 폰 크기로 본다
        viewport: { width: 430, height: 900 },
        permissions: ['camera', 'microphone'],
        launchOptions: {
          args: [
            // 진짜 카메라 대신 크롬의 테스트 패턴 영상·소리
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            // 사용자 조작 없이 영상 자동 재생 (시청자 쪽 확인에 필요)
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
});
