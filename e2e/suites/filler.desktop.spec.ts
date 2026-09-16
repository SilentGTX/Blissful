import { mergeTests, expect } from '@playwright/test';
import { test as desktopTest } from '../fixtures/desktop';
import { test as mediaTest } from '../fixtures/media';

// Filler awareness in the DESKTOP (mpv) player — the platform mirror of
// filler.web.spec.ts. Anime Kitsu is installed as a guest addon, Bleach
// (kitsu:244) episode 33 is opened in the native player, and the filler map is
// fetched from Jikan by the shell's WebView for real (ani.zip resolves the MAL
// id, exactly as in production).
//
// Oracle: MyAnimeList's known flags for Bleach — 33 is filler, it is a
// one-episode run, and the story resumes at 34. Not "whatever the code says".
//
// The video is the shared 52-second test clip, not the episode; nothing under
// test depends on the pixels — the badge, the notice and the skip target are
// driven by the episode id and the filler map. It has to be LONGER than the
// 30-second up-next window though: on a shorter file the Up Next card comes up
// the moment playback starts and takes the notice's place, as designed.
const test = mergeTests(desktopTest, mediaTest);

const UI = process.env.E2E_DESKTOP_UI || 'http://localhost:5173';
const KITSU_MANIFEST = 'https://anime-kitsu.strem.fun/manifest.json';
const BLEACH = 'kitsu:244';

test.describe('Filler episodes (desktop / mpv, Anime Kitsu)', () => {
  test('badges the episode playing and offers the skip to the next canon one', async ({
    desktop,
    webmUrl,
  }) => {
    test.slow();
    const { page } = desktop;

    // Guest session with Anime Kitsu installed: with no account the addon list
    // comes straight from localStorage, which keeps the setup to one
    // deterministic write instead of the multi-step install dialog.
    await page.goto(UI, { waitUntil: 'domcontentloaded' });
    await page.evaluate((manifest) => {
      localStorage.removeItem('bliss:authToken');
      localStorage.setItem('blissfulTorrentioUrls', JSON.stringify([manifest]));
      // Drop any cached map so the Jikan lookup itself is under test.
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('bliss:animeFiller:') || k.startsWith('bliss:fillerAck:')) localStorage.removeItem(k);
      }
    }, KITSU_MANIFEST);

    // Episode 33 of Bleach — filler, one episode long, canon resumes at 34.
    const playerUrl = `${UI}/player?${new URLSearchParams({
      type: 'anime',
      id: BLEACH,
      videoId: `${BLEACH}:33`,
      url: webmUrl,
      rdsel: '1',
      title: 'Bleach',
      metaTitle: 'Bleach',
    })}`;
    await page.goto(playerUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!(window as unknown as { blissfulDesktop?: { call?: unknown } }).blissfulDesktop?.call,
      null,
      { timeout: 20_000 },
    );

    const call = (m: string, a?: unknown) =>
      page.evaluate(
        (args) =>
          (window as unknown as { blissfulDesktop: { call: (m: string, a?: unknown) => Promise<unknown> } })
            .blissfulDesktop.call(args.m, args.a)
            .catch(() => null),
        { m, a },
      );
    // mpv has no getProperty over the bridge — read the live position off the
    // prop-change stream, the same way player.desktop.spec.ts does.
    await page.evaluate(() => {
      const w = window as unknown as {
        __t: number | null;
        blissfulDesktop: { on: (e: string, cb: (d: { name: string; value: unknown }) => void) => void };
      };
      w.__t = null;
      w.blissfulDesktop.on('mpv-prop-change', (e) => {
        if (e?.name === 'time-pos' && typeof e.value === 'number') w.__t = e.value;
      });
    });
    // Let mpv actually open the file (the player paints its chrome off the
    // first frame), then pause so nothing advances mid-assertion.
    await expect
      .poll(
        async () => {
          await call('play');
          return page.evaluate(() => (window as unknown as { __t: number | null }).__t);
        },
        { timeout: 45_000, intervals: [1000] },
      )
      .toBeGreaterThan(0.2);
    await call('mpv.setProperty', ['pause', 'yes']);

    // The floating notice, with the skip aimed at the episode the story
    // actually resumes on.
    const notice = page.getByRole('status').filter({ hasText: /is filler/i });
    await expect(notice).toBeVisible({ timeout: 45_000 });
    const skip = notice.getByRole('button', { name: /Skip to episode 34/ });
    await expect(skip).toBeVisible({ timeout: 30_000 });

    // And the badge on the title pill, so the episode stays marked once the
    // notice has been dismissed.
    await page.mouse.move(400, 400);
    await expect(page.getByTitle('Filler episode (MyAnimeList)').first()).toBeVisible();

    // Taking the skip lands on 34 — the first canon episode after the run.
    await skip.click();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)34/, { timeout: 30_000 });
  });
});
