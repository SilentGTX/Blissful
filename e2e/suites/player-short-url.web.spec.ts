import { test, expect } from '@playwright/test';

// Short player URLs (web). /player/vidking/<id>/<slug> and /player/rd/<id>/<slug>
// are a cosmetic front door: the seeder (MiniPlayerProvider) expands them into
// the internal query form, and the address bar stays short. These assert the
// routing + translation integration (the pure build/parse logic is unit-tested
// in src/lib/playerUrl.test.ts). Backend is mocked at the network layer so the
// test doesn't depend on vidking being up.

const MANIFEST = `/addon-proxy?url=${encodeURIComponent('https://e2e-short.example/1080p/index.m3u8')}&vd=1`;

test.describe('Short player URLs (web)', () => {
  test('vidking short path resolves vidking and keeps the URL short', async ({ page }) => {
    await page.route(/\/tmdb-find\?/, (route) =>
      route.fulfill({ json: { tmdbId: 550, mediaType: 'movie' } }));
    // The seeder must translate the path → url=vidking:placeholder, which drives
    // this resolve. If it fired, the translation worked.
    let videasyResolved = false;
    await page.route(/\/videasy-sources\?/, (route) => {
      videasyResolved = true;
      route.fulfill({ json: { sources: [{ quality: '1080p', url: MANIFEST }], subtitles: [] } });
    });
    // A healthy single-segment playlist — the player probes the manifest AND
    // its first segment before trusting the source, so both must answer 200.
    const SEG = `/addon-proxy?url=${encodeURIComponent('https://e2e-short.example/1080p/seg1.ts')}&vd=1`;
    await page.route(/\/addon-proxy\?url=.*e2e-short.*index\.m3u8/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/vnd.apple.mpegurl',
        body: `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:8\n#EXTINF:8.0,\n${SEG}\n#EXT-X-ENDLIST\n`,
      }));
    await page.route(/\/addon-proxy\?url=.*e2e-short.*seg1\.ts/, (route) =>
      route.fulfill({ status: 200, contentType: 'video/mp2t', body: 'x'.repeat(2048) }));
    await page.route(/\/rd-fallback\?/, (route) => route.fulfill({ json: { streams: [] } }));

    await page.goto('/player/vidking/tt0137523/Fight.Club');

    // Translation drove a vidking resolve...
    await expect.poll(() => videasyResolved, { timeout: 20_000 }).toBe(true);
    // ...and the address bar stayed the short path (no rewrite to ?url=…).
    expect(new URL(page.url()).pathname).toBe('/player/vidking/tt0137523/Fight.Club');
    expect(page.url()).not.toContain('url=vidking');
  });

  test('rd short path with no saved stream opens the releases picker', async ({ page }) => {
    await page.route(/\/tmdb-find\?/, (route) =>
      route.fulfill({ json: { tmdbId: 550, mediaType: 'movie' } }));
    await page.route(/\/videasy-sources\?/, (route) =>
      route.fulfill({ json: { sources: [], subtitles: [] } }));
    await page.route(/\/rd-fallback\?/, (route) =>
      route.fulfill({ json: { streams: [{ name: '[RD+] Torrentio 1080p', title: 'E2E RD release', url: 'https://e2e-rd.example/x.mkv' }] } }));
    await page.route(/\/resolve-url\?/, (route) =>
      route.fulfill({ json: { status: 200, finalUrl: 'https://e2e-rd.example/x.mkv', contentLength: 1000 } }));

    await page.goto('/player/rd/tt0137523/Fight.Club');

    // pickReleases mode auto-opens the Releases tab in the settings drawer.
    await expect(page.getByRole('tab', { name: 'Releases' })).toBeVisible({ timeout: 20_000 });
  });
});
