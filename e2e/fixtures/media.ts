import { test as base } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Serves a cached WebM over http://127.0.0.1 with Range + CORS, and exposes its
// URL as the `webmUrl` fixture. WebM/VP8 because Playwright's bundled Chromium
// ships NO proprietary codecs (mp4/H.264 fails), and local-http so the player's
// https-only DMCA-fallback never fires. Ported from scripts/e2e/watchparty.mjs.

const CACHE = path.join(process.cwd(), '.tmp-e2e', 'clip.webm');
const SOURCE = process.env.MEDIA_SOURCE_URL || 'https://media.w3.org/2010/05/sintel/trailer.webm';

async function ensureClip(): Promise<string> {
  if (fs.existsSync(CACHE) && fs.statSync(CACHE).size > 100_000) return CACHE;
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download test clip: HTTP ${res.status}`);
  fs.writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
  return CACHE;
}

export const test = base.extend<{ webmUrl: string }>({
  webmUrl: async ({}, use) => {
    const file = await ensureClip();
    const size = fs.statSync(file).size;
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'video/webm');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': end - start + 1,
        });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': size });
        fs.createReadStream(file).pipe(res);
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      await use(`http://127.0.0.1:${port}/clip.webm`);
    } finally {
      server.close();
    }
  },
});

export { expect } from '@playwright/test';
