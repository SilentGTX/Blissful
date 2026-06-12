// Exercises the desktop->web dependency chain with scratch envs (in this
// process only): auto-start of the dependency, the "waiting" phase, the
// stop-dependency-while-waiting bail, and the double-start guard. Never
// touches the real dev ports. Run:
//   node scripts/dev-launcher/test/dep-wait-smoke.cjs

'use strict';

const { DevManager, ENVS, probePort } = require('../lib/manager.cjs');

const WEB_PORT = 56124;
const DESKTOP_PORT = 56125;
const log = (msg) => console.log(`[dep-wait] ${msg}`);

function waitFor(label, fn, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await fn()) return resolve();
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for: ${label}`));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

const serverCmd = (port, delayMs) =>
  `node -e "setTimeout(() => { require('net').createServer().listen(${port}, () => console.log('up')); }, ${delayMs}); setInterval(() => {}, 1000)"`;

async function main() {
  if ((await probePort(WEB_PORT)) || (await probePort(DESKTOP_PORT))) {
    throw new Error('scratch ports unexpectedly in use');
  }

  const web = ENVS.find((e) => e.id === 'web');
  web.command = serverCmd(WEB_PORT, 1500); // slow boot so "waiting" is observable
  web.ports = [WEB_PORT];
  const desktop = ENVS.find((e) => e.id === 'desktop');
  desktop.command = serverCmd(DESKTOP_PORT, 100);
  desktop.ports = [DESKTOP_PORT];

  const m = new DevManager();
  const snap = (id) => m.snapshot().find((e) => e.id === id);
  const phaseTrail = { web: [], desktop: [] };
  m.on('state', (s) => {
    for (const e of s) {
      const t = phaseTrail[e.id];
      if (t && t[t.length - 1] !== e.phase) t.push(e.phase);
    }
  });
  m.startPolling();

  // Scenario A: start desktop with web down -> web auto-starts, desktop
  // waits for the port, then spawns and reaches running.
  log('A: starting desktop with web down…');
  void m.start('desktop');
  await waitFor('desktop running', () => snap('desktop').phase === 'running', 30000);
  if (!phaseTrail.desktop.includes('waiting')) throw new Error('desktop never showed "waiting"');
  if (snap('web').phase !== 'running') throw new Error('web did not auto-start');
  log(`A PASS (desktop trail: ${phaseTrail.desktop.join(' -> ')})`);

  log('A teardown: stop desktop (web must survive), then web…');
  await m.stop('desktop');
  await waitFor('desktop stopped', () => snap('desktop').phase === 'stopped', 15000);
  if (snap('web').phase !== 'running') throw new Error('stopping desktop killed web');
  await m.stop('web');
  await waitFor('web stopped', () => snap('web').phase === 'stopped', 15000);

  // Scenario B: stop the dependency while desktop is waiting on it ->
  // desktop must bail promptly, not burn the 120s timeout.
  log('B: starting desktop, stopping web mid-wait…');
  phaseTrail.desktop.length = 0;
  void m.start('desktop');
  await waitFor('desktop waiting', () => snap('desktop').phase === 'waiting', 10000);
  await waitFor('web starting', () => snap('web').phase === 'starting', 10000);
  const bailStart = Date.now();
  await m.stop('web');
  await waitFor('desktop bailed to stopped', () => snap('desktop').phase === 'stopped', 15000);
  const bailMs = Date.now() - bailStart;
  if (bailMs > 10000) throw new Error(`bail took ${bailMs}ms — waiter looks stranded`);
  const detail = snap('desktop').detail ?? '';
  if (!detail.includes('stopped while we waited')) {
    throw new Error(`unexpected bail detail: "${detail}"`);
  }
  log(`B PASS (bailed in ${bailMs}ms, detail: "${detail}")`);

  // Scenario C: two synchronous start() calls must spawn exactly one child.
  log('C: double-start web in the same tick…');
  void m.start('web');
  void m.start('web');
  await waitFor('web running', () => snap('web').phase === 'running', 20000);
  const spawnLines = m.allLogs().web.filter((l) => l.startsWith('$ ')).length;
  // one spawn from A, one from B (auto-start), one from C = 3 total
  if (spawnLines !== 3) throw new Error(`expected 3 spawn lines total, saw ${spawnLines}`);
  await m.stop('web');
  await waitFor('web stopped', () => snap('web').phase === 'stopped', 15000);
  log('C PASS (exactly one spawn for the double-start)');

  if ((await probePort(WEB_PORT)) || (await probePort(DESKTOP_PORT))) {
    throw new Error('scratch ports still in use after teardown');
  }
  m.dispose();
  console.log('[dep-wait] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[dep-wait] FAIL: ${err.message}`);
  process.exit(1);
});
