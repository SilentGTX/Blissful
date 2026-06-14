// Blissful watch-party end-to-end tester.
//
// Spins up the dev stack and drives TWO real clients through a watch party to
// confirm the cross-platform sync pipe actually works end to end:
//
//   web client (host)    -> Playwright-launched Chromium on the Vite dev server
//   desktop client (guest) -> the Rust WebView2 shell, driven over CDP
//
// The web client hosts because creating a room there needs no login (canCreate
// = id+type); the desktop client guests because joining only needs a guestId.
// Both load the SAME direct sample URL, so they are watching the same file by
// construction — no torrent/RD resolution to flake on. The host broadcasts
// position ticks; we assert the guest receives them (cross-platform sync).
//
// Verification is layered so a flaky sample stream still yields signal:
//   C1 stack up        — Vite 200 + (desktop) CDP reachable
//   C2 host created    — got a room code
//   C3 guest joined    — guest WS saw the room snapshot
//   C4 cross presence  — host WS saw the guest join (2 participants)
//   C5 sync (bonus)    — guest WS received host ticks (needs host playback)
//   C6 host playing    — host <video> advanced (best-effort)
// Verdict: PASS if C1-C4, PARTIAL if C1-C4 but not C5/C6, FAIL otherwise.
//
// Usage:  node scripts/e2e/watchparty.mjs [--mode desktop|web] [--keep-open]
// Env:    BLISSFUL_E2E_MODE, TEST_STREAM_URL, TEST_IMDB_ID, TEST_TYPE,
//         VITE_PORT, CDP_PORT, HEADLESS, READY_TIMEOUT_MS, CDP_TIMEOUT_MS,
//         KEEP_OPEN, RUST_LOG

import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ---------- config ---------------------------------------------------------

const argv = process.argv.slice(2);
const argMode = (() => {
  const i = argv.indexOf('--mode');
  return i >= 0 ? argv[i + 1] : null;
})();

const CFG = {
  mode: (argMode || process.env.BLISSFUL_E2E_MODE || 'desktop').toLowerCase(), // desktop | web
  // Default: a LOCAL http media server (started in main) serving a WebM clip.
  // Two reasons it must be WebM-over-http:
  //  - WebM/VP8: Playwright's bundled Chromium ships NO proprietary codecs, so an
  //    H.264 .mp4 fails with MEDIA_ELEMENT_ERROR (mpv on the desktop is fine).
  //  - http (not https): the player's DMCA auto-fallback probes (duration<5min,
  //    size<20MB) ONLY run for https URLs; on a hit they bail to /detail and tear
  //    down the party WS. http sidesteps both, so a short small clip stays stable.
  // Override with TEST_STREAM_URL (an https clip works too if >5min AND >20MB).
  streamUrl: process.env.TEST_STREAM_URL || null,
  mediaSource: process.env.MEDIA_SOURCE_URL || 'https://media.w3.org/2010/05/sintel/trailer.webm',
  imdbId: process.env.TEST_IMDB_ID || 'tt1254207', // Big Buck Bunny
  type: process.env.TEST_TYPE || 'movie',
  vitePort: Number(process.env.VITE_PORT || 5173),
  cdpPort: Number(process.env.CDP_PORT || 9222),
  headless: process.env.HEADLESS !== '0',
  readyTimeoutMs: Number(process.env.READY_TIMEOUT_MS || 120_000),
  cdpTimeoutMs: Number(process.env.CDP_TIMEOUT_MS || 360_000), // first cargo build is slow
  keepOpen: argv.includes('--keep-open') || process.env.KEEP_OPEN === '1',
  // Attach mode (desktop): DON'T launch vite or build/launch the shell — connect
  // to an already-running dev stack + a shell started with BLISSFUL_REMOTE_DEBUG_PORT
  // (and BLISSFUL_UI_URL=<WEB_ORIGIN> so its origin matches). Lets you test without
  // closing a running desktop / rebuilding the locked binary.
  attach: argv.includes('--attach') || process.env.ATTACH === '1',
};
const WEB_ORIGIN = `http://localhost:${CFG.vitePort}`;
const SHOT_DIR = path.join(ROOT, '.tmp-e2e');

