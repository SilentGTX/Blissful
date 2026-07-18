import { test, expect, chromium } from '@playwright/test';

// The "join my RD party" flow, deterministic: a WEB host in rd-selected mode
// on a torrentio-RD transcode stream (the release-picker shape), and a WEB
// guest joining via the /invite/<code> landing page. Asserts, against the
// LIVE backend:
//   1. the host announces its stream → the room's REST info carries it;
//   2. the guest lands PINNED to the host stream (url=<streamUrl> + rdsel=1);
//   3. the guest STAYS pinned after the host's `host:source` broadcast —
//      regression: torrentio `/resolve/realdebrid/…` URLs used to classify as
//      `vidking` (not `rd`), so pinned guests un-pinned back to their own
//      resolution and sat through their own fallback ("guest waits for
//      fallback even though the party is already hosting RD").
//
// No real media plays: the /transcode manifest is stubbed, because the flow
// under test is announcement + pinning, not decoding.

const STORAGE_HTTP = process.env.STORAGE_HTTP || 'https://blissful.budinoff.com/storage';
const UI = process.env.E2E_DESKTOP_UI || 'http://localhost:5173';
const rid = () => 'e2erdinv' + Math.random().toString(36).slice(2, 10);

const TORRENTIO_RD =
  'https://torrentio.strem.fun/resolve/realdebrid/E2EKEY/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/null/0/Show.S01E01.1080p.mkv';
const HOST_STREAM = `/transcode.m3u8?url=${encodeURIComponent(TORRENTIO_RD)}`;

async function createRoom(): Promise<string> {
  const res = await fetch(`${STORAGE_HTTP}/watch-party`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'series', imdbId: 'tt10834220', videoId: 'tt10834220:1:1', password: null, guestId: rid() }),
  });
  if (!res.ok) throw new Error(`create room HTTP ${res.status}`);
  const { code } = await res.json();
  return code as string;
}

async function roomStreamUrl(code: string): Promise<string | null> {
  const res = await fetch(`${STORAGE_HTTP}/watch-party/${code}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { streamUrl?: string | null };
  return json.streamUrl ?? null;
}

test('web RD host → web guest via invite link lands (and stays) on the host stream', async ({ page }) => {
  test.slow();
  const code = await createRoom();

  // Keep the fake transcode fast + harmless on both pages.
  await page.route(/\/transcode\.m3u8\?/, (route) => route.fulfill({ status: 404 }));

  // 1) HOST: rd-selected mode on the torrentio-RD transcode, in the room.
  await page.goto(UI);
  await page.evaluate((n) => localStorage.setItem('bliss:watchParty:guestName', n), 'RdHost');
  await page.goto(
    `${UI}/player?${new URLSearchParams({
      type: 'series',
      id: 'tt10834220',
      videoId: 'tt10834220:1:1',
      url: HOST_STREAM,
      rdsel: '1',
      title: 'RD Host',
      room: code,
    })}`,
  );

  // The host connects and announces → the room carries the stream.
  await expect
    .poll(() => roomStreamUrl(code), { timeout: 30_000, intervals: [1500] })
    .toBe(HOST_STREAM);

  // 2) GUEST: joins via the invite landing page in a SEPARATE browser.
  const guestBrowser = await chromium.launch();
  try {
    const guest = await guestBrowser.newPage();
    await guest.route(/\/transcode\.m3u8\?/, (route) => route.fulfill({ status: 404 }));
    await guest.goto(UI);
    await guest.evaluate((n) => localStorage.setItem('bliss:watchParty:guestName', n), 'RdGuest');
    await guest.goto(`${UI}/invite/${code}`);
    await guest.getByTestId('wp-invite-continue').click();

    await guest.waitForURL(/\/player\?/, { timeout: 20_000 });
    const pinned = () => {
      const params = new URLSearchParams(new URL(guest.url()).search);
      return { url: params.get('url'), rdsel: params.get('rdsel'), room: params.get('room') };
    };
    expect(pinned(), 'guest must join pinned to the host stream').toEqual({
      url: HOST_STREAM,
      rdsel: '1',
      room: code,
    });

    // 3) STAYS pinned: the host's `host:source` broadcast arrives after the
    //    guest connects; the un-pin regression fired within a second or two.
    await guest.waitForTimeout(6000);
    expect(pinned(), 'guest must STAY pinned after host:source arrives').toEqual({
      url: HOST_STREAM,
      rdsel: '1',
      room: code,
    });
  } finally {
    await guestBrowser.close();
  }
});
