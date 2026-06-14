import { test, expect } from '../fixtures/auth';

// Addons management (web). Page + modal structure (logged out), plus a REAL
// install→uninstall round-trip on a throwaway logged-in account (so it mutates a
// test account, not the user's). Uses existing selectors (button text + placeholders).

test.describe('Addons (web)', () => {
  test('addons page renders the add button + search', async ({ page }) => {
    await page.goto('/addons');
    await expect(page.getByRole('button', { name: 'Add addon' }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByPlaceholder('Search addons').first()).toBeVisible({ timeout: 20_000 });
  });

  test('add-addon modal opens with a manifest URL input', async ({ page }) => {
    await page.goto('/addons');
    await page.getByRole('button', { name: 'Add addon' }).first().click();
    await expect(page.getByPlaceholder(/manifest\.json/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('install then uninstall an addon (real, throwaway account)', async ({ loggedInPage: page }) => {
    test.slow();
    await page.goto('/addons');
    const manifest = 'https://opensubtitles-v3.strem.io/manifest.json';
    await page.getByRole('button', { name: 'Add addon' }).first().click();
    await page.getByPlaceholder(/manifest\.json/i).first().fill(manifest);
    await page.getByRole('button', { name: 'Install', exact: true }).click(); // 'Install' ⊂ 'Uninstall'
    // The installed addon appears in the list.
    await expect(page.getByText(/opensubtitles/i).first()).toBeVisible({ timeout: 25_000 });
    // Filter to it, then uninstall the now-only match and confirm it's gone.
    await page.getByPlaceholder('Search addons').first().fill('opensubtitles');
    await page.getByRole('button', { name: 'Uninstall', exact: true }).first().click();
    await expect(page.getByText(/opensubtitles/i)).toHaveCount(0, { timeout: 15_000 });
  });
});
