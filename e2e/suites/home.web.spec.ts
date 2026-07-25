import { test, expect } from '@playwright/test';

// Home + browse (web). Asserts STRUCTURE on the real home / search / discover
// pages, using a search term guaranteed to have Cinemeta results ('Batman').
// Content is live — we assert that the hero / rows / grid RENDER, not specific titles.

test.describe('Home + browse (web)', () => {
  test('home renders the immersive featured panel, search bar, and landscape rails', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('Search everything')).toBeVisible({ timeout: 20_000 });
    // The Android-TV-style home: full-bleed backdrop + featured panel driven by
    // the hovered tile, over rails of 16:9 landscape tiles.
    await expect(page.locator('.bliss-backdrop--fixed')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.bliss-info-title')).not.toBeEmpty({ timeout: 30_000 });
    await expect(page.getByTestId('bliss-tile').first()).toBeVisible({ timeout: 30_000 });
  });

  test('hovering a tile swaps the featured title', async ({ page }) => {
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
