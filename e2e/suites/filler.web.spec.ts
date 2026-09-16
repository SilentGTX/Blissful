import { test, expect, type Page } from '../fixtures/auth';

// Filler awareness for Anime Kitsu titles (web). REAL end to end: a throwaway
// account installs the Anime Kitsu addon through the actual Add-addon flow,
// Bleach (kitsu:244) loads through it, and the filler map comes from Jikan
// straight from the browser (`api.jikan.moe/v4/anime/269/episodes`, public and
// CORS `*` — the web build does not route this through the proxy). Assertions
// are against MyAnimeList's known flags for Bleach: episodes 33 and 50 are
// filler within the first fifty, 1 and 34 are canon, and 33 is a single-episode
// run whose story resumes at 34. The oracle is the public filler list, not the
// code.
//
// Chromium here has no H.264, so the video itself will not decode. Nothing under
// test depends on that: the chip, the notice and the prompt are driven by the
// episode id and the filler map, not by playback.

const KITSU_MANIFEST = 'https://anime-kitsu.strem.fun/manifest.json';
const BLEACH = 'kitsu:244';

async function installKitsu(page: Page) {
  await page.goto('/addons');
  await page.getByRole('button', { name: 'Add addon' }).first().click();
  await page.getByPlaceholder(/manifest\.json/i).first().fill(KITSU_MANIFEST);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  // Wait on the installed CARD and the dialog closing — a bare /kitsu/i also
  // matches the manifest URL still sitting in the open dialog, which let a
  // failed install pass for an installed one and blamed the failure on
  // whatever ran next.
  await expect(page.getByText(/Anime Kitsu/).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('dialog', { name: 'Add addon' })).toHaveCount(0);
}

/** The VISIBLE episode card whose title line starts with "<n>. ". The detail
 *  page mounts the episode list twice (phone and desktop layouts, one hidden by
 *  CSS), so an unfiltered first() can land on the hidden copy.
 *
 *  The badge renders INSIDE that same line, so a filler card's text reads
 *  "Filler33. Miracle! ..." — anchoring on the bare number left this helper
 *  unable to find exactly the cards the suite is about. */
function episodeCard(page: Page, n: number) {
  return page
    .getByText(new RegExp(`^(Filler|Recap)?\\s*${n}\\.\\s`))
    .filter({ visible: true })
    .first()
    .locator('xpath=ancestor::button[1]');
}

/** The floating in-player card (FillerNotice) — role="status", bottom-left. */
function fillerNotice(page: Page) {
  return page.getByRole('status').filter({ hasText: /is filler/i });
}

/** The watch-or-skip modal (FillerEpisodeModal), raised when the viewer PICKS a
 *  filler episode — the drawer, the detail list or the bottom bar's Next. */
function fillerModal(page: Page) {
  return page.getByRole('dialog').filter({ hasText: /Filler episode/i });
}

test.describe('Filler episodes (web, Anime Kitsu)', () => {
  test('detail chips, the in-player notice with skip, and the entering-a-run prompt', async ({ loggedInPage: page }) => {
    test.slow();
    await installKitsu(page);

    // ---- Detail page: chips on the filler episodes of the first range -------
    await page.goto(`/detail/anime/${encodeURIComponent(BLEACH)}`);
    await expect(episodeCard(page, 1)).toBeVisible({ timeout: 30_000 });
    // The map arrives after the meta, over a chain of public APIs: ani.zip for
    // the MAL id, then up to four Jikan pages 400 ms apart, each of which can
    // eat a 429 + retry. 20 s was not enough of a budget for that on a cold
    // cache and made this assertion the suite's flakiest line.
    await expect(episodeCard(page, 33).getByText(/^filler$/i)).toBeVisible({ timeout: 60_000 });
    await expect(episodeCard(page, 50).getByText(/^filler$/i)).toBeVisible();
    await expect(episodeCard(page, 1).getByText(/^filler$/i)).toHaveCount(0);
    await expect(episodeCard(page, 34).getByText(/^filler$/i)).toHaveCount(0);

    // Picking 33 from the detail list is itself gated — wave it through, since
    // this half of the test is about what the PLAYER shows on a filler episode.
    await episodeCard(page, 33).click();
    const gate = fillerModal(page);
    await expect(gate).toBeVisible({ timeout: 20_000 });
    await gate.getByRole('button', { name: /^Watch anyway/ }).click();

    // ---- Player on a filler episode: the notice, with a skip to the resume ---
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)33/, { timeout: 30_000 });
    const notice = fillerNotice(page);
    await expect(notice).toBeVisible({ timeout: 30_000 });
    // 33 is a one-episode run, so the copy is the singular form.
    await expect(notice.getByText(/This episode is filler\./)).toBeVisible();
    await expect(notice.getByRole('button', { name: /Skip to episode 34/ })).toBeVisible();
    // Dismiss hides it for THIS episode only.
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);

    // ---- Next from a canon episode into a run: the prompt, then Skip ----------
    // Drop the acknowledgement the "Watch anyway" above left behind: it covers
    // the whole run for this tab BY DESIGN (that is what test 2 asserts), so
    // without clearing it the prompt this section is about would never be
    // raised again.
    await page.evaluate((id) => sessionStorage.removeItem(`bliss:fillerAck:${id}`), BLEACH);
    await page.goto(`/detail/anime/${encodeURIComponent(BLEACH)}`);
    await episodeCard(page, 32).click();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)32/, { timeout: 30_000 });
    // 32 is canon: no notice.
    await expect(fillerNotice(page)).toHaveCount(0);
    // Next would enter the run at 33 — the button says so, and must ask first.
    const next = page.getByRole('button', { name: /^Next episode \(filler\)$/ });
    await expect(next).toBeVisible({ timeout: 30_000 });
    await next.click();
    const prompt = fillerModal(page);
    await expect(prompt).toBeVisible({ timeout: 10_000 });
    await expect(prompt.getByText(/Episode 33/)).toBeVisible();
    await expect(prompt.getByText(/This episode is filler\./)).toBeVisible();
    await expect(prompt.getByRole('button', { name: /^Watch anyway/ })).toBeVisible();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)32/); // still on 32
    // Skip lands past the run, on 34.
    await prompt.getByRole('button', { name: /Skip to episode 34/ }).click();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)34/, { timeout: 30_000 });
  });

  test('"Watch anyway" enters the run and is remembered for it', async ({ loggedInPage: page }) => {
    test.slow();
    await installKitsu(page);
    await page.goto(`/detail/anime/${encodeURIComponent(BLEACH)}`);
    await episodeCard(page, 32).click();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)32/, { timeout: 30_000 });
    const next = page.getByRole('button', { name: /^Next episode \(filler\)$/ });
    await expect(next).toBeVisible({ timeout: 30_000 });
    await next.click();
    const prompt = fillerModal(page);
    await expect(prompt).toBeVisible({ timeout: 10_000 });
    await prompt.getByRole('button', { name: /^Watch anyway/ }).click();
    // Moved into the run; the notice marks it.
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)33/, { timeout: 30_000 });
    await expect(fillerNotice(page)).toBeVisible({ timeout: 30_000 });

    // The ack covers the whole run for the tab: going back to 32 and stepping
    // forward again must NOT raise the prompt a second time.
    await page.goto(`/detail/anime/${encodeURIComponent(BLEACH)}`);
    await episodeCard(page, 33).click();
    await expect(page).toHaveURL(/kitsu(%3A|:)244(%3A|:)33/, { timeout: 30_000 });
    await expect(fillerModal(page)).toHaveCount(0);
  });
});
