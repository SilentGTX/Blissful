// What happens when a desktop HOST that is SHARING its stream changes the episode?
//
// This drives the REAL flow end-to-end against the dev UI (so the uncommitted
// consent + relay-teardown fixes are exercised):
//
//   1. vite (dev UI) on :5173  +  the real Rust shell pointed at it (BLISSFUL_UI_URL)
//   2. create a room (prod storage); desktop joins FIRST → becomes host
//   3. a fake WS guest joins and sends `party:request-host-stream`
//   4. the desktop shows the Share/Decline consent prompt → we click "Share"
//      → shareHostStream() → startPartyRelay() + announceSource(relay)  (relayActiveRef = true)
//   5. capture the announced public relay URL; confirm it is LIVE (200 master)
//   6. the host CHANGES EPISODE (SPA nav videoId EP1→EP2; full-reload fallback)
//   7. ASSERT the relay tunnel is TORN DOWN — the public relay URL goes 404
//      (NativeMpvPlayer's [videoId,url] cleanup → stopPartyRelay). A leak = it
//      stays 200 (a guest could keep pulling the old episode).
//
// Usage:  node scripts/e2e/episode-change-share.mjs
// Env:    STORAGE_HTTP, STORAGE_WS, VITE_PORT, CDP_PORT, TEST_WEBM, IMDB_ID

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.join(ROOT, '.tmp-e2e');
fs.mkdirSync(TMP, { recursive: true });

const CFG = {
  storageHttp: process.env.STORAGE_HTTP || 'https://blissful.budinoff.com/storage',
  storageWs: process.env.STORAGE_WS || 'wss://blissful.budinoff.com/storage/ws/room',
  vitePort: Number(process.env.VITE_PORT || 5173),
  cdpPort: Number(process.env.CDP_PORT || 9222),
  webm: process.env.TEST_WEBM || 'https://media.w3.org/2010/05/sintel/trailer.webm',
  imdb: process.env.IMDB_ID || 'tt9813792',
  ep1: process.env.EP1 || 'tt9813792:1:1',
  ep2: process.env.EP2 || 'tt9813792:1:2',
  cdpTimeoutMs: Number(process.env.CDP_TIMEOUT_MS || 360_000),
};

const log = (...a) => console.log('[epchg]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let vite = null;
let shell = null;
let shellExit = null;

function httpGet(url, t = 2500) {
  return new Promise((res) => {
    const req = http.get(url, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ status: r.statusCode, body: b })); });
    req.on('error', () => res(null));
    req.setTimeout(t, () => { req.destroy(); res(null); });
  });
}
async function waitFor(label, fn, timeoutMs, iv = 1000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (shellExit) throw new Error(`shell exited before ${label} (code ${shellExit.code})`);
    if (await fn().catch(() => false)) return true;
    await sleep(iv);
  }
  throw new Error('timeout: ' + label);
}
function killTree(c) {
  if (!c || c.exitCode != null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { c.kill('SIGKILL'); } catch { /* */ }
}
// Probe the public relay URL: returns 'live' (200 + playlist), 'gone' (404), or 'other'.
async function relayState(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r) return 'unreachable';
  if (r.status === 404) return 'gone';
  if (r.status === 200) { const b = await r.text().catch(() => ''); return /#EXTM3U/.test(b) ? 'live' : 'other'; }
  return 'other(' + r.status + ')';
}

// ---- minimal WS guest -----------------------------------------------------
async function wsGuest(WebSocket, displayName) {
  const ws = new WebSocket(CFG.storageWs);
  const msgs = [];
  ws.on('message', (raw) => { try { msgs.push(JSON.parse(raw.toString())); } catch { /* */ } });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const send = (o) => ws.send(JSON.stringify(o));
  const waitFor = (pred, ms = 8000) => new Promise((res, rej) => {
    const hit = msgs.find(pred); if (hit) return res(hit);
    const t = setInterval(() => { const h = msgs.find(pred); if (h) { clearInterval(t); res(h); } }, 150);
    setTimeout(() => { clearInterval(t); rej(new Error('guest timeout')); }, ms);
  });
  return { ws, msgs, send, waitFor, close: () => { try { ws.close(); } catch { /* */ } } };
}

async function createRoom() {
  const res = await fetch(`${CFG.storageHttp}/watch-party`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'series', imdbId: CFG.imdb, videoId: CFG.ep1, password: null, guestId: 'e2e-creator-' + Math.random().toString(36).slice(2, 8) }),
  });
  if (!res.ok) throw new Error('create room HTTP ' + res.status);
  const { code } = await res.json();
  if (!code) throw new Error('create room: no code');
  return code;
}