const procs = []; // { name, child }
const log = (...a) => console.log('[e2e]', ...a);
const warn = (...a) => console.warn('[e2e]', ...a);

// ---------- small helpers --------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
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
  let last = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}${last ? ` (${last.message})` : ''}`);
}

function spawnProc(name, cmd, args, env, opts = {}) {
  log(`launch ${name}: ${cmd} ${args.join(' ')}`);
  // shell:true is needed for npm (npm.cmd) on Windows, but it MANGLES a command
  // whose path has spaces (e.g. process.execPath = "C:\Program Files\...\node.exe"
  // → cmd reads "C:\Program" as the command). Callers spawning a direct exe pass
  // shell:false.
  const useShell = opts.shell !== undefined ? opts.shell : process.platform === 'win32';
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    shell: useShell,
    stdio: 'inherit',
  });
  child.on('exit', (code, sig) => log(`${name} exited (code=${code} sig=${sig})`));
  procs.push({ name, child });
  return child;
}

function killTree(child) {
  if (!child || child.killed || child.exitCode != null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* best-effort */
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* best-effort */
      }
    }
  }
}

let mediaServer = null;

function teardown() {
  for (const { name, child } of procs) {
    log(`stopping ${name}`);
    killTree(child);
  }
  if (mediaServer) {
    try {
      mediaServer.close();
    } catch {
      /* best-effort */
    }
  }
}

// Download (once, redirect-following) the test clip to a local cache file.
function downloadTo(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(downloadTo(new URL(res.headers.location, url).toString(), dest, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('download status ' + res.statusCode));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('download timeout')));
  });
}

// Serve the cached WebM over http://127.0.0.1 with Range + CORS so the player's
// https-only DMCA bail checks never fire. Returns the playable URL.
async function startMediaServer() {
  const file = path.join(SHOT_DIR, 'clip.webm');
  if (!fs.existsSync(file) || fs.statSync(file).size < 100_000) {
    log(`media: caching test clip from ${CFG.mediaSource}`);
    await downloadTo(CFG.mediaSource, file);
  }
  const size = fs.statSync(file).size;
  mediaServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/webm');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': size });
      fs.createReadStream(file).pipe(res);
    }
  });
  await new Promise((r) => mediaServer.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${mediaServer.address().port}/clip.webm`;
}

function tailShellLog(lines = 40) {
  const p = path.join(process.env.APPDATA || '', 'Blissful', 'shell.log');
  try {
    const txt = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    return { path: p, tail: txt.slice(-lines).join('\n') };
  } catch {
    return { path: p, tail: null };
  }
}

