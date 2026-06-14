// Real Layer B host-relay test — the "desktop shares its stream" mechanism.
//
// The v2 suite tested the relay with a FAKE host. This drives the ACTUAL desktop
// shell: it launches the real Rust shell, calls its `startPartyRelay` IPC over CDP
// (the exact thing the "Ask for host's stream" button triggers after consent),
// and verifies the real `host_relay.rs` OUTBOUND TUNNEL serves the local
// stremio-service `/hlsv2` through the LIVE Mac `/party-relay` — end to end.
//
// Flow: shell → startPartyRelay(room, hlsPath) → host_relay opens wss tunnel to
//       the Mac + ensures stremio-service → returns the public relay URL.
//       We GET that URL: the Mac pulls through the shell's tunnel → the shell
//       fetches its local stremio-service → a real, key-rewritten HLS master
//       playlist comes back. Then stopPartyRelay.
//
// Usage:  node scripts/e2e/host-relay.mjs [--attach]   (--attach: use a shell
//         already running with BLISSFUL_REMOTE_DEBUG_PORT, don't build/launch)

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const CFG = {
  cdpPort: Number(process.env.CDP_PORT || 9222),
  uiUrl: process.env.SHELL_UI_URL || 'https://blissful.budinoff.com',
  media: process.env.TEST_STREAM_URL || 'https://media.w3.org/2010/05/sintel/trailer.webm',
  cdpTimeoutMs: Number(process.env.CDP_TIMEOUT_MS || 360_000),
  attach: process.argv.includes('--attach') || process.env.ATTACH === '1',
};

const log = (...a) => console.log('[host-relay]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shell = null;

function httpGet(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(null);
    });
  });
}
async function waitFor(label, fn, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn().catch(() => false)) return true;
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}`);
}
function killTree(child) {
  if (!child) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { child.kill('SIGKILL'); } catch { /* ignore */ }
}

async function main() {
  const result = { steps: {}, verdict: 'FAIL', notes: [] };
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('[host-relay] playwright not installed — run: npm install && npx playwright install chromium');
    process.exit(3);
  }

  let cdp = null;
  try {
    if (!CFG.attach) {
      log('launching shell with remote-debug port (first build can take a few min)…');
      shell = spawn(
        process.execPath,
        ['scripts/run-cargo.cjs', 'run', '--manifest-path', 'apps/desktop-blissful/Cargo.toml', '--features', 'spike0a'],
        {
          cwd: ROOT,
          env: { ...process.env, BLISSFUL_REMOTE_DEBUG_PORT: String(CFG.cdpPort), BLISSFUL_UI_URL: CFG.uiUrl, RUST_LOG: process.env.RUST_LOG || 'info' },
          shell: false,
          stdio: 'inherit',
        },
      );
      shell.on('exit', (c) => log(`shell exited (code=${c})`));
    } else {
      log(`attach: using shell already on CDP :${CFG.cdpPort}`);
    }

    await waitFor(
      `WebView2 CDP :${CFG.cdpPort}`,
      async () => {
        const r = await httpGet(`http://127.0.0.1:${CFG.cdpPort}/json/version`);
        return r && r.status === 200 && r.body.includes('webSocketDebuggerUrl');
      },
      CFG.attach ? 20_000 : CFG.cdpTimeoutMs,
    );
    result.steps.cdpUp = true;
    log('CDP up — connecting');

    cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CFG.cdpPort}`);
    const ctx = cdp.contexts()[0];
    if (!ctx) throw new Error('no CDP context');
    const page = ctx.pages()[0] || (await ctx.waitForEvent('page', { timeout: 15000 }));

    // Wait for the blissfulDesktop IPC bridge to be live on the page.
    await page.waitForFunction(() => !!(window.blissfulDesktop && typeof window.blissfulDesktop.call === 'function'), { timeout: 30_000 });
    result.steps.bridgeReady = true;
    log('blissfulDesktop bridge ready');

    const room = 'e2e-relay-' + Math.random().toString(36).slice(2, 8);
    const hlsPath = `hlsv2/blissful-party/master.m3u8?mediaURL=${encodeURIComponent(CFG.media)}&maxWidth=3840`;

    // Call the REAL startPartyRelay IPC (host_relay.rs).
    const ipc = await page.evaluate(
      async ({ room, hlsPath }) => {
        try {
          const r = await window.blissfulDesktop.call('startPartyRelay', { room, hlsPath });
          return { ok: true, r };
        } catch (e) {
          return { ok: false, err: String(e && e.message ? e.message : e) };
        }
      },
      { room, hlsPath },
    );
    log('startPartyRelay →', JSON.stringify(ipc));
    if (!ipc.ok) throw new Error('startPartyRelay IPC rejected: ' + ipc.err);
    const relayUrl = ipc.r?.relayUrl ?? ipc.r?.result?.relayUrl ?? (typeof ipc.r === 'string' ? ipc.r : null);
    if (!relayUrl) throw new Error('no relayUrl in IPC result: ' + JSON.stringify(ipc.r));
    result.steps.startedRelay = relayUrl;
    log('relay URL:', relayUrl);

    // Give the outbound tunnel a moment to connect (status connecting→ready).
    await sleep(3500);

    // GET the relay URL — the Mac pulls through the shell's real tunnel to the
    // local stremio-service and returns a real, key-rewritten HLS master playlist.
    let ok = false;
    let lastBody = '';
    for (let i = 0; i < 6 && !ok; i++) {
      const res = await fetch(relayUrl, { signal: AbortSignal.timeout(20000) }).catch((e) => ({ status: 0, _err: e.message }));
      const body = res.status === 200 ? await res.text() : '';
      lastBody = body || res._err || `status ${res.status}`;
      if (res.status === 200 && /^#EXTM3U/.test(body.trim()) && /k=/.test(body)) ok = true;
      else await sleep(2000);
    }
    if (!ok) throw new Error('relay did not serve a valid HLS master playlist: ' + lastBody.slice(0, 160));
    result.steps.servedRealHls = true;
    log('REAL relay served a valid, key-rewritten HLS master playlist ✓');

    await page.evaluate(() => window.blissfulDesktop.call('stopPartyRelay').catch(() => {}));
    result.steps.stopped = true;
    result.verdict = 'PASS';
  } catch (err) {
    result.notes.push('FATAL: ' + (err && err.message ? err.message : String(err)));
  } finally {
    console.log('\n================ HOST-RELAY (real shell) ================');
    console.log(JSON.stringify(result, null, 2));
    console.log(`VERDICT: ${result.verdict}`);
    try { if (cdp) await cdp.close(); } catch { /* ignore */ }
    if (!CFG.attach) killTree(shell);
    setTimeout(() => process.exit(result.verdict === 'PASS' ? 0 : 1), 1200);
  }
}

main();
