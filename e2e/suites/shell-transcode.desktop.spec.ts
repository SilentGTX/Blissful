import { mergeTests, expect } from '@playwright/test';
import { test as desktopTest } from '../fixtures/desktop';
import { test as mediaTest } from '../fixtures/media';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Migrated from scripts/e2e/verify-software-transcode.mjs. The GPU-overload
// PREVENTION: the Layer-B relay must transcode on the CPU (libx264), not the GPU
// (nvenc/amf), so it stops contending with mpv's 4K GPU decode — while keeping 4K.
const test = mergeTests(desktopTest, mediaTest);

const SETTINGS = path.join(process.env.APPDATA || '', 'stremio', 'stremio-server', 'server-settings.json');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ffmpegCmdlines(): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'ffmpeg' -or $_.CommandLine -match 'ffmpeg' } | Select-Object -ExpandProperty CommandLine"],
      { timeout: 8000 },
      (err, stdout) => resolve(err ? '' : stdout || ''),
    );
  });
}

// Pull the relay master + a media playlist + a few segments to spin up + sustain
// the transcode (so an ffmpeg process is actually running when we sample it).
async function driveRelay(masterUrl: string) {
  const r = await fetch(masterUrl, { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || r.status !== 200) return;
  const master = await r.text();
  for (const line of master.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
    if (!/\.m3u8/i.test(line)) continue;
    const abs = new URL(line, masterUrl).toString();
    const mr = await fetch(abs, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!mr || mr.status !== 200) continue;
    const media = await mr.text();
    for (const seg of media.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, 3)) {
      await fetch(new URL(seg, abs).toString(), { signal: AbortSignal.timeout(15000) }).then((x) => x.arrayBuffer()).catch(() => {});
    }
  }
}

test('relay transcodes on the CPU (software) keeping 4K — no GPU contention', async ({ desktop, webmUrl }) => {
  const { bridge } = desktop;
  const room = 'swtx-' + Math.random().toString(36).slice(2, 8);
  const hlsPath = `hlsv2/blissful-party/master.m3u8?mediaURL=${encodeURIComponent(webmUrl)}&maxWidth=3840`;

  const t0 = Date.now();
  const ipc = await bridge<{ relayUrl?: string }>('startPartyRelay', { room, hlsPath });
  expect(ipc.ok, `startPartyRelay rejected: ${ipc.err}`).toBe(true);
  const relayUrl = ipc.r?.relayUrl;
  expect(relayUrl, 'no relayUrl').toBeTruthy();

  // 1) The WRITTEN settings control the encoder. The shell (re)writes the file
  // when it spawns stremio on startPartyRelay — wait for a fresh mtime.
  await expect
    .poll(() => { try { return fs.statSync(SETTINGS).mtimeMs >= t0 - 2000; } catch { return false; } }, { timeout: 30_000 })
    .toBe(true);
  const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  expect(s.transcodeHardwareAccel, 'transcode must be SOFTWARE (frees the GPU for mpv)').toBe(false);
  expect(s.transcodeMaxWidth, 'must keep native 4K').toBe(3840);

  // 2) Observe the LIVE relay ffmpeg: software libx264, no GPU encoder.
  let cmd = '';
  for (let i = 0; i < 18 && !/libx264/i.test(cmd); i++) {
    await driveRelay(relayUrl!);
    cmd = await ffmpegCmdlines();
    await sleep(1000);
  }
  expect(cmd, 'ffmpeg never sampled (stremio remuxed without re-encode?)').toMatch(/ffmpeg/i);
  expect(cmd, 'relay must use software libx264').toMatch(/libx264|x264/i);
  expect(/nvenc|_qsv|_amf|hwaccel|cuda/i.test(cmd), 'relay must NOT use a GPU encoder').toBe(false);

  await bridge('stopPartyRelay');
});
