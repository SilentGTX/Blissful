import { test, expect } from '@playwright/test';

// Addons management (web) — READ-ONLY structure. The page + the Add-addon modal
// render; install/uninstall are test.fixme (they MUTATE the real backend addon
// config). Uses existing selectors (button text + placeholders), no new testids.

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

  // DEFERRED — install/uninstall POST to blissful-storage and MUTATE the real
  // user's addon config (needs a stub or an isolated test account). Tracked.
  test.fixme('install / uninstall an addon — mutates the real backend', () => {});
});
