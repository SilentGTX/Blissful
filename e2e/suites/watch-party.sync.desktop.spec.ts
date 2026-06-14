import { mergeTests, expect, chromium, type Page } from '@playwright/test';
import { test as desktopTest } from '../fixtures/desktop';
import { test as mediaTest } from '../fixtures/media';

// Behavioral 2-client watch-party sync — the heart of the feature. A WEB host
// (chromium) and a DESKTOP guest (the mpv shell) in one room playing the same
// file; the guest must FOLLOW the host's play/pause/seek over the live backend.
// Migrated from scripts/e2e/watchparty.mjs (web↔desktop mode).
//
// Orientation: web = host (canCreate without login), desktop = guest. The room is
// created via REST (that creator never connects), so the FIRST WS joiner becomes
// host → the web host joins first, the desktop guest second.
const test = mergeTests(desktopTest, mediaTest);

const STORAGE_HTTP = process.env.STORAGE_HTTP || 'https://blissful.budinoff.com/storage';
const UI = process.env.E2E_DESKTOP_UI || 'http://localhost:5173';
const rid = () => 'e2ewp' + Math.random().toString(36).slice(2, 10);

async function createRoom(): Promise<string> {
  const res = await fetch(`${STORAGE_HTTP}/watch-party`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'movie', imdbId: 'tt1254207', videoId: null, password: null, guestId: rid() }),
  });
  if (!res.ok) throw new Error(`create room HTTP ${res.status}`);
  const { code } = await res.json();
  return code as string;
}

const playerUrl = (webm: string, room: string) =>
  `${UI}/player?${new URLSearchParams({ type: 'movie', id: 'tt1254207', url: webm, rdsel: '1', room, title: 'Sync' })}`;

async function seedName(page: Page, name: string) {
  await page.goto(UI);
  await page.evaluate((n) => localStorage.setItem('bliss:watchParty:guestName', n), name);
}

// Guest (desktop/mpv) playback state via mpv-prop-change events.
async function trackMpv(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __mpv: { timePos: number | null; paused: boolean | null };
      blissfulDesktop: { on: (e: string, cb: (d: { name: string; value: unknown }) => void) => void };
    };
    w.__mpv = { timePos: null, paused: null };
    w.blissfulDesktop.on('mpv-prop-change', (e) => {
      if (!e) return;
      if (e.name === 'time-pos' && typeof e.value === 'number') w.__mpv.timePos = e.value;
      if (e.name === 'pause' && typeof e.value === 'boolean') w.__mpv.paused = e.value;
    });
  });
}
const mpvTimePos = (p: Page) => p.evaluate(() => (window as unknown as { __mpv?: { timePos: number | null } }).__mpv?.timePos ?? null);
const mpvPaused = (p: Page) => p.evaluate(() => (window as unknown as { __mpv?: { paused: boolean | null } }).__mpv?.paused ?? null);

test('web host → desktop guest: the guest follows play / pause / resume', async ({ desktop, webmUrl }) => {
  test.slow();
  const room = await createRoom();

  // 1) Web HOST joins first (becomes host) + plays.
  const hostBrowser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const hostPage = await hostBrowser.newPage();
  try {
    await seedName(hostPage, 'HostUser');
    await hostPage.goto(playerUrl(webmUrl, room));
    // The host is held paused until its watch-party WS connects (and autoPlay,
    // fired during that gate, gets suppressed) — nudge play() until the gate
    // clears and the host actually advances; then it starts broadcasting ticks.
    await expect
      .poll(
        async () => {
          await hostPage.evaluate(() => (document.querySelector('video') as HTMLVideoElement | null)?.play().catch(() => {}));
          return hostPage.evaluate(() => (document.querySelector('video') as HTMLVideoElement | null)?.currentTime ?? 0);
        },
        { timeout: 45_000, intervals: [1000] },
      )
      .toBeGreaterThan(0.5);
    await hostPage.waitForTimeout(1500); // let the host start ticking

    // 2) Desktop GUEST joins second + follows the host.
    const guest = desktop.page;
    await seedName(guest, 'GuestUser');
    await guest.goto(playerUrl(webmUrl, room), { waitUntil: 'domcontentloaded' });
    await guest.waitForFunction(
      () => !!(window as unknown as { blissfulDesktop?: { on?: unknown } }).blissfulDesktop?.on,
      null,
      { timeout: 20_000 },
    );
    await trackMpv(guest);

    // Guest FOLLOWS PLAY: synced to the playing host, its mpv advances past 1s.
    await expect.poll(() => mpvTimePos(guest), { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(1.0);

    // Guest FOLLOWS PAUSE: host presses Space → the guest's mpv pauses.
    await hostPage.keyboard.press('Space');
    await expect.poll(() => mpvPaused(guest), { timeout: 15_000, intervals: [500] }).toBe(true);

    // Guest FOLLOWS RESUME.
    await hostPage.keyboard.press('Space');
    await expect.poll(() => mpvPaused(guest), { timeout: 15_000, intervals: [500] }).toBe(false);
  } finally {
    await hostBrowser.close();
  }
});
