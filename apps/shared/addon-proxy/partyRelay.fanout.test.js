'use strict';
// Integration test: the host relay fanning ONE host stream out to SIX guests.
// Run: node --test partyRelay.fanout.test.js   (needs the `ws` package; skips without it)
//
// Boots the real server.js on a free port, plays the desktop HOST over the
// tunnel WebSocket (answering pulls like the shell does), and drives six
// concurrent guests through master -> media playlist -> segments. Asserts:
//   - each segment is pulled from the host exactly ONCE however many guests
//     fetch it (the host's upload/CPU must not scale with party size);
//   - every guest receives identical, correct bytes;
//   - with a pinned host query, nothing guest-facing carries `mediaURL` (it can
//     embed the host's debrid key) and a guest cannot override it;
//   - hosts that pin nothing (older builds) keep working unchanged.
//
// Scale it up for a manual load run:
//   RELAY_TEST_GUESTS=6 RELAY_TEST_SEGMENTS=40 RELAY_TEST_SEG_MB=9 node --test partyRelay.fanout.test.js

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

let WebSocket = null;
try { WebSocket = require('ws'); } catch { /* skip below */ }

const GUESTS = Number(process.env.RELAY_TEST_GUESTS || 6);
const SEGMENTS = Number(process.env.RELAY_TEST_SEGMENTS || 8);
const SEG_BYTES = Math.round(Number(process.env.RELAY_TEST_SEG_MB || 1) * 1024 * 1024);

const SECRET = 'HOSTDEBRIDKEY';
const MEDIA = `https://torrentio.strem.fun/resolve/realdebrid/${SECRET}/abc/null/0/Some%20Movie.mkv`;
const HOST_QUERY = new URLSearchParams({ mediaURL: MEDIA, maxWidth: '3840' }).toString();

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(base, child) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited early (${child.exitCode})`);
    try {
      const r = await fetch(`${base}/party-relay/none/x?k=1`);
      if (r.status === 404) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

// Deterministic segment body so every guest's bytes can be checked by hash.
function segmentBody(name) {
  const seed = crypto.createHash('sha256').update(name).digest();
  const out = Buffer.alloc(SEG_BYTES);
  for (let off = 0; off < SEG_BYTES; off += seed.length) seed.copy(out, off);
  return out;
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** A fake desktop host: connects the tunnel and answers pulls like stremio's /hlsv2. */
function startHost(base, room, key) {
  const pulls = []; // every path the relay asked us for, in order
  const ws = new WebSocket(`${base.replace('http', 'ws')}/party-relay-tunnel?room=${room}&key=${key}`);
  const reply = (id, contentType, body) =>
    ws.send(JSON.stringify({ t: 'pulled', id, ok: true, status: 200, contentType, bodyB64: Buffer.from(body).toString('base64') }));
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.t !== 'pull') return;
    pulls.push(msg.path);
    const [p, query = ''] = msg.path.split('?');
    const q = query ? `?${query}` : '';
    // A real transcode takes time — the delay is what makes coalescing matter.
    setTimeout(() => {
      // stremio-service answering with an error (transcoder restarting): the
      // shell still reports ok:true with the real status. First ask only.
      if (p.includes('flaky') && pulls.filter((x) => x.split('?')[0] === p).length === 1) {
        ws.send(JSON.stringify({ t: 'pulled', id: msg.id, ok: true, status: 500, contentType: 'text/plain', bodyB64: Buffer.from('transcode error').toString('base64') }));
        return;
      }
      if (p.endsWith('master.m3u8')) {
        reply(msg.id, 'application/vnd.apple.mpegurl', `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=20000000\nvideo0.m3u8${q}\n`);
      } else if (p.endsWith('video0.m3u8')) {
        const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:4', `#EXT-X-MAP:URI="video0/init.mp4${q}"`];
        for (let i = 1; i <= SEGMENTS; i++) lines.push('#EXTINF:4.0,', `video0/segment${i}.m4s${q}`);
        lines.push('#EXT-X-ENDLIST', '');
        reply(msg.id, 'application/vnd.apple.mpegurl', lines.join('\n'));
      } else {
        reply(msg.id, 'video/mp4', segmentBody(p));
      }
    }, 40);
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, pulls }));
    ws.once('error', reject);
  });
}

