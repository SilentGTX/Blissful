// Headless smoke test for the desktop dependency chain: starting "desktop"
// with :5173 down must auto-start web, hold the shell in "waiting" until
// vite accepts connections, then spawn cargo. PASS when the shell's local
// proxy answers on :5175 (UI served from live vite — not the wiped dist).
// NOTE: opens a real shell window briefly; needs a warm cargo build to be
// quick. Run: node scripts/dev-launcher/test/desktop-smoke.cjs

'use strict';

const { DevManager, probePort } = require('../lib/manager.cjs');

const log = (msg) => console.log(`[desktop-smoke] ${msg}`);

function waitFor(label, fn, timeoutMs, intervalMs = 700) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      let ok = false;
      try {
        ok = await fn();
      } catch (err) {
        reject(err);
        return;
      }
      if (ok) return resolve();
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for: ${label}`));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function main() {
  const m = new DevManager();
  const snap = (id) => m.snapshot().find((e) => e.id === id);
  let sawWaiting = false;

  if ((await probePort(5173)) || (await probePort(5175))) {
    log(':5173 or :5175 already in use — aborting without changes');
    process.exit(2);
  }

  m.on('state', (s) => {
    const d = s.find((e) => e.id === 'desktop');
    if (d.phase === 'waiting') sawWaiting = true;
  });

  m.startPolling();
  log('starting desktop with web down — expecting auto-start of web first…');
  void m.start('desktop');

  await waitFor('web running', () => snap('web').phase === 'running', 90000);
  log('web is up on :5173');
  if (!sawWaiting) throw new Error('desktop never entered the "waiting for :5173" phase');
  log('desktop correctly waited for :5173 before spawning the shell');

  // Cold cargo builds can take minutes; warm ones seconds.
  await waitFor('desktop running (shell proxy on :5175+)', () => snap('desktop').phase === 'running', 480000, 1500);
  log(`shell proxy answering on :${snap('desktop').livePort}`);

  log('stopping desktop — web must stay up…');
  await m.stop('desktop');
  await waitFor('desktop stopped', () => snap('desktop').phase === 'stopped', 20000);
  if (await probePort(5175)) throw new Error('desktop stopped but :5175 still listening');
  if (!(await probePort(5173))) throw new Error('stopping desktop also killed web');
  log('desktop tree dead, :5175 freed, web still running');

  log('stopping web…');
  await m.stop('web');
  await waitFor('web stopped', () => snap('web').phase === 'stopped', 15000);
  if (await probePort(5173)) throw new Error('web stopped but :5173 still listening');

  m.dispose();
  log('PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[desktop-smoke] FAIL: ${err.message}`);
  process.exit(1);
});
