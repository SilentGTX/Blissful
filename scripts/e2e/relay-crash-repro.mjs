// Reproduce the host-relay crash AUTOMATICALLY and capture the shell's fault.
//
// The crash: a desktop host playing a 4K HEVC stream, sharing it (Layer B relay),
// crashed. The host-relay e2e test missed it because it used a tiny low-res webm
// so the heavy "decode 4K HEVC in mpv + transcode 4K in stremio" path never ran.
//
// This drives the REAL path: launch the shell (debug port), play the actual 4K
// HEVC source in mpv, startPartyRelay (transcode it), and pull relay segments to
// sustain the transcode — while capturing the shell's stdout+stderr to a file so
// when it dies we get the panic / mpv / ffmpeg / exit-code, not a guess.
//
// Usage:  REPRO_STREAM_URL='<the 4K HEVC url>' node scripts/e2e/relay-crash-repro.mjs
// Env:    REPRO_STREAM_URL (required), REPRO_TYPE, REPRO_ID, SHELL_UI_URL,
//         CDP_PORT, PLAY_WARMUP_MS, REPRO_ROUNDS

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.join(ROOT, '.tmp-e2e');
fs.mkdirSync(TMP, { recursive: true });
const SHELL_OUT = path.join(TMP, 'shell-repro.out');

const CFG = {
  cdpPort: Number(process.env.CDP_PORT || 9222),
  uiUrl: process.env.SHELL_UI_URL || 'https://blissful.budinoff.com',
  stream: process.env.REPRO_STREAM_URL || '',
  type: process.env.REPRO_TYPE || 'series',
  id: process.env.REPRO_ID || 'tt9813792',
  cdpTimeoutMs: Number(process.env.CDP_TIMEOUT_MS || 360_000),
  playWarmupMs: Number(process.env.PLAY_WARMUP_MS || 15_000),
  rounds: Number(process.env.REPRO_ROUNDS || 120), // ~1.5s each → a few minutes
};

