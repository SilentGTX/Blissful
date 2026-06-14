// Full Android TV dev loop in one process — what the Dev Launcher's Android
// card (and `npm run dev android`) actually needs, vs bare `expo start`:
//
//   1. ensure a device:   boot the TV emulator (detached) if nothing is online
//   2. start Metro:       npm start -- --port 8081   (child — dies with us)
//   3. adb reverse 8081   so the device reaches Metro on localhost
//   4. launch the app     (monkey LAUNCHER intent) once Metro + device are up
//
// The emulator is spawned DETACHED so that Ctrl+C on this script (CLI use)
// leaves it running for the next session. The LAUNCHER's Stop goes further:
// it taskkills this script's tree (Metro) and then explicitly force-stops
// the app and shuts the emulator down via `adb emu kill` (see the
// stopCleanup hook in scripts/dev-launcher/lib/manager.cjs, which requires
// this file for its adb helpers). Exit code follows Metro.
//
// If the dev APK isn't installed on the device this logs how to fix it
// (one-off `npx expo run:android`) and leaves Metro running.

'use strict';

const { spawn, execFile } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'apps', 'android-blissful');
const PACKAGE = 'com.blissful.tv.rn';
const AVD = process.env.BLISSFUL_TV_AVD || 'Television_1080p';
const METRO_PORT = 8081;

const SDK =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const EXE = process.platform === 'win32' ? '.exe' : '';
const ADB = path.join(SDK, 'platform-tools', `adb${EXE}`);
const EMULATOR = path.join(SDK, 'emulator', `emulator${EXE}`);

const DEVICE_BOOT_TIMEOUT_MS = 150000;
const METRO_TIMEOUT_MS = 120000;

const log = (line) => console.log(line);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function adb(args) {
  return new Promise((resolve) => {
    execFile(ADB, args, { windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

/** All serials from `adb devices` with their states. */
async function listDevices() {
  const out = await adb(['devices']);
  if (!out) return [];
  const devices = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const [serial, state] = line.trim().split(/\s+/);
    if (serial && state) devices.push({ serial, state });
  }
  return devices;
}

/** First serial in `adb devices` whose state is exactly "device". */
async function onlineSerial() {
  const d = (await listDevices()).find((d) => d.state === 'device');
  return d ? d.serial : null;
}

async function bootCompleted(serial) {
  const out = await adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
  return out !== null && out.trim() === '1';
}

function probePort(port, timeoutMs = 750) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    let settled = false;
    const done = (up) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(up);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

/** A booted device serial — boots the TV AVD (detached) when none is online. */
async function ensureDevice() {
  let serial = await onlineSerial();
  if (serial && (await bootCompleted(serial))) {
    log(`> device already online: ${serial}`);
    return serial;
  }
  if (!serial) {
    log(`> no device online — booting AVD ${AVD}`);
    // detached+unref is NOT enough on Windows: taskkill /T (the launcher's
    // Stop) walks the recorded parent-PID chain even for detached children.
    // A throwaway `node -e` intermediary spawns the emulator and exits
    // immediately, so the tree walk dead-ends at a dead PID — and unlike
    // `cmd /c start`, windowsHide suppresses the emulator's log console
    // (CREATE_NO_WINDOW only affects the console; the TV GUI window shows).
    const emuArgs = ['-avd', AVD, '-no-snapshot-save', '-gpu', 'host'];
    const emu =
      process.platform === 'win32'
        ? spawn(
            process.execPath,
            [
              '-e',
              'require("child_process").spawn(process.argv[1], process.argv.slice(2), { detached: true, stdio: "ignore", windowsHide: true }).unref()',
              EMULATOR,
              ...emuArgs,
            ],
            { detached: true, stdio: 'ignore', windowsHide: true },
          )
        : spawn(EMULATOR, emuArgs, { detached: true, stdio: 'ignore' });
    emu.unref();
  } else {
    log(`> device ${serial} is still booting…`);
  }
  const deadline = Date.now() + DEVICE_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    serial = await onlineSerial();
    if (serial && (await bootCompleted(serial))) {
      log(`> device booted: ${serial}`);
      return serial;
    }
    await sleep(2500);
  }
  return null;
}

async function appInstalled(serial) {
  const out = await adb(['-s', serial, 'shell', 'pm', 'list', 'packages', PACKAGE]);
  return out !== null && out.split(/\r?\n/).some((l) => l.trim() === `package:${PACKAGE}`);
}

async function main() {
  if (!fs.existsSync(ADB)) {
    console.error(`adb not found at ${ADB} — set ANDROID_HOME or install the Android SDK.`);
    process.exit(1);
  }

  // Metro first — it boots in parallel with the (much slower) emulator.
  // If something already listens on the port (a previous session's Metro, or
  // another instance of this script), reuse it: expo would otherwise bail in
  // non-interactive mode ("Use port 8082 instead?"). With no Metro child of
  // our own we just do the device half and exit when done.
  let metro = null;
  let metroExited = false;
  if (await probePort(METRO_PORT)) {
    log(`> Metro is already running on :${METRO_PORT} — reusing it`);
  } else {
    log(`$ npm start -- --port ${METRO_PORT}  (cwd: apps/android-blissful)`);
    metro = spawn(`npm start -- --port ${METRO_PORT}`, {
      cwd: APP_DIR,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    metro.once('exit', (code, signal) => {
      metroExited = true;
      process.exitCode = signal ? 1 : (code ?? 1);
      // Nothing left to orchestrate once Metro is gone.
      setTimeout(() => process.exit(), 50).unref();
    });
  }

  const serial = await ensureDevice();
  if (!serial) {
    log(`> gave up waiting for a device after ${DEVICE_BOOT_TIMEOUT_MS / 1000}s — Metro stays up; connect a device and relaunch the app manually.`);
    return; // keep running with Metro
  }
  if (metroExited) return;

  await adb(['-s', serial, 'reverse', `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`]);
  log(`> adb reverse tcp:${METRO_PORT} set on ${serial}`);

  if (!(await appInstalled(serial))) {
    log(`> ${PACKAGE} is NOT installed on ${serial}.`);
    log('> One-off setup: run "npx expo run:android" in apps/android-blissful to build + install the dev APK, then Start again.');
    return; // Metro stays up so run:android can use it
  }

  // Wait until Metro accepts connections before launching the app, so the
  // dev client's first bundle request doesn't race the server.
  const deadline = Date.now() + METRO_TIMEOUT_MS;
  let metroUp = false;
  while (Date.now() < deadline && !metroExited) {
    if (await probePort(METRO_PORT)) {
      metroUp = true;
      break;
    }
    await sleep(700);
  }
  if (!metroUp) {
    log(`> Metro never answered on :${METRO_PORT} — not launching the app.`);
    return;
  }

  await adb(['-s', serial, 'shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']);
  log(`> app launched on ${serial} — Fast Refresh active.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`dev-android failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

// adb helpers reused by the launcher's Stop teardown (manager.cjs).
module.exports = { ADB, PACKAGE, adb, listDevices, onlineSerial };
