import { test, expect } from '../fixtures/auth';

// Auth + library (web). Auth is Blissful's OWN account system (not Stremio —
// that's only the optional "sync with Stremio" import), so we register throwaway
// accounts and test BOTH the logged-out surface (CTA, login modal, register
// toggle) AND the real logged-in library via a seeded token.

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

  test('logged-in library renders the logged-in state (real account)', async ({ loggedInPage: page }) => {
    await page.goto('/library');
    // Logged in → NOT the CTA; the logged-in library UI (sort chips) renders.
    await expect(page.getByText('Login to see your Stremio library')).toHaveCount(0);
    await expect(page.getByText('Last watched').first()).toBeVisible({ timeout: 20_000 });
  });
});