// The WS sniffer — installed before app scripts run. Wraps window.WebSocket so
// we can see the watch-party protocol frames each client sends/receives without
// reaching into app internals.
const SNIFFER = `(() => {
  if (window.__wpSniffInstalled) return;
  window.__wpSniffInstalled = true;
  window.__wpSniff = { types: {}, maxParticipants: 0, url: null, firstTickAt: 0, sawRoom: false, sawPresence: false, recent: [], sentJoin: null, closes: [], opens: 0, lastEvent: null, lastGate: null, lastTick: null };
  const Native = window.WebSocket;
  const S = window.__wpSniff;
  const ids = (parts) => Array.isArray(parts) ? parts.map((p) => (p && (p.userId || p.id || p.displayName)) || '?') : undefined;
  function record(dir, data) {
    let msg; try { msg = JSON.parse(typeof data === 'string' ? data : ''); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (dir === 'send') {
      if (msg.t === 'join') S.sentJoin = { code: msg.code, guestId: msg.guestId, displayName: msg.displayName, hasToken: !!msg.token };
      return;
    }
    S.types[msg.t] = (S.types[msg.t] || 0) + 1;
    if (msg.t === 'room') S.sawRoom = true;
    if (msg.t === 'presence') S.sawPresence = true;
    if (msg.t === 'tick') { if (!S.firstTickAt) S.firstTickAt = Date.now(); S.lastTick = { currentTime: msg.currentTime, isPlaying: msg.isPlaying, at: Date.now() }; }
    if (msg.t === 'event') S.lastEvent = { kind: msg.kind, currentTime: msg.currentTime, at: Date.now() };
    if (msg.t === 'gate') S.lastGate = { waiting: msg.waiting, at: Date.now() };
    const parts = msg.participants || (msg.room && msg.room.participants);
    if (Array.isArray(parts)) S.maxParticipants = Math.max(S.maxParticipants, parts.length);
    if (typeof msg.participantCount === 'number') S.maxParticipants = Math.max(S.maxParticipants, msg.participantCount);
    const sum = { t: msg.t };
    if (typeof msg.participantCount === 'number') sum.pc = msg.participantCount;
    const pid = ids(parts);
    if (pid) sum.parts = pid;
    if (msg.selfUserId || msg.selfId || msg.youId) sum.self = msg.selfUserId || msg.selfId || msg.youId;
    S.recent.push(sum);
    if (S.recent.length > 16) S.recent.shift();
  }
  class Wrapped extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      try {
        if (String(url).includes('/ws/room')) {
          S.url = String(url);
          S.sock = this;
          this.addEventListener('open', () => { S.opens++; });
          this.addEventListener('close', (e) => { S.closes.push({ code: e.code, reason: String(e.reason || '').slice(0, 60), at: Date.now() }); });
          this.addEventListener('message', (e) => record('recv', e.data));
          const origSend = this.send.bind(this);
          this.send = (d) => { try { record('send', d); } catch {} return origSend(d); };
        }
      } catch {}
    }
  }
  window.WebSocket = Wrapped;
})();`;

// Per-context init: install the sniffer AND seed a stable guest identity. The
// player only connects the watch-party WS once a display name exists — without
// a login or a stored guest name it blocks on the in-player name prompt and
// never connects. Seeding both keys lets each client connect headlessly.
function initScript(displayName) {
  return (
    SNIFFER +
    `\n(() => { try {
      if (!localStorage.getItem('bliss:watchParty:guestId'))
        localStorage.setItem('bliss:watchParty:guestId', 'e2e' + Math.random().toString(36).slice(2, 16));
      localStorage.setItem('bliss:watchParty:guestName', ${JSON.stringify(displayName)});
    } catch {} })();`
  );
}

const playerUrl = (extra) => {
  const p = new URLSearchParams({
    type: CFG.type,
    id: CFG.imdbId,
    url: CFG.streamUrl,
    title: 'E2E Test',
    ...extra,
  });
  // NB: deliberately NO rdsel=1 — it would DEFEAT the addon-fallback skip-gate
  // (which requires !rdSelected) and bounce the player to /detail. With a plain
  // playable http url the gate returns early and the stream stays put.
  return `${WEB_ORIGIN}/player?${p.toString()}`;
};

// Click a control that lives in the auto-hiding player chrome. Jiggle the mouse
// each iteration to keep the controls visible, then fire a REAL click (not force)
// so it only lands once the element actually receives pointer events — a forced
// click on a faded `pointer-events:none` control silently no-ops. Returns true on
// a successful click.
async function clickControl(page, testid, timeoutMs = 12_000) {
  const loc = page.locator(`[data-testid="${testid}"]`).first();
  const deadline = Date.now() + timeoutMs;
  let i = 0;
  while (Date.now() < deadline) {
    await page.mouse.move(300 + (i % 6) * 80, 200 + (i % 4) * 60);
    i++;
    try {
      await loc.click({ timeout: 1200 });
      return true;
    } catch {
      await sleep(200);
    }
  }
  return false;
}

// ---------- client drivers -------------------------------------------------

