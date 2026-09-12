import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * 제품의 세 본질을 한 번에 지난다: 방송(끊김 없는 스트리밍) → 피드에서 시청 →
 * 채팅 → 후원 → 종료. 두 브라우저 컨텍스트가 방송자와 시청자다.
 *
 * 필요한 것 (CI `e2e` 잡이 넣어준다):
 *   E2E_STREAMER_EMAIL / E2E_STREAMER_PASSWORD — streams 행이 있는 방송자
 *   E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD     — 포인트가 있는 시청자
 *   E2E_STREAM_ID                              — 방송자의 streams.id
 *
 * 화면 문구는 영어로 고정한다(locale 쿠키). 기본값인 한국어 문구가 바뀌어도
 * 테스트가 흔들리지 않게.
 */

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경변수가 필요하다`);
  return value;
}

const STREAMER = { email: env('E2E_STREAMER_EMAIL'), password: env('E2E_STREAMER_PASSWORD') };
const VIEWER = { email: env('E2E_VIEWER_EMAIL'), password: env('E2E_VIEWER_PASSWORD') };
const STREAM_ID = env('E2E_STREAM_ID');

async function openAs(
  browser: Browser,
  baseURL: string,
  who: { email: string; password: string },
  next: string,
): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'locale', value: 'en', url: baseURL }]);
  const page = await context.newPage();

  await page.goto(`/login?redirect=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL((url) => url.pathname === next);
  return page;
}

/** 피드 API(익명)에 이 방송이 라이브로 있는가 — 웹훅(on-publish/on-unpublish)까지 돈 결과 */
async function isInFeed(page: Page): Promise<boolean> {
  const res = await page.request.get('/api/feed?limit=20');
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).some((s) => s.id === STREAM_ID);
}

test('방송 → 시청 → 채팅 → 후원 → 종료', async ({ browser, baseURL }) => {
  // ── 방송자: 방송 시작 ────────────────────────────────────────
  const streamer = await openAs(browser, baseURL!, STREAMER, '/broadcast');
  await streamer.getByRole('button', { name: 'Go live', exact: true }).click();

  // WHIP 연결이 붙으면 버튼이 "End stream"으로 바뀐다
  await expect(streamer.getByRole('button', { name: 'End stream' }).first()).toBeVisible({
    timeout: 60_000,
  });

  // 미디어 서버 → on-publish 웹훅 → DB·Redis가 live가 되어야 피드에 나온다
  await expect.poll(() => isInFeed(streamer), { timeout: 30_000 }).toBe(true);

  // ── 시청자: 피드에서 영상이 실제로 흐르는가 ─────────────────────
  const viewer = await openAs(browser, baseURL!, VIEWER, '/feed');

  // 멈춘 첫 프레임이 아니라 재생 위치가 계속 나아가야 한다
  await expect
    .poll(
      () =>
        viewer.evaluate(() => {
          const v = document.querySelector('video');
          return v ? v.currentTime : 0;
        }),
      { timeout: 60_000, message: '시청자 영상이 재생되지 않는다' },
    )
    .toBeGreaterThan(2);

  // ── 채팅: 보낸 말이 방에 돌아온다 (소켓 → Redis → 방 전체) ─────────
  const text = `e2e hello ${Date.now()}`;
  const input = viewer.getByPlaceholder('Say something…');
  await input.fill(text);
  await input.press('Enter');
  await expect(viewer.getByText(text)).toBeVisible();

  // ── 후원: 100포인트, 두 번 눌러 확정 → 화면에 후원 줄이 뜬다 ────────
  await viewer.getByRole('button', { name: 'Tip', exact: true }).click();
  await viewer.getByRole('button', { name: 'Tip 100 pts' }).click();
  await viewer.getByRole('button', { name: 'Confirm 100 pts' }).click();
  // 성공하면 패널이 닫힌다. 실패하면 패널에 에러가 남는다.
  await expect(viewer.getByRole('button', { name: 'Confirm 100 pts' })).toBeHidden();
  // 서버가 DB 커밋 후 발행한 알림이 채팅에 후원 줄로 들어온다 (H-01 정상 경로)
  await expect(viewer.getByText('tipped 100 pts').first()).toBeVisible();

  // ── 종료: 방송자가 끝내면 피드에서 사라진다 (on-unpublish) ────────
  streamer.on('dialog', (dialog) => dialog.accept());
  await streamer.getByRole('button', { name: 'End stream' }).last().click();
  await streamer.waitForURL((url) => url.pathname === '/dashboard');

  await expect.poll(() => isInFeed(viewer), { timeout: 30_000 }).toBe(false);
});
