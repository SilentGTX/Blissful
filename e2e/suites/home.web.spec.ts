import { test, expect, type Page } from '@playwright/test';

// Home + browse (web). Asserts STRUCTURE on the real home / search / discover
// pages, using a search term guaranteed to have Cinemeta results ('Batman').
// Content is live — we assert that the hero / rows / grid RENDER, not specific titles.
//
// Classic and TV share the same page bodies (hero card + poster rails); the TV
// theme is a chrome reskin of the old Tauri TV app — icon-only rail, pill
// search, accent-filled primary action. So the body assertions run for both and
// the theme-specific ones cover the chrome.

/** Boot the app with a given uiStyle, the way the Settings page persists it. */
async function useTheme(page: Page, theme: 'classic' | 'tv') {
  await page.addInitScript((t) => localStorage.setItem('uiStyle', t), theme);
}

test.describe('Home + browse (web)', () => {
  for (const theme of ['classic', 'tv'] as const) {
    test(`${theme} home renders the hero, search bar, and media rails`, async ({ page }) => {
      await useTheme(page, theme);
      await page.goto('/');
      // The TV theme uses the old TV app's wording for the search placeholder.
      const placeholder = theme === 'tv' ? 'Search movies, series, actors...' : 'Search everything';
      await expect(page.getByPlaceholder(placeholder)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('home-hero-card')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('media-rail').first()).toBeVisible({ timeout: 30_000 });
    });
  }

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

// The two themes differ only in chrome, which makes them easy to cross-wire:
// a rule that forgets its html[data-ui="tv"] scope silently restyles Classic.
// These assert the signals that actually distinguish them.
test.describe('Theme chrome is scoped', () => {
  test('tv fills the hero primary with the accent; classic keeps it white', async ({ page }) => {
    const fillOf = async (theme: 'classic' | 'tv') => {
      await useTheme(page, theme);
      await page.goto('/');
      const btn = page.getByRole('button', { name: 'Watch now' }).first();
      await expect(btn).toBeVisible({ timeout: 30_000 });
      return btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    };
    // Accent is user-configurable, so assert "not white" rather than a literal.
    const tv = await fillOf('tv');
    expect(tv).not.toBe('rgb(255, 255, 255)');
    const classic = await fillOf('classic');
    expect(classic).toBe('rgb(255, 255, 255)');
  });

  test('tv collapses the rail to icons; classic leaves it expanded', async ({ page }) => {
    await useTheme(page, 'tv');
    await page.goto('/');
    await expect(page.locator('.bliss-sidebar.closed')).toHaveCount(1, { timeout: 20_000 });

    await useTheme(page, 'classic');
    await page.goto('/');
    await expect(page.getByTestId('home-hero-card')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.bliss-sidebar.closed')).toHaveCount(0);
  });
});
