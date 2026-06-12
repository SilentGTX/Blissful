// Headless smoke test for lib/manager.cjs against the real web env:
// start vite, wait until :5173 listens and the phase derives to "running",
// stop, and assert the process tree is dead and the port is freed.
// Run from anywhere: node scripts/dev-launcher/test/manager-smoke.cjs

'use strict';

const { DevManager, probePort } = require('../lib/manager.cjs');

const log = (msg) => console.log(`[smoke] ${msg}`);

function waitFor(label, fn, timeoutMs, intervalMs = 500) {
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

  if (await probePort(5173)) {
    log(':5173 is already in use — close the running vite first; aborting without changes');
    process.exit(2);
  }

  m.on('log', ({ id, lines }) => {
    for (const line of lines.slice(0, 3)) log(`  ${id} | ${line}`);
  });

  m.startPolling();
  log('starting web…');
  void m.start('web');

  await waitFor('web phase = running', () => snap('web').phase === 'running', 90000);
  if (!(await probePort(5173))) throw new Error('phase says running but :5173 not listening');
  log(`web is running (livePort ${snap('web').livePort})`);

  log('stopping web…');
  await m.stop('web');
  await waitFor('web phase = stopped', () => snap('web').phase === 'stopped', 15000);
  if (await probePort(5173)) throw new Error('stopped but :5173 still listening (orphan?)');
  log(':5173 freed, phase = stopped');

  m.dispose();
  log('PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[smoke] FAIL: ${err.message}`);
  process.exit(1);
});
