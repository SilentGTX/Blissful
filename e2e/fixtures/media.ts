import { test as base } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Local media servers (Range + CORS). `webmUrl` is a codec-friendly WebM (Chromium
// has no H.264; local-http so the player's https-only DMCA fallback never fires).
// `multitrackUrl` is an ffmpeg-generated MKV with 2 audio + 1 subtitle track for
// the desktop mpv player (mpv decodes anything) — null if no ffmpeg is available.

const TMP = path.join(process.cwd(), '.tmp-e2e');
const WEBM = path.join(TMP, 'clip.webm');
const MKV = path.join(TMP, 'multitrack.mkv');
const SOURCE = process.env.MEDIA_SOURCE_URL || 'https://media.w3.org/2010/05/sintel/trailer.webm';

async function ensureClip(): Promise<string> {
  if (fs.existsSync(WEBM) && fs.statSync(WEBM).size > 100_000) return WEBM;
  fs.mkdirSync(TMP, { recursive: true });
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download test clip: HTTP ${res.status}`);
  fs.writeFileSync(WEBM, Buffer.from(await res.arrayBuffer()));
  return WEBM;
}

function ffmpegPath(): string | null {
  const bundled = path.join(process.env.APPDATA || '', 'Blissful', 'stremio-service', 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;
  const sys = spawnSync('ffmpeg', ['-version'], { timeout: 5000 });
  return sys.status === 0 ? 'ffmpeg' : null;
}

// A short H.264/AAC MKV with 2 audio tracks (eng, spa) + 1 subrip subtitle. For the
// DESKTOP mpv player only (browsers can't decode it). Returns null if no ffmpeg.
function ensureMultitrack(): string | null {
  if (fs.existsSync(MKV) && fs.statSync(MKV).size > 10_000) return MKV;
  const ff = ffmpegPath();
  if (!ff) return null;
  fs.mkdirSync(TMP, { recursive: true });
  const srt = path.join(TMP, 'e2e-subs.srt');
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:15,000\nE2E test subtitle\n');
  const r = spawnSync(
    ff,
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=15:size=320x240:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=15',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=15',
      '-i', srt,
      '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-c:s', 'srt',
      '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=spa', '-metadata:s:s:0', 'language=eng',
      MKV,
    ],
    { timeout: 90_000 },
  );
  return r.status === 0 && fs.existsSync(MKV) ? MKV : null;
}

function serveFile(file: string, contentType: string): http.Server {
  const size = fs.statSync(file).size;
  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': size });
      fs.createReadStream(file).pipe(res);
    }
  });
}

// Sends headers + a tiny slice (not enough to decode a frame), then NEVER ends —
// so the <video> sits buffering. For the buffering-overlay test.
function serveStalling(file: string): http.Server {
  const size = fs.statSync(file).size;
  const buf = fs.readFileSync(file);
  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/webm');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    const start = m ? parseInt(m[1], 10) : 0;
    if (m) res.writeHead(206, { 'Content-Range': `bytes ${start}-${size - 1}/${size}`, 'Content-Length': String(size - start) });
    else res.writeHead(200, { 'Content-Length': String(size) });
    res.write(buf.subarray(start, Math.min(start + 1024, size)));
    // intentionally no res.end() — hold the connection so the video keeps buffering.
  });
}

async function listenServed(file: string, contentType: string, name: string): Promise<{ url: string; close: () => void }> {
  const server = serveFile(file, contentType);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/${name}`, close: () => server.close() };
}

export const test = base.extend<{ webmUrl: string; multitrackUrl: string | null; stallingUrl: string }>({
  webmUrl: async ({}, use) => {
    const s = await listenServed(await ensureClip(), 'video/webm', 'clip.webm');
    try {
      await use(s.url);
    } finally {
      s.close();
    }
  },
  stallingUrl: async ({}, use) => {
    const server = serveStalling(await ensureClip());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      await use(`http://127.0.0.1:${port}/clip.webm`);
    } finally {
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      server.close();
    }
  },
  multitrackUrl: async ({}, use) => {
    const file = ensureMultitrack();
    if (!file) {
      await use(null);
      return;
    }
    const s = await listenServed(file, 'video/x-matroska', 'multitrack.mkv');
    try {
      await use(s.url);
    } finally {
      s.close();
    }
  },
});

export { expect } from '@playwright/test';
