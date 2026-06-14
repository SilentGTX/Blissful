import { test, expect } from '@playwright/test';

// Auth + library (web). Real login needs Stremio credentials we don't have in the
// test env, so this covers the deterministic, credential-free surface: the
// logged-out library CTA, the login modal + its fields, and the login/register
// toggle. Each test gets a fresh (logged-out) context. Uses existing selectors.

test.describe('Auth + library (web)', () => {
  test('logged-out library shows the login CTA', async ({ page }) => {
    await page.goto('/library');
    await expect(page.getByText('Login to see your Stremio library')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Login' }).first()).toBeVisible();
  });

  test('login button opens the modal with username + password fields', async ({ page }) => {
    await page.goto('/library');
    await page.getByRole('button', { name: 'Login' }).first().click();
    await expect(page.getByLabel('Username')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('login form toggles to register mode (confirm-password appears)', async ({ page }) => {
    await page.goto('/library');
    await page.getByRole('button', { name: 'Login' }).first().click();
    await expect(page.getByLabel('Username')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByLabel('Confirm password')).toBeVisible({ timeout: 10_000 });
  });

  // DEFERRED — real login needs Stremio credentials; library content + library
  // writes (add/remove) are auth-gated and mutate the real account. Tracked.
  test.fixme('real login + library content + item removal — needs credentials', () => {});
});
