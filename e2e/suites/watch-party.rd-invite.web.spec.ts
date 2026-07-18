import { test, expect, chromium, type Page } from '@playwright/test';

// The "join my RD party" flow, end to end: a WEB host playing a real
// RD-fallbacked episode (The Chestnut Man — videasy's CDN is dead for it, so
// the player self-falls-back to the House RD transcode on the Mac), and a WEB
// guest joining via the /invite/<code> landing page. The guest must land on
// the HOST's exact transcode stream (url=<host streamUrl> + rdsel=1), not
// resolve its own source.
//
// This exercises: host announceStream → room.streamUrl → REST room info →
// buildRoomPlayerUrl pinning → guest player. Live backend + live RD.

const STORAGE_HTTP = process.env.STORAGE_HTTP || 'https://blissful.budinoff.com/storage';
const UI = process.env.E2E_DESKTOP_UI || 'http://localhost:5173';
const rid = () => 'e2erdinv' + Math.random().toString(36).slice(2, 10);

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

async function seedName(page: Page, name: string) {
  await page.goto(UI);
  await page.evaluate((n) => localStorage.setItem('bliss:watchParty:guestName', n), name);
}

test('web RD host → web guest via invite link lands on the host stream', async ({ page }) => {
  test.slow(); // RD fallback commit can take ~40s (videasy probe dies first)
  const code = await createRoom();

  // 1) HOST: short vidking URL + room. Videasy is dead for this episode, so
  //    the player self-falls-back to the House RD transcode, then announces
  //    the stream to the room.
  await seedName(page, 'RdHost');
  await page.goto(`${UI}/player/vidking/tt10834220:1:1/The.Chestnut.Man?t=0&room=${code}`);
  await expect
    .poll(
      () => page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement | null;
        void v?.play().catch(() => {});
        return v && v.currentTime > 0.5 && v.readyState >= 2;
      }),
      { timeout: 120_000, intervals: [2000] },
    )
    .toBe(true);

  // 2) The host must have announced its RD stream to the room.
  let hostStream: string | null = null;
  await expect
    .poll(async () => { hostStream = await roomStreamUrl(code); return hostStream; }, { timeout: 30_000, intervals: [1500] })
    .toMatch(/transcode|real-debrid/i);

  // 3) GUEST: joins via the invite landing page in a SEPARATE browser.
  const guestBrowser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const guest = await guestBrowser.newPage();
    await seedName(guest, 'RdGuest');
    await guest.goto(`${UI}/invite/${code}`);
    await guest.getByTestId('wp-invite-continue').click();

    // The player URL must pin the HOST's stream (rdsel=1 + the same url).
    await guest.waitForURL(/\/player\?/, { timeout: 20_000 });
    const params = new URLSearchParams(new URL(guest.url()).search);
    expect(params.get('rdsel'), 'guest must join in rd-selected mode').toBe('1');
    expect(params.get('url'), 'guest must play the host stream').toBe(hostStream);
    expect(params.get('room')).toBe(code);

    // And it actually plays (same Mac transcode the host is on).
    await expect
      .poll(
        () => guest.evaluate(() => {
          const v = document.querySelector('video') as HTMLVideoElement | null;
          void v?.play().catch(() => {});
          return v ? v.currentTime : 0;
        }),
        { timeout: 90_000, intervals: [2000] },
      )
      .toBeGreaterThan(0.5);
  } finally {
    await guestBrowser.close();
  }
});
