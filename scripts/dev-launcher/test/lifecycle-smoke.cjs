// Exercises the real DevManager start -> starting -> running -> stop ->
// stopped path without touching the real dev ports: rewrites the "web"
// env (in this process only) to a scratch node server on :56124. Safe to
// run any time, even while real dev servers are up.
// Run: node scripts/dev-launcher/test/lifecycle-smoke.cjs

'use strict';

const { DevManager, ENVS, probePort } = require('../lib/manager.cjs');

const PORT = 56124;
const log = (msg) => console.log(`[lifecycle] ${msg}`);

function waitFor(label, fn, timeoutMs, intervalMs = 300) {
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

async function main() {
  if (await probePort(PORT)) throw new Error(`scratch port ${PORT} unexpectedly in use`);

  const web = ENVS.find((e) => e.id === 'web');
  // Boot delay imitates vite startup so the "starting" phase is observable.
  web.command = `node -e "setTimeout(() => { require('net').createServer().listen(${PORT}, () => console.log('scratch server up')); }, 1200); setInterval(() => {}, 1000)"`;
  web.ports = [PORT];

  const m = new DevManager();
  const snap = () => m.snapshot().find((e) => e.id === 'web');
  const phases = [];
  m.on('state', (s) => {
    const p = s.find((e) => e.id === 'web').phase;
    if (phases[phases.length - 1] !== p) phases.push(p);
  });

  m.startPolling();
  log('starting scratch env…');
  void m.start('web');

  await waitFor('phase running', () => snap().phase === 'running', 20000);
  if (!(await probePort(PORT))) throw new Error('running but scratch port not listening');
  log(`running on :${snap().livePort}; phase trail so far: ${phases.join(' -> ')}`);
  if (!phases.includes('starting')) throw new Error('never observed the "starting" phase');

  log('stopping…');
  await m.stop('web');
  await waitFor('phase stopped', () => snap().phase === 'stopped', 15000);
  if (await probePort(PORT)) throw new Error('stopped but scratch port still listening');
  log(`stopped, port freed; full phase trail: ${phases.join(' -> ')}`);

  const logs = m.allLogs().web;
  if (!logs.some((l) => l.includes('scratch server up'))) {
    throw new Error('child stdout never reached the log buffer');
  }
  log('child stdout captured in log buffer');

  m.dispose();
  console.log('[lifecycle] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[lifecycle] FAIL: ${err.message}`);
  process.exit(1);
});
