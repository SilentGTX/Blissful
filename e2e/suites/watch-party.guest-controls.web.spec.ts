import { test, expect } from '../fixtures/media';
import WebSocket from 'ws';

// Watch-party GUEST control-lock (web). When a web client is a guest in a room
// (not the host), the bottom-bar source/servers/releases picker must be rendered
// DISABLED with a "host only" tooltip — not silently absent. A fake WS host joins
// FIRST so the web player stays a guest (the first WS joiner becomes host).

const STORAGE_HTTP = process.env.STORAGE_HTTP || 'https://blissful.budinoff.com/storage';
const STORAGE_WS = process.env.STORAGE_WS || 'wss://blissful.budinoff.com/storage/ws/room';
const rid = () => 'e2egc' + Math.random().toString(36).slice(2, 10);

async function createRoom(): Promise<string> {
  const res = await fetch(`${STORAGE_HTTP}/watch-party`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'movie', imdbId: 'tt1254207', videoId: null, password: null, guestId: rid() }),
  });
  if (!res.ok) throw new Error(`create room HTTP ${res.status}`);
  return (await res.json()).code as string;
}

// Join a room over WS as the host (first joiner) and stay connected.
async function wsHostJoin(code: string): Promise<WebSocket> {
  const ws = new WebSocket(STORAGE_WS);
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  await new Promise<void>((res) => {
    ws.on('message', (raw) => {
      try {
        if (JSON.parse(raw.toString()).t === 'room') res();
      } catch {
        /* */
      }
    });
    ws.send(JSON.stringify({ t: 'join', code, displayName: 'HostUser', guestId: rid() }));
  });
  return ws;
}

test('watch-party guest: source picker is disabled with a host-only tooltip', async ({ page, webmUrl }) => {
  const code = await createRoom();
  const host = await wsHostJoin(code); // host joins first → the page is a GUEST
  try {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('bliss:watchParty:guestName', 'GuestUser'));
    await page.goto(
      `/player?${new URLSearchParams({ type: 'movie', id: 'tt1254207', url: webmUrl, rdsel: '1', room: code, title: 'Guest' })}`,
    );
    await expect(page.getByTestId('player-video')).toBeVisible({ timeout: 20_000 });

    // The guest-locked source control renders disabled (not absent).
    const sourceBtn = page.getByRole('button', { name: 'Change source (host only)' });
    await expect(sourceBtn).toBeDisabled({ timeout: 15_000 });
  } finally {
    try {
      host.close();
    } catch {
      /* */
    }
  }
});
