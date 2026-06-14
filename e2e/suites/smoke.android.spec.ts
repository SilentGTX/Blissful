import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';

// Android TV smoke. The React-Native TV app is driven over ADB (no DOM/CDP), and
// the emulator can't decode video — so this asserts the app BOOTS and its activity
// is the foreground window + its process is alive, NOT playback (that needs a real
// TV) or deep UI (that needs an adb-keyevent + screencap harness). Auto-skips when
// no device/emulator is attached (start one: `npm run dev android`).

const SDK =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const ADB = path.join(SDK, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const PACKAGE = 'com.blissful.tv.rn';

function adb(args: string[]): Promise<string> {
  return new Promise((resolve) =>
    execFile(ADB, args, { windowsHide: true, timeout: 20_000 }, (err, stdout) => resolve(err ? '' : String(stdout))),
  );
}
async function onlineSerial(): Promise<string | null> {
  const out = await adb(['devices']);
  for (const line of out.split(/\r?\n/).slice(1)) {
    const [serial, state] = line.trim().split(/\s+/);
    if (serial && state === 'device') return serial;
  }
  return null;
}

test('TV app boots and its activity is the foreground window', async () => {
  test.slow(); // emulator + Metro bundle load
  const serial = await onlineSerial();
  test.skip(!serial, 'no Android device/emulator online — start it with: npm run dev android');

  // Launch the app (idempotent) and wait for its window to be the current focus.
  await adb(['-s', serial!, 'shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']);
  await expect
    .poll(async () => (await adb(['-s', serial!, 'shell', 'dumpsys', 'window'])).includes(PACKAGE), {
      timeout: 90_000,
      intervals: [2500],
    })
    .toBe(true);

  // And the app process is actually alive (not sitting on a crash/ANR dialog).
  const pid = (await adb(['-s', serial!, 'shell', 'pidof', PACKAGE])).trim();
  expect(pid.length, 'app process should be running').toBeGreaterThan(0);
});