// Host = web client. Plays the sample, then creates a room via the real drawer
// UI (falling back to a direct REST create if the chrome is uncooperative).
async function driveHost(page, result) {
  log('host: navigating to player');
  await page.goto(playerUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Best-effort: confirm media actually started (C6). Don't fail the run on it.
  try {
    await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && (v.currentTime > 0.05 || v.readyState >= 2);
      },
      { timeout: 25_000 },
    );
    result.checks.C6_hostPlaying = true;
    log('host: media is playing');
  } catch {
    warn('host: media did not visibly start (sync check may be PARTIAL)');
  }

  // Try the real UX: open the watch-party drawer via its entry button and hit
  // Create — exercises wp-open-drawer + wp-create-submit. clickControl handles the
  // auto-hiding chrome; once the drawer opens it's a modal overlay so the Create
  // button is stable.
  let code = null;
  let createdVia = null;
  try {
    if (await clickControl(page, 'wp-open-drawer', 12_000)) {
      await page.locator('[data-testid="wp-create-submit"]').first().click({ timeout: 6000 });
      code = await page
        .waitForFunction(() => new URLSearchParams(location.search).get('room'), { timeout: 15_000 })
        .then((h) => h.jsonValue())
        .catch(() => null);
      if (code) {
        createdVia = 'ui';
        log('host: created room via the drawer UI');
      }
    } else {
      warn('host: watch-party button never became clickable');
    }
  } catch (err) {
    warn('host: drawer UI path failed (' + err.message + ')');
  }

  if (!code) {
    warn('host: drawer create did not yield a code — falling back to REST create');
    createdVia = 'rest';
    code = await page.evaluate(
      async ({ imdbId, type }) => {
        const KEY = 'bliss:watchParty:guestId';
        let gid = localStorage.getItem(KEY);
        if (!gid || gid.length < 8) {
          gid = 'e2e' + Math.random().toString(36).slice(2, 16);
          localStorage.setItem(KEY, gid);
        }
        const res = await fetch('/storage/watch-party', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: type === 'series' ? 'series' : 'movie',
            imdbId,
            videoId: null,
            password: null,
            guestId: gid,
          }),
        });
        if (!res.ok) throw new Error('REST create ' + res.status);
        const { code } = await res.json();
        return code;
      },
      { imdbId: CFG.imdbId, type: CFG.type },
    );
    // Join the host into its own room (full nav re-installs the sniffer + seeds).
    await page.goto(playerUrl({ room: code }), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  if (!code) throw new Error('host failed to create a room');
  result.roomCode = code;
  result.createdVia = createdVia;
  result.checks.C2_hostCreated = true;
  log(`host: room created -> ${code} (via ${createdVia})`);

  // The host must be first into the WS room to BE the host. Confirm its own
  // socket connected before the guest joins.
  await waitFor(
    'host WS connected',
    async () => {
      const s = await readSniff(page);
      return s && s.sawRoom;
    },
    30_000,
  ).catch((err) => result.notes.push('host-connect: ' + err.message));

  return code;
}

// Guest = desktop client (or a second web context in --mode web). Joins the
// room directly by URL so we exercise the real WS join + presence + tick apply
// without depending on the flaky desktop torrent-pick routing.
async function driveGuest(page, code) {
  log('guest: joining room via player URL');
  await page.goto(playerUrl({ room: code }), { waitUntil: 'domcontentloaded', timeout: 60_000 });
}

// Capture console + navigations + page errors for post-mortem triage.
function attachDiag(page, who) {
  const logs = [];
  const push = (s) => {
    logs.push(s);
    if (logs.length > 80) logs.shift();
  };
  page.on('console', (m) => push(`${who} console.${m.type()}: ${m.text().slice(0, 220)}`));
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) push(`${who} NAV -> ${f.url().replace(WEB_ORIGIN, '')}`);
  });
  page.on('pageerror', (e) => push(`${who} pageerror: ${String(e).slice(0, 220)}`));
  return logs;
}

