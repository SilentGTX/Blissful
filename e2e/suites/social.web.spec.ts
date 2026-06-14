import { test, expect } from '@playwright/test';

// Social / friends / presence (web). This surface is auth + multi-user +
// WebSocket-push gated, so the only thing deterministic without mocking is the
// logged-out GATING. The real friends list, user search, friend requests,
// presence (online/watching), and party invites all need a logged-in session +
// a SECOND user + server-pushed events — tracked as test.fixme below.

test.describe('Social / friends / presence (web)', () => {
  test('friends UI is gated — absent when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('Search everything')).toBeVisible({ timeout: 20_000 }); // page loaded
    // FriendsAccordion renders null without auth, so its toggle is not in the DOM.
    await expect(page.getByTestId('friends-accordion-toggle')).toHaveCount(0);
  });

  // DEFERRED — needs auth + a second user + WebSocket push (mock friendsApi +
  // UserSocketProvider, or two real accounts). Tracked, not dropped:
  test.fixme('friends list / user search / friend requests — needs auth + mocked friendsApi', () => {});
  test.fixme('presence online/watching indicators — needs auth + a second user', () => {});
  test.fixme('party invite accept/join pills — needs WebSocket push from a second user', () => {});
});
