import { test, expect, chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Migrated from scripts/e2e/verify-leftover-replace.mjs. A stremio-runtime that
// leaked past a crash (still on :11470) must be TERMINATED + respawned by the next
// shell so the current server-settings.json (software-transcode fix) takes effect.
// Self-managed (NOT the desktop fixture) because the leftover must exist BEFORE the
// shell launches.

const ROOT = process.cwd();
const CDP = Number(process.env.BLISSFUL_CDP_PORT || 9222);
const UI = process.env.E2E_DESKTOP_UI || 'http://localhost:5173';
const PIDFILE = path.join(process.env.APPDATA || '', 'Blissful', 'stremio-service', 'blissful-runtime.pid');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findStremioExe(): string | null {
  const dir = path.join(process.env.APPDATA || '', 'Blissful', 'stremio-service');
  const direct = path.join(dir, 'stremio-runtime.exe');
  if (fs.existsSync(direct)) return direct;
  try {
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop()!;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/runtime\.exe$|service\.exe$/i.test(e.name)) return p;
      }
    }
  } catch {
    /* */
  }
  return null;
}
const httpGet = (u: string, t = 2000): Promise<{ status?: number; body: string } | null> =>
  new Promise((res) => {
    const req = http.get(u, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ status: r.statusCode, body: b })); });
    req.on('error', () => res(null));
    req.setTimeout(t, () => { req.destroy(); res(null); });
  });
const alive11470 = (): Promise<boolean> =>
  new Promise((res) => {
    const s = http.get('http://127.0.0.1:11470/', (r) => { r.destroy(); res(true); });
    s.on('error', () => res(false));
    s.setTimeout(1500, () => { s.destroy(); res(false); });
  });
const cdpUp = async () => {
  const r = await httpGet(`http://127.0.0.1:${CDP}/json/version`);
  return !!r && r.status === 200 && r.body.includes('webSocketDebuggerUrl');
};
const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readPid = () => { try { return Number(fs.readFileSync(PIDFILE, 'utf8').trim()) || null; } catch { return null; } };
async function waitFor(label: string, fn: () => Promise<boolean>, ms: number, iv = 800) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await sleep(iv); }
  throw new Error('timeout: ' + label);
}
const killTree = (c: ChildProcess | null) => { if (c && c.exitCode == null) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); };
const killAll = () => {
  spawn('taskkill', ['/IM', 'blissful-shell.exe', '/F', '/T'], { stdio: 'ignore' });
  spawn('taskkill', ['/IM', 'stremio-runtime.exe', '/F'], { stdio: 'ignore' });
};

test('leftover stremio is terminated + respawned (stale settings cannot defeat the fix)', async () => {
  test.slow(); // a standalone stremio + a shell launch (first run builds)
  const exe = findStremioExe();
  expect(exe, 'stremio-runtime.exe not found — run a desktop test once to extract it').toBeTruthy();

  killAll();
  await sleep(1000);
  try { fs.rmSync(PIDFILE, { force: true }); } catch { /* */ }

  // Phase 1: stand up a standalone stremio (PID_A) as the leftover + its pidfile.
  const manual = spawn(exe!, ['server.js'], { cwd: path.dirname(exe!), stdio: 'ignore', windowsHide: true });
  const pidA = manual.pid!;
  let shell: ChildProcess | null = null;
  const shellOut = path.join(ROOT, '.tmp-e2e', 'shell-leftover.out');
  fs.mkdirSync(path.dirname(shellOut), { recursive: true });
  try {
    await waitFor('leftover stremio on :11470', () => alive11470(), 30_000);
    fs.writeFileSync(PIDFILE, String(pidA));
    expect(pidAlive(pidA) && (await alive11470()), 'leftover did not come up').toBe(true);

    // Phase 2: a new shell must terminate the leftover + respawn on ensureStreamingServer.
    const fd = fs.openSync(shellOut, 'w');
    shell = spawn(
      process.execPath,
      ['scripts/run-cargo.cjs', 'run', '--manifest-path', 'apps/desktop-blissful/Cargo.toml', '--features', 'spike0a'],
      { cwd: ROOT, env: { ...process.env, BLISSFUL_REMOTE_DEBUG_PORT: String(CDP), BLISSFUL_UI_URL: UI, RUST_LOG: 'info' }, shell: false, stdio: ['ignore', fd, fd] },
    );
    await waitFor('shell CDP', () => cdpUp(), 360_000);
    const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
    const ctx = cdp.contexts()[0];
    const page = ctx.pages()[0] || (await ctx.waitForEvent('page', { timeout: 15000 }));
    await page.waitForFunction(() => !!(window as Window & { blissfulDesktop?: { call?: unknown } }).blissfulDesktop?.call, null, { timeout: 30_000 });
    await page.evaluate(() =>
      (window as Window & { blissfulDesktop: { call: (m: string) => Promise<unknown> } }).blissfulDesktop
        .call('ensureStreamingServer')
        .catch(() => {}),
    );

    await waitFor(
      'leftover replaced',
      async () => {
        const cur = readPid();
        return !pidAlive(pidA) && cur != null && cur !== pidA && pidAlive(cur);
      },
      30_000,
    );

    const pidB = readPid();
    expect(pidAlive(pidA), 'leftover PID_A should be terminated').toBe(false);
    expect(Boolean(pidB && pidB !== pidA && pidAlive(pidB)), 'a fresh stremio PID_B should be running').toBe(true);
    const log = (() => { try { return fs.readFileSync(shellOut, 'utf8'); } catch { return ''; } })();
    expect(/terminating leftover stremio-runtime|replaced leftover stremio/i.test(log), 'shell should log the terminate-leftover path').toBe(true);
  } finally {
    killTree(shell);
    killAll();
  }
});
