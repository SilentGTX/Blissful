import { test, expect } from '../fixtures/desktop';

// Migrated from scripts/e2e/verify-renderer-recovery.mjs onto the desktop fixture.
// Forces a WebView2 renderer crash and asserts the shell SURVIVES + the UI
// recovers (webview.rs add_process_failed navigates back) — instead of the app dying.
test('recovers from a renderer crash (shell survives + UI reloads)', async ({ desktop }) => {
  const { page, ctx, exit, probeBridge } = desktop;

  // Crash the renderer process out from under the shell.
  const client = await ctx.newCDPSession(page);
  await client.send('Page.crash').catch(() => {
    /* the target crashes — the send "fails", which is expected */
  });
  await new Promise((r) => setTimeout(r, 2000));

  // The shell process must NOT have died with its renderer.
  expect(exit(), 'shell should survive a renderer crash').toBeNull();

  // The handler navigates the UI back — a fresh CDP probe finds the bridge again.
  let recovered = false;
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline && !exit() && !recovered) {
    await new Promise((r) => setTimeout(r, 2500));
    recovered = await probeBridge();
  }
  expect(recovered, 'UI should recover (bridge back) after the handler navigates').toBe(true);
});
