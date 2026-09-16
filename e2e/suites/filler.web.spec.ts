import { test, expect, type Page } from '../fixtures/auth';

// Filler awareness for Anime Kitsu titles (web). REAL end to end: a throwaway
// account installs the Anime Kitsu addon through the actual Add-addon flow,
// Bleach (kitsu:244) loads through it, the filler map comes from the proxy's
// Jikan endpoint (/skip-times?filler=1&mal=269), and the assertions are against
// MyAnimeList's known flags for Bleach: episodes 33 and 50 are filler in the
// first fifty, episode 1 is canon, and 33 is a single-episode run whose story
// resumes at 34. The oracle is the public filler list, not the code.
//
// Chromium here has no H.264, so the video itself will not decode. Nothing under
// test depends on that: the chip, the banner and the prompt are driven by the
// episode id and the filler map, not by playback.

const KITSU_MANIFEST = 'https://anime-kitsu.strem.fun/manifest.json';
const BLEACH = 'kitsu:244';

async function installKitsu(page: Page) {
  await page.goto('/addons');
  await page.getByRole('button', { name: 'Add addon' }).first().click();
  await page.getByPlaceholder(/manifest\.json/i).first().fill(KITSU_MANIFEST);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.getByText(/kitsu/i).first()).toBeVisible({ timeout: 25_000 });
}

/** The VISIBLE episode card whose title line starts with "<n>. ". The detail
 *  page mounts the episode list twice (phone and desktop layouts, one hidden by
 *  CSS), so an unfiltered first() can land on the hidden copy. */
function episodeCard(page: Page, n: number) {
  return page.getByText(new RegExp(`^${n}\\.\\s`)).filter({ visible: true }).first().locator('xpath=ancestor::button[1]');
}

test.describe('Filler episodes (web, Anime Kitsu)', () => {
  test('detail chips, in-player banner with skip, and the entering-a-run prompt', async ({ loggedInPage: page }) => {
    test.slow();
    await installKitsu(page);

    // ---- Detail page: chips on the filler episodes of the first range -------
    await page.goto(`/detail/anime/${encodeURIComponent(BLEACH)}`);
    await expect(episodeCard(page, 1)).toBeVisible({ timeout: 30_000 });
    // The map arrives after the meta; give the chip a moment.
    await expect(episodeCard(page, 33).getByText(/^filler$/i)).toBeVisible({ timeout: 20_000 });
    await expect(episodeCard(page, 50).getByText(/^filler$/i)).toBeVisible();
    await expect(episodeCard(page, 1).getByText(/^filler$/i)).toHaveCount(0);
    await expect(episodeCard(page, 34).getByText(/^filler$/i)).toHaveCount(0);

    // ---- Player on a filler episode: the banner, with a skip to the resume ---
    await episodeCard(page, 33).click();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)33/, { timeout: 30_000 });
    const banner = page.getByRole('status').filter({ hasText: /Episode 33 is filler/ });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner.getByRole('button', { name: /Skip to Ep 34/ })).toBeVisible();
    // Dismiss hides it for THIS episode only.
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toHaveCount(0);

    // ---- Next from a canon episode into a run: the prompt, then Skip ----------
    await page.goto(`/detail/anime/${encodeURIComponent(BLEACH)}`);
    await episodeCard(page, 32).click();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)32/, { timeout: 30_000 });
    // 32 is canon: no banner.
    await expect(page.getByRole('status').filter({ hasText: /is filler/ })).toHaveCount(0);
    // Next would enter the run at 33 — the player must ask first, not move.
    const next = page.getByRole('button', { name: 'Next episode' });
    await expect(next).toBeVisible({ timeout: 30_000 });
    await next.click();
    const prompt = page.getByRole('dialog');
    await expect(prompt).toBeVisible({ timeout: 10_000 });
    await expect(prompt.getByText(/The next episode is filler/)).toBeVisible();
    await expect(prompt.getByText(/Episode 33 is filler/)).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Watch anyway' })).toBeVisible();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)32/); // still on 32
    // Skip lands past the run, on 34.
    await prompt.getByRole('button', { name: /Skip to Ep 34/ }).click();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)34/, { timeout: 30_000 });
  });

  test('"Watch anyway" enters the run and is remembered for it', async ({ loggedInPage: page }) => {
    test.slow();
    await installKitsu(page);
    await page.goto(`/detail/anime/${encodeURIComponent(BLEACH)}`);
    await episodeCard(page, 32).click();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)32/, { timeout: 30_000 });
    const next = page.getByRole('button', { name: 'Next episode' });
    await expect(next).toBeVisible({ timeout: 30_000 });
    await next.click();
    const prompt = page.getByRole('dialog');
    await expect(prompt).toBeVisible({ timeout: 10_000 });
    await prompt.getByRole('button', { name: 'Watch anyway' }).click();
    // Moved into the run; the banner marks it.
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)33/, { timeout: 30_000 });
    await expect(page.getByRole('status').filter({ hasText: /Episode 33 is filler/ })).toBeVisible({ timeout: 30_000 });
  });
});