async function main() {
  let chromium, WebSocket;
  try { ({ chromium } = await import('playwright')); ({ default: WebSocket } = await import('ws')); }
  catch { console.error('[epchg] need playwright + ws installed'); process.exit(3); }

  const out = { steps: {}, relay: {}, verdict: 'FAIL', notes: [] };
  let cdp = null; let guest = null;
  const shellOut = path.join(TMP, 'epchg-shell.out');
  try {
    // 1) vite (dev UI with the uncommitted fixes) — reuse if one is already running
    const viteAlready = await httpGet(`http://localhost:${CFG.vitePort}/`);
    if (viteAlready && viteAlready.status === 200) {
      out.steps.viteUp = true; out.steps.viteReused = true; log('reusing existing vite on :' + CFG.vitePort);
    } else {
      log('starting vite dev UI on :' + CFG.vitePort);
      const viteOut = fs.openSync(path.join(TMP, 'epchg-vite.out'), 'w');
      vite = spawn('npm', ['--prefix', 'apps/web-blissful', 'run', 'dev', '--', '--port', String(CFG.vitePort)], {
        cwd: ROOT, env: { ...process.env, VITE_DEV_PORT: String(CFG.vitePort) }, shell: process.platform === 'win32', stdio: ['ignore', viteOut, viteOut],
      });
      await waitFor('vite up', async () => { const r = await httpGet(`http://localhost:${CFG.vitePort}/`); return r && r.status === 200; }, 90_000);
      out.steps.viteUp = true; log('vite up');
    }

    // 2) the real shell pointed at the dev UI
    log('launching shell -> dev UI (first build can take minutes)');
    const fd = fs.openSync(shellOut, 'w');
    shell = spawn(process.execPath, ['scripts/run-cargo.cjs', 'run', '--manifest-path', 'apps/desktop-blissful/Cargo.toml', '--features', 'spike0a'], {
      cwd: ROOT, env: { ...process.env, BLISSFUL_REMOTE_DEBUG_PORT: String(CFG.cdpPort), BLISSFUL_UI_URL: `http://localhost:${CFG.vitePort}`, RUST_LOG: 'info' }, shell: false, stdio: ['ignore', fd, fd],
    });
    shell.on('exit', (code, signal) => { shellExit = { code, signal }; });

    await waitFor('CDP', async () => { const r = await httpGet(`http://127.0.0.1:${CFG.cdpPort}/json/version`); return r && r.status === 200 && r.body.includes('webSocketDebuggerUrl'); }, CFG.cdpTimeoutMs);
    cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CFG.cdpPort}`);
    const ctx = cdp.contexts()[0];
    const page = ctx.pages()[0] || (await ctx.waitForEvent('page', { timeout: 15000 }));
    await page.waitForFunction(() => !!(window.blissfulDesktop && window.blissfulDesktop.call), { timeout: 30_000 });
    out.steps.bridgeReady = true; log('bridge ready');

    // 3) seed guest identity so the desktop opens its watch-party WS as host
    await page.evaluate(() => {
      localStorage.setItem('bliss:watchParty:guestName', 'DeskHost');
      localStorage.setItem('bliss:watchParty:guestId', 'e2e-deskhost');
    });

    // 4) create the room (prod storage) and navigate the desktop into it as host
    const code = await createRoom();
    out.steps.room = code; log('room ' + code + ' created; desktop joining as host');
    const q1 = new URLSearchParams({ type: 'series', id: CFG.imdb, videoId: CFG.ep1, url: CFG.webm, room: code, rdsel: '1', title: 'EpA' });
    await page.goto(`http://localhost:${CFG.vitePort}/player?${q1}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(7000); // let the desktop's WS connect FIRST (so it is the host)
    if (shellExit) throw new Error('shell died after navigating to the player');

    // 5) fake guest joins second; confirm a host (the desktop) is present
    guest = await wsGuest(WebSocket, 'PacoGuest');
    guest.send({ t: 'join', code, displayName: 'PacoGuest', guestId: 'e2e-guest-' + Math.random().toString(36).slice(2, 8) });
    const room = await guest.waitFor((m) => m.t === 'room', 10_000);
    const guestId = room.self?.userId;
    const hostPresent = (room.participants || []).some((p) => p.isHost && p.userId !== guestId);
    out.steps.hostPresent = hostPresent;
    if (!hostPresent) throw new Error('desktop did not become host; participants=' + JSON.stringify(room.participants));
    log('guest in; host present = ' + hostPresent);

    // 6) guest asks the host to share → the desktop consent prompt appears → click Share
    guest.send({ t: 'party:request-host-stream' });
    log('sent party:request-host-stream; waiting for the consent prompt');
    await page.locator('[data-testid="wp-consent-share"]').waitFor({ state: 'visible', timeout: 20_000 });
    out.steps.consentPromptShown = true; log('consent prompt shown ✓ (this is the accept/decline UI)');
    await page.locator('[data-testid="wp-consent-share"]').click();

    // 7) the host announces a relay source — capture the public relay URL
    const srcMsg = await guest.waitFor((m) => m.t === 'source' && m.source && m.source.kind === 'relay', 30_000);
    const relayUrl = srcMsg.source.url;
    out.relay.url = relayUrl; out.steps.relayAnnounced = true; log('relay source announced: ' + relayUrl);

    // confirm the tunnel is actually LIVE before we change episode
    let live = 'pending';
    for (let i = 0; i < 8 && live !== 'live'; i++) { live = await relayState(relayUrl); if (live !== 'live') await sleep(2000); }
    out.relay.beforeChange = live; log('relay state before episode change: ' + live);
    if (live !== 'live') out.notes.push('relay never went live before the change (state=' + live + ') — teardown check is weaker');

    // 8) HOST CHANGES EPISODE — SPA nav videoId EP1 -> EP2 (the real in-app path)
    await page.evaluate(() => { window.__epchgMarker = 'spa'; });
    const q2 = new URLSearchParams({ type: 'series', id: CFG.imdb, videoId: CFG.ep2, url: CFG.webm, room: code, rdsel: '1', title: 'EpB' });
    const spaUrl = `/player?${q2}`;
    await page.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate')); }, spaUrl);
    await sleep(1500);
    const afterSpa = await page.evaluate(() => ({ marker: window.__epchgMarker, href: location.href }));
    out.steps.spaNav = { keptMarker: afterSpa.marker === 'spa', href: afterSpa.href, switchedVideoId: afterSpa.href.includes(encodeURIComponent(CFG.ep2)) || afterSpa.href.includes(CFG.ep2) };
    log('after SPA nav: ' + JSON.stringify(out.steps.spaNav));

    // 9) ASSERT the relay tore down (404) within ~15s
    let afterState = 'pending';
    for (let i = 0; i < 10; i++) { afterState = await relayState(relayUrl); if (afterState === 'gone') break; await sleep(1500); }
    out.relay.afterSpaChange = afterState;

    // Fallback: if the SPA nav didn't trip the teardown, force a full reload (unmount → cleanup)
    if (afterState !== 'gone') {
      out.notes.push('SPA nav did not tear down the relay (state=' + afterState + '); trying a full reload to EP2');
      await page.goto(`http://localhost:${CFG.vitePort}/player?${q2}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      let rel = 'pending';
      for (let i = 0; i < 10; i++) { rel = await relayState(relayUrl); if (rel === 'gone') break; await sleep(1500); }
      out.relay.afterReload = rel;
    }

    // 10) what did the guest see? (host:episode should clear the relay source)
    const sawClear = guest.msgs.some((m) => (m.t === 'source' && (!m.source || m.source.kind !== 'relay')) || m.t === 'episode');
    out.steps.guestSawSourceClearedOrEpisode = sawClear;

    const toreDown = out.relay.afterSpaChange === 'gone' || out.relay.afterReload === 'gone';
    if (toreDown) out.verdict = 'PASS';
    out.relay.toreDownVia = out.relay.afterSpaChange === 'gone' ? 'spa-episode-change' : (out.relay.afterReload === 'gone' ? 'full-reload' : 'NOT torn down');
  } catch (err) {
    out.notes.push('FATAL: ' + (err && err.message ? err.message : String(err)));
  } finally {
    out.shellTail = (() => { try { return fs.readFileSync(shellOut, 'utf8').split(/\r?\n/).filter((l) => /relay|panic|process failed|stopPartyRelay/i.test(l)).slice(-8).join('\n'); } catch { return ''; } })();
    out.shellAlive = !shellExit;
    console.log('\n============ EPISODE-CHANGE-WHILE-SHARING ============');
    console.log(JSON.stringify(out, null, 2));
    console.log('VERDICT: ' + (out.verdict === 'PASS'
      ? `PASS — relay tunnel torn down on episode change (via ${out.relay.toreDownVia})`
      : 'FAIL — see notes'));
    console.log('=====================================================');
    try { if (guest) guest.close(); } catch { /* */ }
    void cdp; // don't close (can disturb the WebView)
    killTree(shell); killTree(vite);
    setTimeout(() => process.exit(out.verdict === 'PASS' ? 0 : 1), 1500);
  }
}
process.on('SIGINT', () => { killTree(shell); killTree(vite); process.exit(130); });
main();
