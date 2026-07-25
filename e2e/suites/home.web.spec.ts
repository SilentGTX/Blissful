import { test, expect, type Page } from '@playwright/test';

// Home + browse (web). Asserts STRUCTURE on the real home / search / discover
// pages, using a search term guaranteed to have Cinemeta results ('Batman').
// Content is live — we assert that the hero / rows / grid RENDER, not specific titles.
//
// Two themes are covered because they render completely different homes:
// Classic (the default: NOW POPULAR hero card + poster rails) and TV (the
// Android TV design: immersive backdrop + landscape rails).

/** Boot the app with a given uiStyle, the way the Settings page persists it. */
async function useTheme(page: Page, theme: 'classic' | 'tv') {
  await page.addInitScript((t) => localStorage.setItem('uiStyle', t), theme);
}

test.describe('Home + browse (web)', () => {
  test('classic home renders the hero card, search bar, and media rails', async ({ page }) => {
    await useTheme(page, 'classic');
    await page.goto('/');
    await expect(page.getByPlaceholder('Search everything')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('home-hero-card')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('media-rail').first()).toBeVisible({ timeout: 30_000 });
    // The TV theme's chrome must NOT leak into Classic.
    await expect(page.locator('.bliss-backdrop--fixed')).toHaveCount(0);
  });

  test('tv home renders the immersive featured panel and landscape rails', async ({ page }) => {
    await useTheme(page, 'tv');
    await page.goto('/');
    await expect(page.getByPlaceholder('Search everything')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.bliss-backdrop--fixed')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.bliss-info-title')).not.toBeEmpty({ timeout: 30_000 });
    await expect(page.getByTestId('bliss-tile').first()).toBeVisible({ timeout: 30_000 });
  });

  test('tv home: hovering a tile swaps the featured title', async ({ page }) => {
    await useTheme(page, 'tv');
    await page.goto('/');
    const tiles = page.getByTestId('bliss-tile');
    await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
    const before = await page.locator('.bliss-info-title').textContent();
    // Pick a tile whose title differs from the one already featured, so the
    // assertion can't pass by hovering the item that is featured by default.
    const count = Math.min(await tiles.count(), 8);
    let target = null;
    for (let i = 0; i < count; i++) {
      const t = tiles.nth(i);
      if ((await t.getAttribute('title'))?.trim() !== before?.trim()) { target = t; break; }
    }
    expect(target, 'expected a tile other than the featured one').not.toBeNull();
    await target!.hover();
    await expect(page.locator('.bliss-info-title')).toHaveText((await target!.getAttribute('title'))!.trim(), {
      timeout: 15_000,
    });
  });

  test('search submits and navigates to the search page with results', async ({ page }) => {
    await page.goto('/');
    const search = page.getByPlaceholder('Search everything');
    await search.fill('Batman');
    await search.press('Enter');
    await page.waitForURL(/\/search/, { timeout: 15_000 });
    await expect(page.getByTestId('media-rail').first()).toBeVisible({ timeout: 30_000 });
  });

  test('discover renders the catalog grid', async ({ page }) => {
    await page.goto('/discover');
    await expect(page.getByTestId('discover-grid')).toBeVisible({ timeout: 30_000 });
  });
});
