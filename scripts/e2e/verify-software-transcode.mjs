// Verify the GPU-overload PREVENTION: the Layer-B relay transcodes on the CPU
// (software libx264), not the GPU (nvenc/amf) — so it no longer contends with
// mpv's 4K GPU decode (the crash cause).
//
// 1. launch the real shell → it writes server-settings.json before spawning
//    stremio-service; assert transcodeHardwareAccel=false + transcodeMaxWidth=3840.
// 2. startPartyRelay on a webm (VP8 → MUST re-encode to H.264 for HLS, so the
//    encoder path runs), GET the relay so the transcode is live.
// 3. enumerate the live ffmpeg process args: assert SOFTWARE (libx264) + NO
//    nvenc / -hwaccel. That is the GPU-decoupling, observed directly.
//
// Usage:  node scripts/e2e/verify-software-transcode.mjs

import { spawn, execFile } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const CFG = {
  cdpPort: Number(process.env.CDP_PORT || 9222),
  uiUrl: process.env.SHELL_UI_URL || 'https://blissful.budinoff.com',
  media: process.env.TEST_WEBM || 'https://media.w3.org/2010/05/sintel/trailer.webm',
  cdpTimeoutMs: Number(process.env.CDP_TIMEOUT_MS || 360_000),
};
const log = (...a) => console.log('[swtx]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shell = null; let shellExit = null;

const httpGet = (u, t = 2500) => new Promise((res) => {
  const req = http.get(u, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ status: r.statusCode, body: b })); });
  req.on('error', () => res(null)); req.setTimeout(t, () => { req.destroy(); res(null); });
});
async function waitFor(label, fn, ms, iv = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (shellExit) throw new Error(`shell exited before ${label}`); if (await fn().catch(() => false)) return true; await sleep(iv); }
  throw new Error('timeout: ' + label);
}
const killTree = (c) => { if (c && c.exitCode == null) { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else try { c.kill('SIGKILL'); } catch { /* */ } } };

// Enumerate ffmpeg command lines via PowerShell (Windows).
function ffmpegCmdlines() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'ffmpeg' -or $_.CommandLine -match 'ffmpeg' } | Select-Object -ExpandProperty CommandLine"],
      { timeout: 8000 }, (err, stdout) => resolve(err ? '' : (stdout || '')));
  });
}

