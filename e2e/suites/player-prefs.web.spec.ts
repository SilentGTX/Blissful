import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Profile preferences the WEB player must honour.
//
//  1. Audio language on a TRANSCODED (Real-Debrid) stream. The transcoder muxes
//     one track at a time (&a=N), so the player has to pick the index itself —
//     it used to always play track 0, i.e. French on a French release even for
//     an English-preferring profile.
//  2. RD-first for profiles carrying their own Real-Debrid key: no Videasy
//     resolve at all (its CDN being down would otherwise cost 20-40s before
//     the profile's own reliable source starts), while a keyless profile keeps
//     resolving Videasy first.
//
// Everything upstream is mocked, so these assert OUR decision logic.

const RD_MKV = 'https://e2e-rd.example/E2E.French.Release.1080p.mkv';

/** Seed profile settings for a logged-out session (localStorage is the source). */
async function seedSettings(page: Page, settings: Record<string, unknown>) {
  await page.goto('/');
  await page.evaluate((s) => {
    localStorage.setItem('blissful.playerSettings', JSON.stringify(s));
  }, settings);
}

test.describe('Player profile preferences (web)', () => {
  test('audio language: picks the English track on a French-first RD release', async ({ page }) => {
    await seedSettings(page, { audioLanguage: 'eng' });

    // A French release: tracks 0/1 French, track 2 English — the exact shape
    // that exposed the bug.
    await page.route(/\/transcode-audio\?/, (route) =>
      route.fulfill({
        json: {
          tracks: [
            { i: 0, lang: 'fre', title: 'VFF AC3 5.1 @448kbps', channels: 6, codec: 'ac3' },
            { i: 1, lang: 'fre', title: 'VFQ AC3 5.1 @448kbps', channels: 6, codec: 'ac3' },
            { i: 2, lang: 'eng', title: 'VO AC3 5.1 @640kbps', channels: 6, codec: 'ac3' },
          ],
        },
      }),
    );
    await page.route(/\/probe-streams\?/, (route) => route.fulfill({ json: { subtitles: [] } }));
    await page.route(/\/transcode\.m3u8\?/, (route) => route.fulfill({ status: 404 }));

    // The player must ask the transcoder for track 2 (`&a=2`).
    const trackRequested = page.waitForRequest(
      (req) => /\/transcode\.m3u8\?/.test(req.url()) && /[?&]a=2(&|$)/.test(req.url()),
      { timeout: 30_000 },
    );

    await page.goto(`/player?${new URLSearchParams({
      type: 'movie',
      id: 'tt9990002',
      url: RD_MKV,
      rdsel: '1',
      title: 'E2E French Release',
    })}`);

    const req = await trackRequested;
    expect(decodeURIComponent(req.url()), 'must transcode the same RD file').toContain(RD_MKV);
  });

  test('audio language: a URL-pinned &a=N wins (watch-party guests follow the host)', async ({ page }) => {
    await seedSettings(page, { audioLanguage: 'eng' });
    await page.route(/\/transcode-audio\?/, (route) =>
      route.fulfill({
        json: {
          tracks: [
            { i: 0, lang: 'fre', title: 'VFF', channels: 6, codec: 'ac3' },
            { i: 1, lang: 'eng', title: 'VO', channels: 6, codec: 'ac3' },
          ],
        },
      }),
    );
    await page.route(/\/probe-streams\?/, (route) => route.fulfill({ json: { subtitles: [] } }));
    await page.route(/\/transcode\.m3u8\?/, (route) => route.fulfill({ status: 404 }));

    // Guest joins pinned to the host's French track 0 — the English preference
    // must NOT hijack it (that would desync the party's audio).
    const pinned = `/transcode.m3u8?url=${encodeURIComponent(RD_MKV)}&a=0`;
    await page.goto(`/player?${new URLSearchParams({
      type: 'movie', id: 'tt9990002', url: pinned, rdsel: '1', title: 'E2E Pinned',
    })}`);

    // Give the probe time to land, then assert no &a=1 was ever requested.
    const requested: string[] = [];
    page.on('request', (r) => { if (/\/transcode\.m3u8\?/.test(r.url())) requested.push(r.url()); });
    await page.waitForTimeout(6000);
    expect(requested.some((u) => /[?&]a=1(&|$)/.test(u)), 'must not switch off the pinned track').toBe(false);
  });

  test('an RD-key profile skips the Videasy resolve entirely', async ({ page }) => {
    await seedSettings(page, { realDebridApiKey: 'E2E-RD-KEY' });

    let videasyCalls = 0;
    await page.route(/\/videasy-sources\?/, (route) => {
      videasyCalls += 1;
      // Never reached on success; answer anyway so a regression doesn't hang.
      return route.fulfill({ json: { sources: [], subtitles: [] } });
    });
    await page.route(/\/tmdb-find\?/, (route) => route.fulfill({ json: { tmdbId: 999902, mediaType: 'movie' } }));
    await page.route(/\/rd-fallback\?/, (route) =>
      route.fulfill({ json: { streams: [{ name: '[RD+] Torrentio 1080p', title: 'E2E RD release', url: RD_MKV }] } }));
    await page.route(/\/resolve-url\?/, (route) =>
      route.fulfill({ json: { status: 200, finalUrl: RD_MKV, contentLength: 2_000_000 } }));
    await page.route(/\/transcode-audio\?/, (route) => route.fulfill({ json: { tracks: [] } }));
    await page.route(/\/probe-streams\?/, (route) => route.fulfill({ json: { subtitles: [] } }));
    await page.route(/\/transcode\.m3u8\?/, (route) => route.fulfill({ status: 404 }));

    const transcodeRequested = page.waitForRequest(/\/transcode\.m3u8\?/, { timeout: 45_000 });

    await page.goto(`/player?${new URLSearchParams({
      type: 'movie',
      id: 'tt9990003',
      url: 'vidking:placeholder',
      title: 'E2E RD First',
    })}`);

    const req = await transcodeRequested;
    expect(decodeURIComponent(req.url()), 'RD stream must play').toContain(RD_MKV);
    expect(videasyCalls, 'no Videasy resolve may fire for an RD-key profile').toBe(0);
  });

  test('a keyless profile still resolves Videasy first', async ({ page }) => {
    // The inverse guard — RD-first must not leak into non-RD profiles.
    await seedSettings(page, { realDebridApiKey: '' });

    await page.route(/\/tmdb-find\?/, (route) => route.fulfill({ json: { tmdbId: 999904, mediaType: 'movie' } }));
    const videasyRequested = page.waitForRequest(/\/videasy-sources\?/, { timeout: 30_000 });
    await page.route(/\/videasy-sources\?/, (route) => route.fulfill({ json: { sources: [], subtitles: [] } }));
    await page.route(/\/rd-fallback\?/, (route) => route.fulfill({ json: { streams: [] } }));

    await page.goto(`/player?${new URLSearchParams({
      type: 'movie',
      id: 'tt9990005',
      url: 'vidking:placeholder',
      title: 'E2E Vidking First',
    })}`);

    await videasyRequested; // throws if Videasy was skipped
  });
});
