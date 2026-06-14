import { test, expect } from '@playwright/test';

// Home + browse (web). Asserts STRUCTURE on the real home / search / discover
// pages, using a search term guaranteed to have Cinemeta results ('Batman').
// Content is live — we assert that the hero / rows / grid RENDER, not specific titles.

test.describe('Home + browse (web)', () => {
  test('home renders the hero, search bar, and media rails', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('Search everything')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('home-hero-card')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('media-rail').first()).toBeVisible({ timeout: 30_000 });
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