const log = (...a) => console.log('[repro]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shell = null;
let shellExit = null;

function httpGet(url, t = 2000) {
  return new Promise((res) => {
    const req = http.get(url, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => res({ status: r.statusCode, body: b }));
    });
    req.on('error', () => res(null));
    req.setTimeout(t, () => { req.destroy(); res(null); });
  });
}
async function waitFor(label, fn, timeoutMs, iv = 1000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (shellExit) throw new Error(`shell exited before ${label}`);
    if (await fn().catch(() => false)) return true;
    await sleep(iv);
  }
  throw new Error('timeout waiting for ' + label);
}
function killTree(c) {
  if (!c || c.exitCode != null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { c.kill('SIGKILL'); } catch { /* */ }
}
const dumpShellTail = (n = 60) => {
  try {
    return fs.readFileSync(SHELL_OUT, 'utf8').split(/\r?\n/).slice(-n).join('\n');
  } catch {
    return '(no shell output captured)';
  }
};

// Pull the relay playlist tree + newest segments to keep stremio transcoding.
async function driveRound(masterUrl) {
  let pulled = 0;
  const r = await fetch(masterUrl, { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r || r.status !== 200) return { pulled, status: r ? r.status : 0 };
  const master = await r.text();
  pulled++;
  const subUris = master.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const uri of subUris) {
    const abs = new URL(uri, masterUrl).toString();
    if (/\.m3u8/i.test(uri)) {
      const sr = await fetch(abs, { signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (!sr || sr.status !== 200) continue;
      const media = await sr.text();
      pulled++;
      const segs = media.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      for (const seg of segs.slice(-4)) {
        const sres = await fetch(new URL(seg, abs).toString(), { signal: AbortSignal.timeout(20000) }).catch(() => null);
        if (sres) { await sres.arrayBuffer().catch(() => {}); pulled++; }
      }
    }
  }
  return { pulled, status: 200 };
}

async function main() {
  if (!CFG.stream) {
    console.error('[repro] set REPRO_STREAM_URL to the 4K HEVC stream URL.');
    process.exit(3);
  }
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('[repro] playwright missing — npm install && npx playwright install chromium');
    process.exit(3);
  }

  const result = { crashed: false, exit: null, where: 'startup', shellTail: '' };
  let cdp = null;
  try {
    log('launching shell (debug port; output -> ' + SHELL_OUT + ')');
    const fd = fs.openSync(SHELL_OUT, 'w');
    shell = spawn(
      process.execPath,
      ['scripts/run-cargo.cjs', 'run', '--manifest-path', 'apps/desktop-blissful/Cargo.toml', '--features', 'spike0a'],
      {
        cwd: ROOT,
        env: { ...process.env, BLISSFUL_REMOTE_DEBUG_PORT: String(CFG.cdpPort), BLISSFUL_UI_URL: CFG.uiUrl, RUST_LOG: process.env.RUST_LOG || 'info' },
        shell: false,
        stdio: ['ignore', fd, fd],
      },
    );
    shell.on('exit', (code, signal) => { shellExit = { code, signal, at: Date.now() }; });

    await waitFor('CDP', async () => {
      const r = await httpGet(`http://127.0.0.1:${CFG.cdpPort}/json/version`);
      return r && r.status === 200 && r.body.includes('webSocketDebuggerUrl');
    }, CFG.cdpTimeoutMs);
    log('CDP up');

    cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CFG.cdpPort}`);
    const ctx = cdp.contexts()[0];
    const page = ctx.pages()[0] || (await ctx.waitForEvent('page', { timeout: 15000 }));
    await page.waitForFunction(() => !!(window.blissfulDesktop && window.blissfulDesktop.call), { timeout: 30_000 });

    // 1) Play the real 4K HEVC in mpv (the host's own decode load).
    result.where = 'playing 4K HEVC in mpv';
    const p = new URLSearchParams({ type: CFG.type, id: CFG.id, url: CFG.stream, rdsel: '1', title: 'Crash Repro' });
    const playerUrl = `${CFG.uiUrl}/player?${p.toString()}`;
    log('navigating desktop to play the 4K HEVC');
    await page.goto(playerUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    log(`warming up mpv playback for ${CFG.playWarmupMs}ms`);
    await sleep(CFG.playWarmupMs);
    if (shellExit) throw new Error('shell died during mpv playback (before relay)');

    // 2) Start the relay (transcode the same 4K HEVC) — the concurrent encode load.
    result.where = 'startPartyRelay';
    const room = 'repro-' + Math.random().toString(36).slice(2, 8);
    const hlsPath = `hlsv2/blissful-party/master.m3u8?mediaURL=${encodeURIComponent(CFG.stream)}&maxWidth=3840`;
    const ipc = await page.evaluate(
      async (args) => {
        try { return { ok: true, r: await window.blissfulDesktop.call('startPartyRelay', args) }; }
        catch (e) { return { ok: false, err: String(e && e.message ? e.message : e) }; }
      },
      { room, hlsPath },
    );
    log('startPartyRelay -> ' + JSON.stringify(ipc));
    if (!ipc.ok) throw new Error('startPartyRelay rejected: ' + ipc.err);
    const relayUrl = ipc.r?.relayUrl ?? ipc.r?.result?.relayUrl;
    if (!relayUrl) throw new Error('no relayUrl');

    // 3) Sustain the transcode by pulling segments, while mpv keeps decoding.
    result.where = 'sustained relay transcode + playback';
    log('driving relay segments (tight timing) …');
    const relayStart = Date.now();
    let totalPulled = 0;
    let tunnelLiveAt = 0;
    for (let i = 0; i < CFG.rounds; i++) {
      if (shellExit) {
        log(`>>> shell EXITED at t+${((Date.now() - relayStart) / 1000).toFixed(1)}s after startPartyRelay (tunnelLive=${tunnelLiveAt ? 'yes' : 'NO'}, pulls=${totalPulled})`);
        break;
      }
      const { pulled, status } = await driveRound(relayUrl);
      totalPulled += pulled;
      if (status === 200 && !tunnelLiveAt) {
        tunnelLiveAt = Date.now();
        log(`relay master LIVE (tunnel registered) at t+${((tunnelLiveAt - relayStart) / 1000).toFixed(1)}s — transcode sustaining now`);
      }
      if (i % 4 === 0 || status !== 200) log(`t+${((Date.now() - relayStart) / 1000).toFixed(1)}s round ${i}: master=${status} pulls=${totalPulled} shellAlive=${!shellExit}`);
      await sleep(700);
    }

    if (!shellExit) {
      log(`survived ${CFG.rounds} rounds (${totalPulled} pulls) WITHOUT crashing`);
      await page.evaluate(() => window.blissfulDesktop.call('stopPartyRelay').catch(() => {}));
    }
  } catch (err) {
    result.notes = (result.notes || []);
    result.notes.push('FATAL: ' + (err && err.message ? err.message : String(err)));
  } finally {
    // Let a dying shell flush its output.
    if (shellExit) await sleep(800);
    result.crashed = !!shellExit;
    result.exit = shellExit;
    result.shellTail = dumpShellTail(70);

    console.log('\n================ RELAY CRASH REPRO ================');
    console.log(JSON.stringify({ crashed: result.crashed, exit: result.exit, where: result.where, notes: result.notes }, null, 2));
    console.log('---------------- shell output tail ----------------');
    console.log(result.shellTail);
    console.log('==================================================');
    if (result.crashed) {
      const code = result.exit?.code;
      console.log(`CRASHED at "${result.where}" — exit code ${code}` + (code === 101 ? ' (Rust panic)' : code != null && code < 0 ? ' (signal)' : code && code > 0x80000000 ? ' (likely access violation)' : ''));
    } else {
      console.log('NO CRASH reproduced this run.');
    }

    try { if (cdp) await cdp.close(); } catch { /* */ }
    killTree(shell);
    setTimeout(() => process.exit(result.crashed ? 1 : 0), 1500);
  }
}

process.on('SIGINT', () => { killTree(shell); process.exit(130); });
main();
