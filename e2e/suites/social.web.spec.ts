import { test, expect } from '../fixtures/auth';

// Social / friends / presence (web). Logged-out GATING + the logged-in friends
// accordion are testable here; the REAL two-account friend flow (request →
// accept → friends) + presence lookup live in social.protocol.spec.ts. Only the
// live /ws/user-pushed bits (online indicator, party-invite pills) stay fixme.

test.describe('Social / friends / presence (web)', () => {
  test('friends UI is gated — absent when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('Search everything')).toBeVisible({ timeout: 20_000 }); // page loaded
    // FriendsAccordion renders null without auth, so its toggle is not in the DOM.
    await expect(page.getByTestId('friends-accordion-toggle')).toHaveCount(0);
  });

  test('friends accordion is present when logged in (real account)', async ({ loggedInPage: page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('Search everything')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('friends-accordion-toggle')).toBeVisible({ timeout: 20_000 });
  });

  // The real friend flow (request → accept → friends) + presence lookup are in
  // social.protocol.spec.ts. Only the live /ws/user-pushed bits stay deferred —
  // they need an authed UserSocketProvider socket (not just REST):
  test.fixme('online/watching presence indicator on friend avatars — needs /ws/user socket', () => {});
  test.fixme('party invite accept/join pills — need a /ws/user push from a second user', () => {});
});
