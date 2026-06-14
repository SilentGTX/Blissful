// Full Android env cycle through the real manager: Start boots the TV
// emulator + Metro (and launches the app if installed); Stop must kill the
// script tree, force-stop the app, shut the emulator down, and free :8081.
// NOTE: boots and then kills the real TV AVD — takes a few minutes.
// Run: node scripts/dev-launcher/test/android-smoke.cjs

'use strict';

const { execFile } = require('child_process');
const { DevManager, probePort } = require('../lib/manager.cjs');
const { ADB, listDevices } = require('../../dev-android.cjs');

const log = (msg) => console.log(`[android-smoke] ${msg}`);

function waitFor(label, fn, timeoutMs, intervalMs = 1000) {
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

async function emulatorsOnline() {
  return (await listDevices()).filter((d) => d.serial.startsWith('emulator-'));
}

async function main() {
  if (await probePort(8081)) {
    log(':8081 already in use — aborting without changes');
    process.exit(2);
  }
  if ((await emulatorsOnline()).length > 0) {
    log('an emulator is already online — aborting without changes');
    process.exit(2);
  }

  const m = new DevManager();
  const snap = () => m.snapshot().find((e) => e.id === 'android');
  m.on('log', ({ id, lines }) => {
    if (id === 'android') for (const l of lines) log(`  | ${l}`);
  });
  m.startPolling();

  log('starting android (emulator boot + Metro — this takes a while)…');
  void m.start('android');
  await waitFor('android running (:8081 up)', () => snap().phase === 'running', 240000);
  log('Metro is up; waiting for the emulator to come online…');
  await waitFor('emulator online', async () => (await emulatorsOnline()).length > 0, 180000, 2500);
  log('emulator online — stopping the android env…');

  await m.stop('android');
  await waitFor('android stopped', () => snap().phase === 'stopped', 40000);
  if (await probePort(8081)) throw new Error('stopped but :8081 still listening');
  await waitFor('emulator gone', async () => (await emulatorsOnline()).length === 0, 30000, 1500);
  log('script tree dead, :8081 freed, emulator shut down');

  m.dispose();
  console.log('[android-smoke] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[android-smoke] FAIL: ${err.message}`);
  process.exit(1);
});
