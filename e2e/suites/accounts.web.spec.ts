import { test, expect, registerAccount, loginAs } from '../fixtures/auth';

// Multi-account switching (web/desktop UI), mirroring the Android TV app.
// Uses TWO real throwaway accounts and drives the actual UI: sign in as A, add
// B alongside it via the login modal, then switch back to A from the picker.
// The oracle is the profile name the shell renders, which is token-derived —
// so it only changes if the ACTIVE token really changed.

test.describe('Multi-account switching (web)', () => {
  test('adds a second profile and switches back to the first', async ({ page }) => {
    const a = await registerAccount('acct_a');
    const b = await registerAccount('acct_b');

    await loginAs(page, a.token);
    await page.goto('/');

    // Which saved profile is active. Signing in mints a FRESH token, so the
    // token string itself is not comparable — the user id behind it is.
    const activeUserId = () =>
      page.evaluate(() => {
        const token = localStorage.getItem('bliss:authToken');
        const saved = JSON.parse(localStorage.getItem('bliss:accounts') || '[]') as Array<{
          token: string;
          user: { id: string };
        }>;
        return saved.find((a) => a.token === token)?.user.id ?? null;
      });

    const openPicker = async () => {
      await page.locator('[aria-label="Account"]').first().click();
      await page.getByRole('menuitem').first().click(); // "Profiles"
      await expect(page.getByText("Who's watching?").first()).toBeVisible({ timeout: 10_000 });
    };

    // A is the only profile — no other tiles yet, but "Add account" is offered.
    await openPicker();
    await expect(page.getByTestId('who-watching-account')).toHaveCount(0);
    await page.getByTestId('who-watching-add-account').click();

    // Signing in as B must ADD it, not replace A.
    await expect(page.getByLabel('Username')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Username').fill(b.username);
    await page.getByLabel('Password').fill(b.password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    // The active profile is the real oracle — the profile name only renders
    // inside the account dropdown, not on the page.
    await expect.poll(activeUserId, { timeout: 20_000 }).toBe(b.id);
    // A fresh sign-in with no avatar opens "Profile setup" — dismiss it, same
    // as a real user would, so it doesn't sit over the picker.
    const profileSetup = page.getByRole('button', { name: 'Cancel' });
    if (await profileSetup.isVisible().catch(() => false)) await profileSetup.click();

    // A survived the second sign-in and is now a switchable tile.
    await openPicker();
    const tileA = page.getByTestId('who-watching-account').filter({ hasText: a.displayName });
    await expect(tileA).toHaveCount(1);
    await tileA.click();

    // One click really swapped the active token back.
    await expect.poll(activeUserId, { timeout: 10_000 }).toBe(a.id);
    // ...and B is now the one offered to switch to.
    await openPicker();
    await expect(page.getByTestId('who-watching-account').filter({ hasText: b.displayName })).toHaveCount(1);
  });

  test('both profiles persist across a reload', async ({ page }) => {
    const a = await registerAccount('acct_p');
    const b = await registerAccount('acct_q');
    await loginAs(page, a.token);
    await page.goto('/');
    // Seed the switcher the way two sign-ins would, then prove it survives a
    // reload (localStorage-backed, like the TV app's MMKV store).
    await page.evaluate(
      ([accs]) => localStorage.setItem('bliss:accounts', JSON.stringify(accs)),
      [[{ token: a.token, user: { id: a.id, username: a.username, displayName: a.displayName, avatar: null, email: null } },
        { token: b.token, user: { id: b.id, username: b.username, displayName: b.displayName, avatar: null, email: null } }]],
    );
    await page.reload();
    await page.locator('[aria-label="Account"]').first().click();
    await page.getByRole('menuitem').first().click();
    await expect(page.getByTestId('who-watching-account').filter({ hasText: b.displayName })).toHaveCount(1, {
      timeout: 10_000,
    });
  });
});
