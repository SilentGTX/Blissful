import { test, expect } from '@playwright/test';

// Videasy dead-CDN failover (web) — regression test for the 2026-07-18 outage:
// /videasy-sources resolves fine, but the CDN behind the returned manifest URLs
// never answers a byte (the proxy 504s; videasy's own player spun forever too).
// The player page must probe the manifest it is about to play, declare the
// source dead, and let the addon fallback commit the House RD stream — instead
// of trusting "the API returned sources" and spinning on hls.js retries.
//
// Everything upstream is mocked at the network layer (instant 504s where prod
// takes ~25s per attempt — same verdict, fast test), so this exercises the
// page's failover logic, not videasy itself. The proof of failover is the
// player requesting the transcode-wrapped RD URL; actually decoding it is
// covered by the desktop transcode suites (Playwright's Chromium has no H.264).

const DEAD_M3U8 = 'https://e2e-dead.example/1080p/index.m3u8';
const DEAD_MANIFEST = `/addon-proxy?url=${encodeURIComponent(DEAD_M3U8)}&vd=1`;
const RD_URL = 'https://e2e-rd.example/E2E.Fallback.1080p.mkv';

test.describe('Player videasy failover (web)', () => {
  test('dead videasy manifest → addon fallback commits the RD stream', async ({ page }) => {
    // TMDB lookup — the videasy resolve is gated on it.
    await page.route(/\/tmdb-find\?/, (route) =>
      route.fulfill({ json: { tmdbId: 999901, mediaType: 'movie' } }));
    // Videasy "resolves" a source whose manifest is unreachable.
    await page.route(/\/videasy-sources\?/, (route) =>
      route.fulfill({ json: { sources: [{ quality: '1080p', url: DEAD_MANIFEST }], subtitles: [] } }));
    // The dead CDN: every proxied fetch of it fails (both the page's manifest
    // probe and hls.js's own manifest loads land here).
    await page.route(/\/addon-proxy\?url=.*e2e-dead/, (route) =>
      route.fulfill({ status: 504, body: 'upstream timeout' }));
    // House RD fallback has the title.
    await page.route(/\/rd-fallback\?/, (route) =>
      route.fulfill({ json: { streams: [{ name: '[RD+] Torrentio 1080p', title: 'E2E RD release', url: RD_URL }] } }));
    // Dead-link/DMCA probe for the RD candidate — healthy.
    await page.route(/\/resolve-url\?/, (route) =>
      route.fulfill({ json: { status: 200, finalUrl: RD_URL, contentLength: 1_000_000 } }));
    // The committed RD stream plays via /transcode.m3u8 — the request firing is
    // the assertion target; don't let it fall through to the prod transcoder.
    await page.route(/\/transcode\.m3u8\?/, (route) => route.fulfill({ status: 404 }));

    const logs: string[] = [];
    page.on('console', (m) => logs.push(m.text()));
    const transcodeRequested = page.waitForRequest(/\/transcode\.m3u8\?/, { timeout: 60_000 });

    await page.goto(`/player?${new URLSearchParams({
      type: 'movie',
      id: 'tt9990001',
      url: 'vidking:placeholder',
      title: 'E2E Videasy Dead',
    })}`);

    const req = await transcodeRequested;
    expect(decodeURIComponent(req.url()), 'the fallback must play the RD release').toContain(RD_URL);
    // The manifest probe (not a videasy resolve failure) is what killed the source.
    await expect
      .poll(() => logs.some((l) => l.includes('videasy manifest unreachable')), { timeout: 10_000 })
      .toBe(true);
  });
});
