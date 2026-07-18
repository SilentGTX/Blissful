import { mergeTests, expect, chromium, type Page } from '@playwright/test';
import { test as desktopTest } from '../fixtures/desktop';
import { test as mediaTest } from '../fixtures/media';

// Behavioral 2-client watch-party sync, MIRRORED: a DESKTOP host (the mpv
// shell) and a WEB guest (chromium) in one room playing the same file; the
// web guest must FOLLOW the desktop host's play / pause / resume over the
// live backend. Complements watch-party.sync.desktop.spec.ts (web host →
// desktop guest) so BOTH directions of the cross-platform pairing are held.
//
// Orientation: the room is created via REST (that creator never connects),
// so the FIRST WS joiner becomes host → the desktop joins first here.
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

// Host (desktop/mpv) playback state via mpv-prop-change events.
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

test('desktop host → web guest: the guest follows play / pause / resume', async ({ desktop, webmUrl }) => {
  test.slow();
  const room = await createRoom();

  // 1) DESKTOP joins first → becomes host; mpv plays + starts ticking.
  const host = desktop.page;
  await seedName(host, 'DesktopHost');
  await host.goto(playerUrl(webmUrl, room), { waitUntil: 'domcontentloaded' });
  await host.waitForFunction(
    () => !!(window as unknown as { blissfulDesktop?: { on?: unknown } }).blissfulDesktop?.on,
    null,
    { timeout: 20_000 },
  );
  await trackMpv(host);
  await expect.poll(() => mpvTimePos(host), { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(0.5);
  await host.waitForTimeout(1500); // let the host start ticking

  // 2) WEB guest joins second + follows.
  const guestBrowser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const guest = await guestBrowser.newPage();
    await seedName(guest, 'WebGuest');
    await guest.goto(playerUrl(webmUrl, room));
    const vidTime = () =>
      guest.evaluate(() => (document.querySelector('video') as HTMLVideoElement | null)?.currentTime ?? 0);
    const vidPaused = () =>
      guest.evaluate(() => (document.querySelector('video') as HTMLVideoElement | null)?.paused ?? null);

    // Guest FOLLOWS PLAY: synced to the playing host, its video advances past 1s.
    await expect.poll(vidTime, { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(1.0);

    // Guest FOLLOWS PAUSE: the desktop host presses Space → mpv pauses →
    // the pause broadcasts → the web guest's <video> pauses.
    await host.keyboard.press('Space');
    await expect.poll(() => mpvPaused(host), { timeout: 10_000, intervals: [500] }).toBe(true);
    await expect.poll(vidPaused, { timeout: 15_000, intervals: [500] }).toBe(true);

    // Guest FOLLOWS RESUME.
    await host.keyboard.press('Space');
    await expect.poll(vidPaused, { timeout: 15_000, intervals: [500] }).toBe(false);
  } finally {
    await guestBrowser.close();
  }
});
