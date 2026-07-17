import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Videasy dead-CDN failover (web) — regression tests for the 2026-07-18 outage:
// /videasy-sources resolves fine, but the CDN behind the returned URLs is dead.
// Two observed shapes, both must end in the addon fallback committing the House
// RD stream instead of trusting "the API returned sources" and spinning on
// hls.js retries:
//   1. the manifest itself never loads (proxy 504s), and
//   2. the manifest loads but the segment hosts are dead (pool churn) — a
//      manifest-only health check passes right into an unplayable stream.
//
// Everything upstream is mocked at the network layer (instant 504s where prod
// takes seconds per attempt — same verdict, fast test), so this exercises the
// page's failover logic, not videasy itself. The proof of failover is the
// player requesting the transcode-wrapped RD URL; actually decoding it is
// covered by the desktop transcode suites (Playwright's Chromium has no H.264).

const RD_URL = 'https://e2e-rd.example/E2E.Fallback.1080p.mkv';
const DEAD_MANIFEST = `/addon-proxy?url=${encodeURIComponent('https://e2e-dead.example/1080p/index.m3u8')}&vd=1`;
const ALIVE_MANIFEST = `/addon-proxy?url=${encodeURIComponent('https://e2e-alive.example/1080p/index.m3u8')}&vd=1`;
// A valid single-segment VOD playlist whose only segment lives on the dead host.
const PLAYLIST_WITH_DEAD_SEGMENT = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:8',
  '#EXTINF:8.0,',
  `/addon-proxy?url=${encodeURIComponent('https://e2e-dead.example/1080p/seg1.ts')}&vd=1`,
  '#EXT-X-ENDLIST',
  '',
].join('\n');

// Shared mocks: TMDB lookup, House RD fallback, healthy RD probe, dead host,
// and a 404 transcode stub (the request firing is the assertion target).
async function mockBackend(page: Page, manifestUrl: string) {
  await page.route(/\/tmdb-find\?/, (route) =>
    route.fulfill({ json: { tmdbId: 999901, mediaType: 'movie' } }));
  await page.route(/\/videasy-sources\?/, (route) =>
    route.fulfill({ json: { sources: [{ quality: '1080p', url: manifestUrl }], subtitles: [] } }));
  await page.route(/\/addon-proxy\?url=.*e2e-dead/, (route) =>
    route.fulfill({ status: 504, body: 'upstream timeout' }));
  await page.route(/\/rd-fallback\?/, (route) =>
    route.fulfill({ json: { streams: [{ name: '[RD+] Torrentio 1080p', title: 'E2E RD release', url: RD_URL }] } }));
  await page.route(/\/resolve-url\?/, (route) =>
    route.fulfill({ json: { status: 200, finalUrl: RD_URL, contentLength: 1_000_000 } }));
  await page.route(/\/transcode\.m3u8\?/, (route) => route.fulfill({ status: 404 }));
}

async function expectRdFallback(page: Page, logNeedle: string) {
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
  // The probe (not a videasy resolve failure) is what killed the source.
  await expect
    .poll(() => logs.some((l) => l.includes(logNeedle)), { timeout: 10_000 })
    .toBe(true);
}

test.describe('Player videasy failover (web)', () => {
  test('dead manifest → addon fallback commits the RD stream', async ({ page }) => {
    await mockBackend(page, DEAD_MANIFEST);
    await expectRdFallback(page, 'videasy source dead (manifest/segment unreachable)');
  });

  test('live manifest but dead segment host → RD stream still commits', async ({ page }) => {
    await mockBackend(page, ALIVE_MANIFEST);
    await page.route(/\/addon-proxy\?url=.*e2e-alive/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/vnd.apple.mpegurl',
        body: PLAYLIST_WITH_DEAD_SEGMENT,
      }));
    await expectRdFallback(page, 'videasy source dead (manifest/segment unreachable)');
  });
});
