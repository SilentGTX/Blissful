import { mergeTests, expect, type Page } from '@playwright/test';
import { test as desktopTest } from '../fixtures/desktop';
import { test as mediaTest } from '../fixtures/media';

// Player (desktop / mpv) — the reference suite's platform-2 mirror. The desktop
// player is mpv (no <video>), so we read REAL playback state from mpv's
// `mpv-prop-change` events (time-pos, pause) and drive the same global keyboard
// controls the web player uses. Combines the shell-over-CDP + WebM fixtures.
const test = mergeTests(desktopTest, mediaTest);

const UI = process.env.E2E_DESKTOP_UI || 'http://localhost:5173';
const PLAYER_URL = (webm: string) =>
  `${UI}/player?${new URLSearchParams({
    type: 'movie',
    id: 'tt1254207',
    url: webm,
    rdsel: '1',
    title: 'E2E Player',
  })}`;

// Subscribe to mpv prop-changes into window.__mpv so the test can read the live
// playback state. `pause` only fires on CHANGE, so "playing" is asserted via
// time-pos advancing, not pause===false.
async function trackMpv(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __mpv: { timePos: number | null; paused: boolean | null; count: number };
      blissfulDesktop: { on: (e: string, cb: (d: { name: string; value: unknown }) => void) => void };
    };
    w.__mpv = { timePos: null, paused: null, count: 0 };
    w.blissfulDesktop.on('mpv-prop-change', (e) => {
      if (!e) return;
      w.__mpv.count++;
      if (e.name === 'time-pos' && typeof e.value === 'number') w.__mpv.timePos = e.value;
      if (e.name === 'pause' && typeof e.value === 'boolean') w.__mpv.paused = e.value;
    });
  });
}
const mpvTimePos = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mpv?: { timePos: number | null } }).__mpv?.timePos ?? null);
const mpvPaused = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mpv?: { paused: boolean | null } }).__mpv?.paused ?? null);

async function gotoPlayer(page: Page, webm: string) {
  await page.goto(PLAYER_URL(webm), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as unknown as { blissfulDesktop?: { on?: unknown } }).blissfulDesktop?.on,
    null,
    { timeout: 20_000 },
  );
  await trackMpv(page);
  // The player loadfile's the webm (the seekbar shows its 0:52 duration) but can
  // sit paused on frame 0 in the harness (a loadfile/play race). Nudge play()
  // until mpv actually advances past 1s — proving the real playback path works.
  await expect
    .poll(
      async () => {
        await page.evaluate(() =>
          (window as unknown as { blissfulDesktop: { call: (m: string) => Promise<unknown> } })
            .blissfulDesktop.call('play')
            .catch(() => {}),
        );
        return mpvTimePos(page);
      },
      { timeout: 45_000, intervals: [1000] },
    )
    .toBeGreaterThan(1.0);
}

test.describe('Player (desktop / mpv)', () => {
  test('loads and mpv starts playing', async ({ desktop, webmUrl }) => {
    await gotoPlayer(desktop.page, webmUrl);
  });

  test('Space pauses and resumes mpv', async ({ desktop, webmUrl }) => {
    const { page } = desktop;
    await gotoPlayer(page, webmUrl);
    await page.keyboard.press('Space');
    await expect.poll(() => mpvPaused(page), { timeout: 8_000 }).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => mpvPaused(page), { timeout: 8_000 }).toBe(false);
  });

  test('ArrowRight seeks mpv forward', async ({ desktop, webmUrl }) => {
    const { page } = desktop;
    await gotoPlayer(page, webmUrl);
    await page.keyboard.press('Space'); // pause to stabilize the playhead
    await expect.poll(() => mpvPaused(page), { timeout: 8_000 }).toBe(true);
    const before = (await mpvTimePos(page)) ?? 0;
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => mpvTimePos(page), { timeout: 8_000 }).toBeGreaterThan(before + 1);
  });
});
