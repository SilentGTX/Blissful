// Verify the leftover-stremio HARDENING: a stremio-runtime that leaks past a
// hard crash (still holding :11470) must be TERMINATED + respawned by the next
// shell — so the current server-settings.json (software-transcode fix) takes
// effect instead of being silently defeated by the stale leftover.
//
// Phase 1: launch shell #1, trigger ensureStreamingServer → stremio spawns +
//          writes blissful-runtime.pid (PID_A). Kill ONLY blissful-shell.exe
//          (force, no /T) so stremio leaks like a hard crash would.
// Phase 2: launch shell #2, trigger ensureStreamingServer → ensure_started sees
//          the alive-but-unowned leftover → terminate_leftover_runtime (verifies
//          image == our binary via the pidfile) → respawn (PID_B).
// Assert:  PID_A dead, PID_B alive, PID_B != PID_A, and the shell logged the
//          "terminating leftover stremio-runtime" path.
//
// Usage:  node scripts/e2e/verify-leftover-replace.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.join(ROOT, '.tmp-e2e');
fs.mkdirSync(TMP, { recursive: true });

const CDP = Number(process.env.CDP_PORT || 9222);
const UI = process.env.SHELL_UI_URL || 'https://blissful.budinoff.com';
const PIDFILE = path.join(process.env.APPDATA, 'Blissful', 'stremio-service', 'blissful-runtime.pid');
const log = (...a) => console.log('[leftover]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const httpGet = (u, t = 2500) => new Promise((res) => {
  const req = http.get(u, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ status: r.statusCode, body: b })); });
  req.on('error', () => res(null)); req.setTimeout(t, () => { req.destroy(); res(null); });
});
const portUp = async (p) => { const r = await httpGet(`http://127.0.0.1:${p}/json/version`); return r && r.status === 200; };
const alive11470 = () => new Promise((res) => { const s = http.get('http://127.0.0.1:11470/', (r) => { r.destroy(); res(true); }); s.on('error', () => res(false)); s.setTimeout(1500, () => { s.destroy(); res(false); }); });
async function waitFor(label, fn, ms, iv = 800) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await sleep(iv); } throw new Error('timeout: ' + label); }
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readPidfile = () => { try { return Number(fs.readFileSync(PIDFILE, 'utf8').trim()) || null; } catch { return null; } };
const killShellExe = () => new Promise((res) => spawn('taskkill', ['/IM', 'blissful-shell.exe', '/F'], { stdio: 'ignore' }).on('exit', res));
const killAll = () => { spawn('taskkill', ['/IM', 'blissful-shell.exe', '/F', '/T'], { stdio: 'ignore' }); spawn('taskkill', ['/IM', 'stremio-runtime.exe', '/F'], { stdio: 'ignore' }); };

async function launchShell(tag) {
  const outPath = path.join(TMP, `leftover-${tag}.out`);
  const fd = fs.openSync(outPath, 'w');
  const sh = spawn(process.execPath, ['scripts/run-cargo.cjs', 'run', '--manifest-path', 'apps/desktop-blissful/Cargo.toml', '--features', 'spike0a'], {
    cwd: ROOT, env: { ...process.env, BLISSFUL_REMOTE_DEBUG_PORT: String(CDP), BLISSFUL_UI_URL: UI, RUST_LOG: 'info' }, shell: false, stdio: ['ignore', fd, fd],
  });
  return { sh, outPath };
}
function findStremioExe() {
  const dir = path.join(process.env.APPDATA, 'Blissful', 'stremio-service');
  const direct = path.join(dir, 'stremio-runtime.exe');
  if (fs.existsSync(direct)) return direct;
  try {
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/runtime\.exe$|service\.exe$/i.test(e.name)) return p;
      }
    }
  } catch { /* */ }
  return null;
}
async function triggerEnsure(chromium) {
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
  const ctx = cdp.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.waitForEvent('page', { timeout: 15000 }));
  await page.waitForFunction(() => !!(window.blissfulDesktop && window.blissfulDesktop.call), { timeout: 30_000 });
  const r = await page.evaluate(async () => { try { return { ok: true, r: await window.blissfulDesktop.call('ensureStreamingServer') }; } catch (e) { return { ok: false, err: String(e && e.message ? e.message : e) }; } });
  return r;
}

async function main() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { console.error('[leftover] playwright missing'); process.exit(3); }
  const out = { pidA: null, pidB: null, leftoverWasAlive: false, terminatedLog: false, verdict: 'FAIL', notes: [] };
  try { fs.rmSync(PIDFILE, { force: true }); } catch { /* */ }

  try {
    // ---- Phase 1: stand up a LEFTOVER stremio (PID_A) owned by NO shell ----
    // (Exactly the post-hard-crash state: a runtime still holding :11470 with a
    // pidfile, but not this session's child.)
    log('phase 1: spawning a standalone stremio-runtime as the "leftover"');
    const exe = findStremioExe();
    if (!exe) throw new Error('stremio-runtime.exe not found — run a shell once to extract it first');
    log('stremio exe: ' + exe);
    const manual = spawn(exe, ['server.js'], { cwd: path.dirname(exe), stdio: 'ignore', windowsHide: true });
    out.pidA = manual.pid;
    await waitFor('leftover stremio on :11470', () => alive11470(), 30_000);
    fs.writeFileSync(PIDFILE, String(out.pidA)); // the pidfile a real shell would have left
    out.leftoverWasAlive = pidAlive(out.pidA) && (await alive11470());
    log('leftover stremio PID_A = ' + out.pidA + ' alive+listening: ' + out.leftoverWasAlive);
    if (!out.leftoverWasAlive) throw new Error('manual stremio did not come up');

    // ---- Phase 2: a new shell must terminate the leftover + respawn ----
    log('phase 2: launching a shell — it should replace the leftover on ensureStreamingServer');
    const s2 = await launchShell('s2');
    await waitFor('shell CDP', () => portUp(CDP), 360_000);
    const ens2 = await triggerEnsure(chromium);
    log('shell ensureStreamingServer -> ' + JSON.stringify(ens2));

    // wait for PID_A to die AND a new PID to be on the pidfile
    await waitFor('leftover replaced', async () => {
      const cur = readPidfile();
      return !pidAlive(out.pidA) && cur != null && cur !== out.pidA && pidAlive(cur);
    }, 30_000);
    out.pidB = readPidfile();
    out.terminatedLog = (() => { try { return /terminating leftover stremio-runtime|replaced leftover stremio/i.test(fs.readFileSync(s2.outPath, 'utf8')); } catch { return false; } })();

    const ok = out.leftoverWasAlive && !pidAlive(out.pidA) && out.pidB && out.pidB !== out.pidA && pidAlive(out.pidB);
    if (ok) out.verdict = 'PASS';
    if (!out.terminatedLog) out.notes.push('shell #2 log did not show the terminate-leftover line (replaced via another path?)');
  } catch (err) {
    out.notes.push('FATAL: ' + (err && err.message ? err.message : String(err)));
  } finally {
    console.log('\n============ LEFTOVER-STREMIO REPLACE ============');
    console.log(JSON.stringify(out, null, 2));
    console.log('VERDICT: ' + (out.verdict === 'PASS'
      ? `PASS — leftover PID_A(${out.pidA}) terminated, respawned as PID_B(${out.pidB})`
      : 'FAIL — see notes'));
    console.log('=================================================');
    killAll();
    setTimeout(() => process.exit(out.verdict === 'PASS' ? 0 : 1), 2000);
  }
}
process.on('SIGINT', () => { killAll(); process.exit(130); });
main();