/** One guest: master -> media playlist -> every segment, like hls.js would. */
async function runGuest(masterUrl) {
  const seen = []; // every guest-facing URL + playlist body, for the leak check
  const get = async (u) => {
    seen.push(u);
    const r = await fetch(u);
    assert.strictEqual(r.status, 200, `GET ${u} -> ${r.status}`);
    return r;
  };
  const master = await (await get(masterUrl)).text();
  seen.push(master);
  const mediaUri = master.split('\n').find((l) => l && !l.startsWith('#'));
  const mediaUrl = new URL(mediaUri, masterUrl).toString();
  const media = await (await get(mediaUrl)).text();
  seen.push(media);
  const uris = media.split('\n').filter((l) => l && !l.startsWith('#'));
  const init = /URI="([^"]+)"/.exec(media);
  if (init) uris.unshift(init[1]);
  const hashes = {};
  let bytes = 0;
  // hls.js fetches a few segments ahead; three at a time is representative.
  for (let i = 0; i < uris.length; i += 3) {
    await Promise.all(uris.slice(i, i + 3).map(async (uri) => {
      const u = new URL(uri, mediaUrl).toString();
      const body = Buffer.from(await (await get(u)).arrayBuffer());
      hashes[new URL(u).pathname.split('/hlsv2/')[1]] = sha(body);
      bytes += body.length;
    }));
  }
  return { hashes, bytes, seen };
}

