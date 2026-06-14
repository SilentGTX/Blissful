import { test, expect } from '../fixtures/media';
import type { Page } from '@playwright/test';

// Player (web) — the reference suite. Drives the real BlissfulPlayer with a
// codec-friendly WebM (rdsel=1 makes the player play the url directly: no
// Videasy, no DMCA fallback, no stream picker). Core scenarios assert on the
// real <video> element + the global keyboard controls (window keydown capture).

const PLAYER_URL = (webm: string) =>
  `/player?${new URLSearchParams({
    type: 'movie',
    id: 'tt1254207',
    url: webm,
    rdsel: '1',
    title: 'E2E Player',
  })}`;

const isPaused = (page: Page) =>
  page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).paused);
const currentTime = (page: Page) =>
  page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).currentTime);

async function gotoAndPlay(page: Page, webm: string) {
  await page.goto(PLAYER_URL(webm));
  await expect(page.getByTestId('player-video')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video') as HTMLVideoElement | null;
      return !!v && !v.paused && v.readyState >= 2 && v.currentTime > 0.2;
    },
    null,
    { timeout: 30_000 },
  );
}

test.describe('Player (web)', () => {
  test('loads the player and starts playback', async ({ page, webmUrl }) => {
    await gotoAndPlay(page, webmUrl);
  });

  test('Space toggles pause and resume', async ({ page, webmUrl }) => {
    await gotoAndPlay(page, webmUrl);
    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page), { timeout: 5_000 }).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page), { timeout: 5_000 }).toBe(false);
  });

  test('ArrowRight seeks forward', async ({ page, webmUrl }) => {
    await gotoAndPlay(page, webmUrl);
    // Pause so the playhead doesn't drift under the assertion, then seek.
    await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause());
    const before = await currentTime(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => currentTime(page), { timeout: 5_000 }).toBeGreaterThan(before + 1);
  });

  test('resumes playback from the ?t= position', async ({ page, webmUrl }) => {
    await page.goto(
      `/player?${new URLSearchParams({ type: 'movie', id: 'tt1254207', url: webmUrl, rdsel: '1', t: '8', title: 'Resume' })}`,
    );
    await expect(page.getByTestId('player-video')).toBeVisible({ timeout: 20_000 });
    // The player seeks to the resume position on load (startTimeSeconds), then plays.
    await expect
      .poll(() => page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).currentTime), { timeout: 30_000 })
      .toBeGreaterThan(6);
  });

  // DEFERRED — need richer media fixtures (tracked so coverage gaps aren't silent):
  // - subtitles: a WebM with an embedded/sidecar VTT + the subtitle picker.
  // - audio tracks: a multi-audio source.
  // - quality switch: HLS-only (this WebM is progressive).
  // - buffering veil: a throttled/stalling server to force it deterministically.
  test.fixme('subtitles / audio tracks / quality / buffering — need richer media fixtures', () => {});
});
