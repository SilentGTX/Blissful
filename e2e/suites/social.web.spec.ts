import { test, expect } from '../fixtures/auth';

// Social / friends / presence (web). Logged-out GATING + the logged-in friends
// accordion are testable here; the REAL two-account friend flow (request →
// accept → friends) + presence lookup live in social.protocol.spec.ts, and the
// live /ws/user push layer (online/activity signal + party-invite request→accept)
// in social-ws.protocol.spec.ts.

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
  // social.protocol.spec.ts; the live /ws/user push layer — online/activity
  // signal and the party-invite request→accept handshake between two authed
  // sockets — is covered for real in social-ws.protocol.spec.ts.
});