test('host relay fans one stream out to six guests', { skip: !WebSocket && 'ws package not installed' }, async (t) => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fanout-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      JSON_CACHE_DIR: path.join(tmp, 'json'),
      IMG_CACHE_DIR: path.join(tmp, 'img'),
      PLAYER_LOG_DIR: path.join(tmp, 'logs'),
      RD_FALLBACK_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  t.after(() => {
    child.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  await waitForServer(base, child);

  await t.test('pinned host query: one pull per segment, nothing leaks to guests', async () => {
    const room = 'abc-def';
    const key = 'relaykey1';
    const host = await startHost(base, room, key);
    try {
      // Config is refused for a wrong key / unknown room, accepted for the live tunnel.
      const cfg = (r, k, body) => fetch(`${base}/party-relay/${r}/__config?k=${k}`, { method: 'POST', body: JSON.stringify(body) });
      assert.strictEqual((await cfg(room, 'wrong', { query: HOST_QUERY })).status, 403);
      assert.strictEqual((await cfg('no-such', key, { query: HOST_QUERY })).status, 409);
      assert.strictEqual((await cfg(room, key, { query: 123 })).status, 400);
      assert.strictEqual((await cfg(room, key, { query: HOST_QUERY })).status, 204);

      const masterUrl = `${base}/party-relay/${room}/hlsv2/blissful-party/master.m3u8?k=${key}`;
      assert.strictEqual((await fetch(masterUrl.replace(key, 'nope'))).status, 403, 'wrong relay key is refused');

      const started = Date.now();
      const guests = await Promise.all(Array.from({ length: GUESTS }, () => runGuest(masterUrl)));
      const seconds = (Date.now() - started) / 1000;

      // Every guest got every segment, byte-identical and correct.
      const expected = { 'blissful-party/video0/init.mp4': sha(segmentBody('hlsv2/blissful-party/video0/init.mp4')) };
      for (let i = 1; i <= SEGMENTS; i++) {
        expected[`blissful-party/video0/segment${i}.m4s`] = sha(segmentBody(`hlsv2/blissful-party/video0/segment${i}.m4s`));
      }
      for (const g of guests) assert.deepStrictEqual(g.hashes, expected);

      // The host was asked for each segment exactly once, whatever the guest count.
      const counts = {};
      for (const p of host.pulls) counts[p.split('?')[0]] = (counts[p.split('?')[0]] || 0) + 1;
      for (let i = 1; i <= SEGMENTS; i++) {
        assert.strictEqual(counts[`hlsv2/blissful-party/video0/segment${i}.m4s`], 1, `segment${i} pulled ${counts[`hlsv2/blissful-party/video0/segment${i}.m4s`]}x`);
      }
      assert.strictEqual(counts['hlsv2/blissful-party/video0/init.mp4'], 1);

      // Every pull carried the pinned query; nothing guest-facing did.
      for (const p of host.pulls) assert.ok(p.endsWith(`?${HOST_QUERY}`), `pull missing pinned query: ${p}`);
      for (const g of guests) {
        for (const s of g.seen) {
          assert.ok(!s.includes('mediaURL') && !s.includes(SECRET), `leaked to guest: ${s.slice(0, 200)}`);
        }
      }
      assert.ok(!log.includes(SECRET), 'debrid key must not reach the server log');

      // A guest cannot swap the media the host is asked for.
      const before = host.pulls.length;
      await fetch(`${base}/party-relay/${room}/hlsv2/blissful-party/video0/extra.m4s?mediaURL=http%3A%2F%2Fevil%2F&k=${key}`);
      assert.strictEqual(host.pulls.length, before + 1);
      assert.ok(host.pulls[before].endsWith(`?${HOST_QUERY}`), host.pulls[before]);

      // A host-side error fails that one request and is NOT cached: the retry
      // (hls.js retries failed fragments) gets the real segment.
      const flaky = `${base}/party-relay/${room}/hlsv2/blissful-party/video0/flaky.m4s?k=${key}`;
      assert.strictEqual((await fetch(flaky)).status, 502, 'host 500 must surface as a failure');
      const retry = await fetch(flaky);
      assert.strictEqual(retry.status, 200, 'the error must not have been cached');
      assert.strictEqual(
        sha(Buffer.from(await retry.arrayBuffer())),
        sha(segmentBody('hlsv2/blissful-party/video0/flaky.m4s')),
      );

      const totalMb = guests.reduce((n, g) => n + g.bytes, 0) / 1024 / 1024;
      const hostMb = (SEGMENTS + 1) * SEG_BYTES / 1024 / 1024;
      t.diagnostic(`${GUESTS} guests x ${SEGMENTS} segments of ${(SEG_BYTES / 1024 / 1024).toFixed(1)} MB: `
        + `host sent ${hostMb.toFixed(0)} MB once, relay served ${totalMb.toFixed(0)} MB in ${seconds.toFixed(1)} s `
        + `(${(totalMb * 8 / seconds).toFixed(0)} Mbit/s)`);
    } finally {
      host.ws.close();
    }
  });

  await t.test('legacy host (no pinned query) still works with the full URL', async () => {
    const room = 'old-hst';
    const key = 'relaykey2';
    const host = await startHost(base, room, key);
    try {
      const masterUrl = `${base}/party-relay/${room}/hlsv2/blissful-party/master.m3u8?${HOST_QUERY}&k=${key}`;
      const [a, b] = await Promise.all([runGuest(masterUrl), runGuest(masterUrl)]);
      assert.deepStrictEqual(a.hashes, b.hashes);
      assert.strictEqual(Object.keys(a.hashes).length, SEGMENTS + 1);
      for (const p of host.pulls) assert.ok(p.includes('mediaURL='), `legacy pull lost its query: ${p}`);
      const counts = {};
      for (const p of host.pulls) counts[p.split('?')[0]] = (counts[p.split('?')[0]] || 0) + 1;
      assert.strictEqual(counts['hlsv2/blissful-party/video0/segment1.m4s'], 1);
    } finally {
      host.ws.close();
    }
  });
});
