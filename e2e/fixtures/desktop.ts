import {
  test as base,
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';

// Reusable DESKTOP fixture: launches the real Rust shell with an env-gated CDP
// remote-debug port, connects Playwright over CDP, and exposes the WebView page
// + the blissfulDesktop IPC bridge. Every `*.desktop.spec.ts` builds on this.
//
// Notes that the watch-party harnesses taught us, baked in here:
//  - spawn the cargo wrapper with shell:false (process.execPath has a space);
//  - free the binary first (a running shell locks blissful-shell.exe → build OS error 5);
//  - point the shell at the dev UI (vite on :5173, started by playwright webServer)
//    so we exercise CURRENT code;
//  - after a renderer crash the prior Page is "crashed" — reconnect FRESH to probe.

// Playwright runs from the repo root; transpiles to CJS so no import.meta here.
const ROOT = process.cwd();
const CDP_PORT = Number(process.env.BLISSFUL_CDP_PORT || 9222);
const UI_URL = process.env.E2E_DESKTOP_UI || 'http://localhost:5173';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function httpGet(url: string, t = 2500): Promise<{ status?: number; body: string } | null> {
  return new Promise((res) => {
    const req = http.get(url, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => res({ status: r.statusCode, body: b }));
    });
    req.on('error', () => res(null));
    req.setTimeout(t, () => {
      req.destroy();
      res(null);
    });
  });
}
function killShellBinary(): Promise<void> {
  return new Promise((res) => {
    if (process.platform !== 'win32') return res();
    spawn('taskkill', ['/IM', 'blissful-shell.exe', '/F'], { stdio: 'ignore' }).on('exit', () =>
      res(),
    );
  });
}
function killTree(c: ChildProcess | null) {
  if (!c || c.exitCode != null) return;
  if (process.platform === 'win32')
    spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
  else
    try {
      c.kill('SIGKILL');
    } catch {
      /* already gone */
    }
}

export type DesktopShell = {
  proc: ChildProcess;
  /** Latest exit status, or null while alive. */
  exit: () => { code: number | null } | null;
  cdpPort: number;
  cdp: Browser;
  ctx: BrowserContext;
  page: Page;
  /** Invoke a blissfulDesktop bridge IPC method on the page. */
  bridge: <T = unknown>(method: string, args?: unknown) => Promise<{ ok: boolean; r?: T; err?: string }>;
  /** Fresh CDP probe for a live blissfulDesktop bridge (use after a crash/recovery). */
  probeBridge: () => Promise<boolean>;
};

export const test = base.extend<{ desktop: DesktopShell }>({
  desktop: async ({}, use) => {
    await killShellBinary();
    await sleep(600);

    let exited: { code: number | null } | null = null;
    const proc = spawn(
      process.execPath,
      ['scripts/run-cargo.cjs', 'run', '--manifest-path', 'apps/desktop-blissful/Cargo.toml', '--features', 'spike0a'],
      {
        cwd: ROOT,
        env: { ...process.env, BLISSFUL_REMOTE_DEBUG_PORT: String(CDP_PORT), BLISSFUL_UI_URL: UI_URL, RUST_LOG: 'info' },
        shell: false,
        stdio: 'ignore',
      },
    );
    proc.on('exit', (code) => {
      exited = { code };
    });

    try {
      // Wait for the WebView2 CDP endpoint (first run BUILDS the shell — minutes).
      const deadline = Date.now() + 360_000;
      let cdpUp = false;
      while (Date.now() < deadline) {
        if (exited) throw new Error(`shell exited during startup (code ${exited.code})`);
        const r = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (r && r.status === 200 && r.body.includes('webSocketDebuggerUrl')) {
          cdpUp = true;
          break;
        }
        await sleep(1000);
      }
      if (!cdpUp) throw new Error('timeout waiting for the shell CDP endpoint');

      const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      const ctx = cdp.contexts()[0];
      const page = ctx.pages()[0] || (await ctx.waitForEvent('page', { timeout: 15_000 }));
      await page.waitForFunction(
        () => !!((window as Window & { blissfulDesktop?: { call?: unknown } }).blissfulDesktop?.call),
        null,
        { timeout: 30_000 },
      );

      const bridge = <T,>(method: string, args?: unknown) =>
        page.evaluate(
          async ({ method, args }) => {
            const d = (window as Window & { blissfulDesktop?: { call: (m: string, a?: unknown) => Promise<unknown> } }).blissfulDesktop!;
            try {
              return { ok: true, r: await d.call(method, args) };
            } catch (e) {
              return { ok: false, err: String(e instanceof Error ? e.message : e) };
            }
          },
          { method, args },
        ) as Promise<{ ok: boolean; r?: T; err?: string }>;

      const probeBridge = async () => {
        try {
          const probe = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
          const pages = probe.contexts()[0]?.pages() || [];
          for (const pg of pages) {
            const ok = await pg
              .waitForFunction(
                () => !!((window as Window & { blissfulDesktop?: { call?: unknown } }).blissfulDesktop?.call),
                null,
                { timeout: 2500 },
              )
              .then(() => true)
              .catch(() => false);
            if (ok) return true; // intentionally NOT closing probe — connectOverCDP close disturbs the WebView
          }
        } catch {
          /* target churn during recovery */
        }
        return false;
      };

      await use({ proc, exit: () => exited, cdpPort: CDP_PORT, cdp, ctx, page, bridge, probeBridge });
    } finally {
      killTree(proc);
      await killShellBinary();
    }
  },
});

export { expect } from '@playwright/test';
