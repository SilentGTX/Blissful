// Verify the WebView2 renderer-crash RECOVERY handler (webview.rs add_process_failed).
//
// Deterministically crashes the WebView2 renderer via CDP `Page.crash`, then checks
// that the shell SURVIVES and the UI RECOVERS (the blissfulDesktop bridge comes back
// after the handler's reload) — instead of the app dying like it did before.
//
// Usage:  node scripts/e2e/verify-renderer-recovery.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.tmp-e2e', 'recovery-shell.out');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const CDP = Number(process.env.CDP_PORT || 9222);
const UI = process.env.SHELL_UI_URL || 'https://blissful.budinoff.com';
const log = (...a) => console.log('[recovery]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shell = null;
let shellExit = null;

const httpGet = (u, t = 2000) => new Promise((res) => {
  const req = http.get(u, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ status: r.statusCode, body: b })); });
  req.on('error', () => res(null));
  req.setTimeout(t, () => { req.destroy(); res(null); });
});
async function waitFor(label, fn, ms, iv = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (shellExit) throw new Error(`shell exited before ${label}`); if (await fn().catch(() => false)) return true; await sleep(iv); }
  throw new Error('timeout: ' + label);
}
const killTree = (c) => { if (c && c.exitCode == null) { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else try { c.kill('SIGKILL'); } catch {} } };

async function main() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { console.error('[recovery] playwright missing'); process.exit(3); }
  const result = { crashedRenderer: false, shellSurvived: false, uiRecovered: false };
  let cdp = null;
  try {
    const fd = fs.openSync(OUT, 'w');
    shell = spawn(process.execPath, ['scripts/run-cargo.cjs', 'run', '--manifest-path', 'apps/desktop-blissful/Cargo.toml', '--features', 'spike0a'], {
      cwd: ROOT, env: { ...process.env, BLISSFUL_REMOTE_DEBUG_PORT: String(CDP), BLISSFUL_UI_URL: UI, RUST_LOG: 'info' }, shell: false, stdio: ['ignore', fd, fd],
    });
    shell.on('exit', (code, signal) => { shellExit = { code, signal }; });

    await waitFor('CDP', async () => { const r = await httpGet(`http://127.0.0.1:${CDP}/json/version`); return r && r.status === 200 && r.body.includes('webSocketDebuggerUrl'); }, 360_000);
    cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
    const ctx = cdp.contexts()[0];
    const page = ctx.pages()[0] || (await ctx.waitForEvent('page', { timeout: 15000 }));
    await page.waitForFunction(() => !!(window.blissfulDesktop && window.blissfulDesktop.call), { timeout: 30_000 });
    log('UI up + bridge present');

    // Force a renderer crash via CDP.
    log('crashing the renderer (Page.crash) …');
    const client = await ctx.newCDPSession(page);
    await client.send('Page.crash').catch((e) => log('Page.crash send: ' + e.message));
    result.crashedRenderer = true;
    await sleep(2000);

    // The shell must NOT have died with the renderer.
    result.shellSurvived = !shellExit;
    log('shell survived the renderer crash: ' + result.shellSurvived);
    if (!result.shellSurvived) throw new Error('shell process EXITED when the renderer crashed (no recovery)');

    // The handler navigates fresh → the UI + bridge come back. The prior page is
    // in a crashed state, so reconnect fresh each probe and wait for the bridge.
    log('waiting for the UI to recover (bridge back after the handler navigates) …');
    let recovered = false;
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline && !shellExit && !recovered) {
      await sleep(2500);
      try {
        const probe = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
        const pgs = probe.contexts()[0]?.pages() || [];
        for (const pg of pgs) {
          const ok = await pg.waitForFunction(() => !!(window.blissfulDesktop && window.blissfulDesktop.call), { timeout: 2500 }).then(() => true).catch(() => false);
          if (ok) { recovered = true; break; }
        }
        // Intentionally NOT closing `probe` — connectOverCDP close can disturb the WebView.
      } catch { /* target churn during recovery */ }
    }
    result.uiRecovered = recovered;
  } catch (err) {
    result.error = err && err.message ? err.message : String(err);
  } finally {
    result.shellTail = (() => { try { return fs.readFileSync(OUT, 'utf8').split(/\r?\n/).filter((l) => /process failed|reload|panic/i.test(l)).slice(-6).join('\n'); } catch { return ''; } })();
    const pass = result.crashedRenderer && result.shellSurvived && result.uiRecovered;
    console.log('\n============ RENDERER RECOVERY VERIFY ============');
    console.log(JSON.stringify(result, null, 2));
    console.log('VERDICT: ' + (pass ? 'PASS — renderer crash recovered (app survived + UI reloaded)' : 'FAIL'));
    console.log('=================================================');
    // Don't close the connectOverCDP browser (can disturb the WebView); just end the shell.
    void cdp;
    killTree(shell);
    setTimeout(() => process.exit(pass ? 0 : 1), 1500);
  }
}
process.on('SIGINT', () => { killTree(shell); process.exit(130); });
main();