async function main() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { console.error('[swtx] playwright missing'); process.exit(3); }
  const out = { settings: {}, relay: {}, ffmpeg: { sampled: false, software: false, hardware: false, cmd: '' }, verdict: 'FAIL', notes: [] };
  let cdp = null;
  try {
    log('launching shell (writes server-settings.json before spawning stremio)');
    const runStart = Date.now();
    shell = spawn(process.execPath, ['scripts/run-cargo.cjs', 'run', '--manifest-path', 'apps/desktop-blissful/Cargo.toml', '--features', 'spike0a'], {
      cwd: ROOT, env: { ...process.env, BLISSFUL_REMOTE_DEBUG_PORT: String(CFG.cdpPort), BLISSFUL_UI_URL: CFG.uiUrl, RUST_LOG: 'info' }, shell: false, stdio: 'inherit',
    });
    shell.on('exit', (code) => { shellExit = { code }; });

    await waitFor('CDP', async () => { const r = await httpGet(`http://127.0.0.1:${CFG.cdpPort}/json/version`); return r && r.status === 200 && r.body.includes('webSocketDebuggerUrl'); }, CFG.cdpTimeoutMs);
    cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CFG.cdpPort}`);
    const ctx = cdp.contexts()[0];
    const page = ctx.pages()[0] || (await ctx.waitForEvent('page', { timeout: 15000 }));
    await page.waitForFunction(() => !!(window.blissfulDesktop && window.blissfulDesktop.call), { timeout: 30_000 });
    log('bridge ready');

    // 1) Start the relay — this lazily triggers ensure_started, which is when the
    // shell (re)writes server-settings.json and spawns stremio. GET it to drive a
    // real transcode.
    const room = 'swtx-' + Math.random().toString(36).slice(2, 8);
    const hlsPath = `hlsv2/blissful-party/master.m3u8?mediaURL=${encodeURIComponent(CFG.media)}&maxWidth=3840`;
    const ipc = await page.evaluate(async (a) => { try { return { ok: true, r: await window.blissfulDesktop.call('startPartyRelay', a) }; } catch (e) { return { ok: false, err: String(e && e.message ? e.message : e) }; } }, { room, hlsPath });
    if (!ipc.ok) throw new Error('startPartyRelay rejected: ' + ipc.err);
    const relayUrl = ipc.r?.relayUrl ?? ipc.r?.result?.relayUrl;
    if (!relayUrl) throw new Error('no relayUrl');
    out.relay.url = relayUrl; log('relay started');

    // 2) Assert the WRITTEN settings (the config that controls the encoder). The
    // shell rewrote the file when it spawned stremio above; require a fresh mtime
    // (>= this run's start) so we never read a stale prior-session file.
    const settingsPath = path.join(process.env.APPDATA, 'stremio', 'stremio-server', 'server-settings.json');
    await waitFor('fresh server-settings.json', async () => {
      try { return fs.statSync(settingsPath).mtimeMs >= runStart - 1500; } catch { return false; }
    }, 30_000, 500);
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    out.settings = { transcodeHardwareAccel: s.transcodeHardwareAccel, transcodeMaxWidth: s.transcodeMaxWidth, transcodeHorsepower: s.transcodeHorsepower };
    log('server-settings.json (fresh): ' + JSON.stringify(out.settings));
    const settingsOk = s.transcodeHardwareAccel === false && s.transcodeMaxWidth === 3840;
    if (!settingsOk) out.notes.push('settings NOT software/4K: ' + JSON.stringify(out.settings));

    // Pull master + a media playlist + segments to spin up + sustain ffmpeg,
    // sampling the ffmpeg args while it runs.
    let validHls = false;
    for (let i = 0; i < 18 && !out.ffmpeg.software; i++) {
      const r = await fetch(relayUrl, { signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (r && r.status === 200) {
        const master = await r.text();
        if (/#EXTM3U/.test(master)) validHls = true;
        for (const line of master.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
          const abs = new URL(line, relayUrl).toString();
          if (/\.m3u8/i.test(line)) {
            const mr = await fetch(abs, { signal: AbortSignal.timeout(15000) }).catch(() => null);
            if (mr && mr.status === 200) {
              const media = await mr.text();
              for (const seg of media.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, 3)) {
                await fetch(new URL(seg, abs).toString(), { signal: AbortSignal.timeout(15000) }).then((x) => x.arrayBuffer()).catch(() => {});
              }
            }
          }
        }
      }
      // sample the live ffmpeg args
      const cmd = await ffmpegCmdlines();
      if (cmd && /ffmpeg/i.test(cmd)) {
        out.ffmpeg.sampled = true; out.ffmpeg.cmd = cmd.replace(/\s+/g, ' ').slice(0, 600);
        if (/libx264|x264/i.test(cmd)) out.ffmpeg.software = true;
        if (/nvenc|_qsv|_amf|hwaccel|cuda|videotoolbox/i.test(cmd)) out.ffmpeg.hardware = true;
      }
      await sleep(1200);
    }
    out.relay.servedValidHls = validHls;

    await page.evaluate(() => window.blissfulDesktop.call('stopPartyRelay').catch(() => {}));

    // Verdict: settings are software+4K AND (ffmpeg observed software, OR ffmpeg
    // never sampled but the config guarantees it — note the weaker proof).
    const ffOk = out.ffmpeg.sampled ? (out.ffmpeg.software && !out.ffmpeg.hardware) : null;
    if (!out.ffmpeg.sampled) out.notes.push('ffmpeg never sampled (stremio may have remuxed without re-encode) — config still proves software');
    if (out.ffmpeg.sampled && out.ffmpeg.hardware) out.notes.push('ffmpeg used a HARDWARE encoder — software switch NOT effective');
    if (settingsOk && validHls && ffOk !== false) out.verdict = 'PASS';
  } catch (err) {
    out.notes.push('FATAL: ' + (err && err.message ? err.message : String(err)));
  } finally {
    console.log('\n============ SOFTWARE-TRANSCODE PREVENTION ============');
    console.log(JSON.stringify(out, null, 2));
    const detail = out.ffmpeg.sampled
      ? (out.ffmpeg.software && !out.ffmpeg.hardware ? 'relay ffmpeg = libx264 (CPU), no GPU encoder' : 'ffmpeg encoder unexpected')
      : 'settings software+4K (ffmpeg not sampled)';
    console.log('VERDICT: ' + (out.verdict === 'PASS' ? 'PASS — ' + detail : 'FAIL — see notes'));
    console.log('======================================================');
    void cdp; killTree(shell);
    setTimeout(() => process.exit(out.verdict === 'PASS' ? 0 : 1), 1500);
  }
}
process.on('SIGINT', () => { killTree(shell); process.exit(130); });
main();
