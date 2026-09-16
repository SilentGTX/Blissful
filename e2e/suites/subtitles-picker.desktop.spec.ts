import { mergeTests, expect } from '@playwright/test';
import { test as desktopTest } from '../fixtures/desktop';
import { test as mediaTest } from '../fixtures/media';

// Subtitle picker (desktop / mpv). STRONG ORACLE: the media is GENERATED with
// metadata that lies the way real releases lie —
//   s:0  eng, no title
//   s:1  NO language tag, title "Bulgarian"
//   s:2  eng, title "Signs & Songs"
// — so the right answer is known in advance: two languages in the list, the
// Bulgarian track filed under Bulgarian (not English), and the two English
// tracks told apart by their titles rather than rendered as identical rows.
//
// Before `effectiveTrackLanguage` / `subtitleTrackLabel` this produced one
// "English" row holding three interchangeable entries, which is the
// "some subtitles aren't shown / picking one does nothing" report.
const test = mergeTests(desktopTest, mediaTest);

const UI = process.env.E2E_DESKTOP_UI || 'http://localhost:5173';
const playerUrl = (url: string) =>
  `${UI}/player?${new URLSearchParams({ type: 'movie', id: 'tt1254207', url, rdsel: '1', title: 'Subs' })}`;

test.describe('Subtitle picker (desktop / mpv)', () => {
  test('files a mislabeled track by its title and keeps same-language tracks apart', async ({
    desktop,
    mislabeledSubsUrl,
  }) => {
    test.skip(!mislabeledSubsUrl, 'ffmpeg unavailable to generate the test media');
    const { page } = desktop;
    await page.goto(playerUrl(mislabeledSubsUrl!), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!(window as unknown as { blissfulDesktop?: { call?: unknown } }).blissfulDesktop?.call,
      null,
      { timeout: 20_000 },
    );

    // Wait until mpv has actually parsed the three subtitle tracks.
    await expect
      .poll(
        async () =>
          (
            (await page.evaluate(() =>
              (window as unknown as { blissfulDesktop: { call: (m: string) => Promise<unknown> } }).blissfulDesktop.call(
                'mpv.getTracks',
              ),
            )) as Array<{ kind: string }>
          ).filter((t) => t.kind === 'sub').length,
        { timeout: 40_000, intervals: [1000] },
      )
      .toBe(3);

    // Open the subtitles panel (the controls auto-hide, so wake them first).
    await page.mouse.move(400, 400);
    await page.getByRole('button', { name: 'Subtitles', exact: true }).click();

    // The language list: Bulgarian is there because a track SAYS so in its
    // title, even though the container carries no language for it. (Row names
    // carry their tags — "Bulgarian Built-in ›" — hence the prefix match.)
    await expect(page.getByRole('button', { name: /^Bulgarian\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^English\b/ })).toBeVisible();

    // Drill into English: the two English tracks are told apart by their
    // titles, and the Bulgarian one is NOT among them.
    await page.getByRole('button', { name: /^English\b/ }).click();
    await expect(page.getByRole('button', { name: /Signs & Songs/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Bulgarian/ })).toHaveCount(0);
  });
});
