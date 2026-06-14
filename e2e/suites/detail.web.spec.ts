import { test, expect } from '@playwright/test';

// Detail + streams (web). Asserts STRUCTURE on the real /detail page using
// deterministic, well-known IDs — NOT live stream/addon content (which changes).
// The page renders mobile + desktop variants (same testid twice), so we select
// the VISIBLE one. Meta comes from Cinemeta via the dev proxy → prod.

const vis = (page: import('@playwright/test').Page, testid: string) =>
  page.locator(`[data-testid="${testid}"]:visible`).first();

test.describe('Detail + streams (web)', () => {
  test('movie detail renders the meta panel + a Play action', async ({ page }) => {
    await page.goto('/detail/movie/tt1254207'); // Big Buck Bunny — stable in Cinemeta
    await expect(vis(page, 'detail-meta-panel')).toBeVisible({ timeout: 30_000 });
    // Movies have no inline streams list — the releases picker is behind Play.
    await expect(page.getByRole('button', { name: /^play$/i }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('series detail renders the meta panel + episode list', async ({ page }) => {
    await page.goto('/detail/series/tt9813792'); // "From" — stable series in Cinemeta
    await expect(vis(page, 'detail-meta-panel')).toBeVisible({ timeout: 30_000 });
    await expect(vis(page, 'detail-episode-list')).toBeVisible({ timeout: 30_000 });
  });

  // DEFERRED — live addon data is flaky (seeders/torrents change); tracked, not dropped:
  // - specific release rows / seeders / sizes in the BananasPicker
  // - the addon filter changing the visible stream set
  // - clicking a release navigating to /player (depends on a resolvable stream existing)
  test.fixme('stream rows / addon filter / release -> player — live addon data', () => {});
});