// Read the sniffer state off a page (drop the live socket; expose its state).
const readSniff = (page) =>
  page
    .evaluate(() => {
      const s = window.__wpSniff;
      if (!s) return null;
      const { sock, ...rest } = s;
      return { ...rest, readyState: sock ? sock.readyState : -1 };
    })
    .catch(() => null);

// ---------- main -----------------------------------------------------------

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const result = {
    mode: CFG.mode,
    roomCode: null,
    createdVia: null,
    checks: {
      C1_stackUp: false,
      C2_hostCreated: false,
      C3_guestJoined: false,
      C4_crossPresence: false,
      C5_syncTicks: false,
      C6_hostPlaying: false,
      C7_playbackSync: false,
    },
    verdict: 'FAIL',
    notes: [],
    artifacts: {},
  };

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(
      '\n[e2e] playwright is not installed. Run:\n' +
        '      npm install\n' +
        '      npx playwright install chromium\n',
    );
    process.exit(3);
  }

  let hostBrowser = null;
  let guestCdp = null;

  try {
    // --- 0. local media server (codec-friendly WebM over http) --------------
    if (!CFG.streamUrl) {
      CFG.streamUrl = await startMediaServer();
      log(`media: serving ${CFG.streamUrl}`);
    }

    // --- 1. launch (or attach to) the stack ---------------------------------
    if (CFG.attach) log(`attach mode: using the existing dev stack at ${WEB_ORIGIN} + CDP :${CFG.cdpPort}`);

    if (!CFG.attach) {
      spawnProc('vite', 'npm', ['run', '--prefix', 'apps/web-blissful', 'dev:vite'], {
        VITE_DEV_PORT: String(CFG.vitePort),
      });
    }
    await waitFor(
      'vite :' + CFG.vitePort,
      async () => {
        const r = await httpGet(`${WEB_ORIGIN}/`);
        return r && r.status === 200;
      },
      CFG.attach ? 15_000 : CFG.readyTimeoutMs,
    );
    log(CFG.attach ? 'vite (existing) is reachable' : 'vite is up');

    if (CFG.mode === 'desktop') {
      if (!CFG.attach) {
        spawnProc(
          'shell',
          process.execPath,
          [
            'scripts/run-cargo.cjs',
            'run',
            '--manifest-path',
            'apps/desktop-blissful/Cargo.toml',
            '--features',
            'spike0a',
          ],
          {
            BLISSFUL_REMOTE_DEBUG_PORT: String(CFG.cdpPort),
            BLISSFUL_UI_URL: WEB_ORIGIN, // load the same Vite UI as the web client
            RUST_LOG: process.env.RUST_LOG || 'info',
          },
          { shell: false }, // process.execPath has spaces — never via cmd.exe
        );
        log('shell launching (first compile can take a few minutes)…');
      }
      await waitFor(
        'WebView2 CDP :' + CFG.cdpPort,
        async () => {
          const r = await httpGet(`http://127.0.0.1:${CFG.cdpPort}/json/version`);
          return r && r.status === 200 && r.body.includes('webSocketDebuggerUrl');
        },
        CFG.attach ? 20_000 : CFG.cdpTimeoutMs,
      ).catch((err) => {
        if (CFG.attach) {
          throw new Error(
            `attach: no WebView2 CDP at :${CFG.cdpPort}. Start your desktop with ` +
              `BLISSFUL_REMOTE_DEBUG_PORT=${CFG.cdpPort} and BLISSFUL_UI_URL=${WEB_ORIGIN}. (${err.message})`,
          );
        }
        throw err;
      });
      log('desktop WebView2 CDP is up');
    }
    result.checks.C1_stackUp = true;

    // --- 2. connect Playwright ----------------------------------------------
    hostBrowser = await chromium.launch({
      headless: CFG.headless,
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    });
    const hostCtx = await hostBrowser.newContext();
    await hostCtx.addInitScript(initScript('E2E Host'));
    const hostPage = await hostCtx.newPage();
    const hostLogs = attachDiag(hostPage, 'host');

    let guestPage;
    if (CFG.mode === 'desktop') {
      guestCdp = await chromium.connectOverCDP(`http://127.0.0.1:${CFG.cdpPort}`);
      const ctx = guestCdp.contexts()[0];
      if (!ctx) throw new Error('no CDP context on the desktop shell');
      await ctx.addInitScript(initScript('E2E Guest'));
      // Pick the app page (the WebView), not any devtools target.
      guestPage =
        ctx.pages().find((p) => p.url().includes(`:${CFG.vitePort}`)) || ctx.pages()[0];
      if (!guestPage) guestPage = await ctx.newPage();
    } else {
      const guestCtx = await hostBrowser.newContext();
      await guestCtx.addInitScript(initScript('E2E Guest'));
      guestPage = await guestCtx.newPage();
    }

    const guestLogs = attachDiag(guestPage, 'guest');

    // --- 3. host creates, guest joins ---------------------------------------
    const code = await driveHost(hostPage, result);
    await driveGuest(guestPage, code);

    // --- 4. assert the cross-platform link ----------------------------------
    // Give both sockets time to handshake + exchange a few frames.
    await waitFor(
      'guest room snapshot',
      async () => {
        const s = await readSniff(guestPage);
        return s && s.sawRoom;
      },
      30_000,
    ).then(
      () => {
        result.checks.C3_guestJoined = true;
        log('guest: received room snapshot');
      },
      (err) => result.notes.push('C3: ' + err.message),
    );

    await waitFor(
      'cross-client presence (2 participants)',
      async () => {
        const [h, g] = await Promise.all([readSniff(hostPage), readSniff(guestPage)]);
        const parts = Math.max(h?.maxParticipants || 0, g?.maxParticipants || 0);
        return (h?.sawPresence || g?.maxParticipants >= 2 || parts >= 2) && parts >= 2;
      },
      30_000,
    ).then(
      () => {
        result.checks.C4_crossPresence = true;
        log('host: saw the guest join (2 participants)');
      },
      (err) => result.notes.push('C4: ' + err.message),
    );

    // C5 (bonus): the guest receives the host's position ticks. Only happens if
    // the host is actually playing — so this is PARTIAL-friendly.
    await waitFor(
      'guest receiving host ticks',
      async () => {
        const s = await readSniff(guestPage);
        return s && s.firstTickAt > 0;
      },
      15_000,
    ).then(
      () => {
        result.checks.C5_syncTicks = true;
        log('guest: receiving host ticks (cross-platform sync confirmed)');
      },
      () => result.notes.push('C5: no host ticks observed (host likely not playing)'),
    );

    // C7: playback CONTROL sync — drive the host's video to pause / seek / play
    // and confirm the guest follows. The host propagates state via host:tick
    // (currentTime + isPlaying), so we assert the guest's RECEIVED tick reflects
    // each change (works for the mpv desktop guest too) and, when the guest has a
    // real <video> (web mode), that its video state actually followed.
    try {
      const readVideo = (page) =>
        page
          .evaluate(() => {
            const v = document.querySelector('video');
            return v ? { has: true, paused: v.paused, t: v.currentTime } : { has: false };
          })
          .catch(() => ({ has: false }));
      const hostDo = (fn, arg) => hostPage.evaluate(fn, arg).catch(() => {});
      const guestTick = (pred) => async () => {
        const s = await readSniff(guestPage);
        return s && s.lastTick && pred(s.lastTick);
      };
      const detail = [];

      // PAUSE — host pauses → next host:tick reports isPlaying:false → guest pauses.
      await hostDo(() => { const v = document.querySelector('video'); if (v) v.pause(); });
      await waitFor('guest tick isPlaying:false', guestTick((t) => t.isPlaying === false), 9000);
      detail.push('pause:synced');
      const gp = await readVideo(guestPage);
      if (gp.has) {
        await sleep(800);
        const g = await readVideo(guestPage);
        if (!g.paused) throw new Error('guest <video> did not pause');
        detail.push('pause:video');
      }

      // SEEK — host jumps + plays → tick currentTime jumps → guest drift-corrects.
      const target = 30;
      await hostDo((t) => { const v = document.querySelector('video'); if (v) { v.currentTime = t; v.play().catch(() => {}); } }, target);
      await waitFor('guest tick near seek target', guestTick((t) => Math.abs(t.currentTime - target) <= 4), 10_000);
      detail.push('seek:synced');
      const gs = await readVideo(guestPage);
      if (gs.has) {
        await sleep(1300);
        const g = await readVideo(guestPage);
        if (Math.abs(g.t - target) > 6) throw new Error(`guest <video> did not seek (t=${g.t})`);
        detail.push('seek:video');
      }

      // PLAY — host plays → tick isPlaying:true → guest plays.
      await hostDo(() => { const v = document.querySelector('video'); if (v) v.play().catch(() => {}); });
      await waitFor('guest tick isPlaying:true', guestTick((t) => t.isPlaying === true), 9000);
      detail.push('play:synced');
      const gpl = await readVideo(guestPage);
      if (gpl.has) {
        await sleep(800);
        const g = await readVideo(guestPage);
        if (!g.paused) detail.push('play:video');
      }

      result.checks.C7_playbackSync = true;
      result.artifacts.syncDetail = detail;
      log('playback control sync OK: ' + detail.join(', '));
    } catch (err) {
      result.notes.push('C7: ' + err.message);
    }

    // --- 5. artifacts --------------------------------------------------------
    try {
      await hostPage.screenshot({ path: path.join(SHOT_DIR, 'host.png') });
      result.artifacts.hostShot = path.join(SHOT_DIR, 'host.png');
    } catch {
      /* best-effort */
    }
    try {
      await guestPage.screenshot({ path: path.join(SHOT_DIR, 'guest.png') });
      result.artifacts.guestShot = path.join(SHOT_DIR, 'guest.png');
    } catch {
      /* WebView2 screenshots over CDP can fail — best-effort */
    }
    result.artifacts.sniff = {
      host: await readSniff(hostPage),
      guest: await readSniff(guestPage),
    };
    result.artifacts.diag = { host: hostLogs.slice(-45), guest: guestLogs.slice(-45) };
  } catch (err) {
    result.notes.push('FATAL: ' + (err && err.message ? err.message : String(err)));
  } finally {
    // --- 6. verdict ----------------------------------------------------------
    const c = result.checks;
    const coreOk = c.C1_stackUp && c.C2_hostCreated && c.C3_guestJoined && c.C4_crossPresence;
    result.verdict = coreOk ? (c.C5_syncTicks ? 'PASS' : 'PARTIAL') : 'FAIL';
    if (CFG.mode === 'desktop' && !coreOk) {
      result.artifacts.shellLog = tailShellLog();
    }

    console.log('\n================ WATCH-PARTY E2E RESULT ================');
    console.log(JSON.stringify(result, null, 2));
    console.log('=======================================================');
    console.log(
      `VERDICT: ${result.verdict}  (mode=${CFG.mode}, room=${result.roomCode || '-'}, create=${result.createdVia || '-'})`,
    );

    if (!CFG.keepOpen) {
      try {
        if (guestCdp) await guestCdp.close();
      } catch {
        /* connectOverCDP close is best-effort */
      }
      try {
        if (hostBrowser) await hostBrowser.close();
      } catch {
        /* best-effort */
      }
      teardown();
    } else {
      log('--keep-open set: leaving the stack + browsers running. Ctrl-C to stop.');
    }

    const exit = result.verdict === 'PASS' ? 0 : result.verdict === 'PARTIAL' ? 2 : 1;
    // Give taskkill a beat to fan out before the process exits.
    setTimeout(() => process.exit(exit), CFG.keepOpen ? 0 : 1500);
  }
}

process.on('SIGINT', () => {
  teardown();
  process.exit(130);
});

main();
