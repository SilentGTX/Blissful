// Watch Party v2 protocol + endpoint test suite.
//
// Where scripts/e2e/watchparty.mjs is the BEHAVIORAL test (two real players sync
// across web↔desktop), this suite tests the v2 WIRE PROTOCOL + HTTP ENDPOINTS
// deterministically — no players, no real content — by driving raw WebSocket
// clients + raw HTTP against the deployed storage / addon-proxy (which dev
// proxies to prod by default). It covers the parts of docs/WATCH-PARTY-V2.md
// that DON'T need a real torrent / RD cache / the live Mac relay; those are
// reported SKIP-with-reason.
//
// Tiers (each test PASS / FAIL / SKIP):
//   0  unit          — the existing watchPartySource vitest unit tests
//   A  Layer A proto — host:source relay (all kinds), sanitize, late-joiner
//                      snapshot, source-clear-on-episode, non-host guard, ticks
//   RD /rd-by-hash   — bad-input 400 (deterministic), uncached 404 (~10s),
//                      cached 200 (SKIP unless RD_TEST_INFOHASH given)
//   B  Layer B proto — party:request-host-stream → host; decline → guest
//   BR /party-relay  — fake-host tunnel + pull-through (playlist rewrite,
//                      wrong-key 403, unknown-room 404, segment cache)
//
// Usage:  node scripts/e2e/watchparty-v2.mjs
// Env:    STORAGE_HTTP, STORAGE_WS, RDBYHASH_URL, PARTY_RELAY_URL,
//         PARTY_RELAY_TUNNEL_URL, RD_TEST_INFOHASH (+ RD_TEST_FILEIDX),
//         SKIP_UNIT=1

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const CFG = {
  storageHttp: process.env.STORAGE_HTTP || 'https://blissful.budinoff.com/storage',
  storageWs: process.env.STORAGE_WS || 'wss://blissful.budinoff.com/storage/ws/room',
  rdByHash: process.env.RDBYHASH_URL || 'https://blissful.budinoff.com/rd-by-hash',
  partyRelay: process.env.PARTY_RELAY_URL || 'https://blissful.budinoff.com/party-relay',
  partyRelayTunnel: process.env.PARTY_RELAY_TUNNEL_URL || 'wss://blissful.budinoff.com/party-relay-tunnel',
  rdTestHash: process.env.RD_TEST_INFOHASH || null,
  rdTestFileIdx: process.env.RD_TEST_FILEIDX || null,
  stremio: process.env.STREMIO_URL || 'http://127.0.0.1:11470',
  skipUnit: process.env.SKIP_UNIT === '1',
};

let WebSocket;

// ---------- tiny test framework -------------------------------------------

const results = [];
const log = (...a) => console.log('[v2]', ...a);

async function test(tier, name, fn) {
  process.stdout.write(`[v2] ${tier} · ${name} … `);
  try {
    const r = await fn();
    if (r && r.skip) {
      results.push({ tier, name, status: 'SKIP', reason: r.reason });
      console.log(`SKIP (${r.reason})`);
    } else {
      results.push({ tier, name, status: 'PASS' });
      console.log('PASS');
    }
  } catch (err) {
    results.push({ tier, name, status: 'FAIL', reason: err.message });
    console.log(`FAIL — ${err.message}`);
  }
}
const skip = (reason) => ({ skip: true, reason });
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => 'e2ev2' + Math.random().toString(36).slice(2, 14);

// ---------- WS client helper ----------------------------------------------

function wsClient() {
  const ws = new WebSocket(CFG.storageWs);
  const msgs = [];
  const waiters = [];
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(m)) {
        const [w] = waiters.splice(i, 1);
        w.resolve(m);
      }
    }
  });
  return {
    ws,
    open: () =>
      new Promise((res, rej) => {
        ws.once('open', res);
        ws.once('error', rej);
      }),
    send: (obj) => ws.send(JSON.stringify(obj)),
    waitFor: (pred, timeoutMs = 6000) =>
      new Promise((res, rej) => {
        const hit = msgs.find(pred);
        if (hit) return res(hit);
        const w = { pred, resolve: res };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          rej(new Error('timeout waiting for a message'));
        }, timeoutMs);
      }),
    // Assert a predicate does NOT match within a window (negative test).
    expectNone: async (pred, windowMs = 1500) => {
      await sleep(windowMs);
      if (msgs.some(pred)) throw new Error('received a message that should NOT have arrived');
    },
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

async function createRoom({ type = 'movie', imdbId = 'tt1254207' } = {}) {
  const res = await fetch(`${CFG.storageHttp}/watch-party`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, imdbId, videoId: null, password: null, guestId: rid() }),
  });
  if (!res.ok) throw new Error(`create room HTTP ${res.status}`);
  const { code } = await res.json();
  if (!code) throw new Error('create room: no code');
  return code;
}

// Join a WS client to a room; returns { c, room, userId }.
async function joinRoom(code, displayName) {
  const c = wsClient();
  await c.open();
  c.send({ t: 'join', code, displayName, guestId: rid() });
  const room = await c.waitFor((m) => m.t === 'room', 8000);
  return { c, room, userId: room.self?.userId };
}

// Host + guest in a fresh room. Host joins first → becomes host.
async function hostAndGuest() {
  const code = await createRoom();
  const host = await joinRoom(code, 'V2 Host');
  const guest = await joinRoom(code, 'V2 Guest');
  return { code, host, guest, cleanup: () => {
    host.c.close();
    guest.c.close();
  } };
}

// ---------- Tier 0: unit tests --------------------------------------------

function runUnit() {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', '--prefix', 'apps/web-blissful', 'test', '--', 'watchPartySource'], {
      cwd: ROOT,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => {
      const m = out.match(/Tests\s+(\d+)\s+passed/i);
      resolve({ code, passed: m ? Number(m[1]) : null, out });
    });
  });
}

// ---------- suites ---------------------------------------------------------

async function tierA() {
  // host:source relay — all kinds round-trip through the server to the guest.
  const kinds = [
    { kind: 'torrent', infoHash: 'a'.repeat(40), fileIdx: 2, trackers: ['udp://t.example:6969'] },
    { kind: 'rd', rdUrl: 'https://x.download.real-debrid.com/d/ABC123/file.mkv' },
    { kind: 'vidking', tmdbId: 27205, mediaType: 'movie' },
    { kind: 'vidking', tmdbId: 1399, mediaType: 'tv', season: 1, episode: 3 },
    { kind: 'relay', url: 'https://blissful.budinoff.com/party-relay/abc-def/index.m3u8?k=key' },
  ];
  for (const src of kinds) {
    const label = src.kind + (src.mediaType ? `/${src.mediaType}` : '');
    await test('A', `host:source relay — ${label}`, async () => {
      const { host, guest, cleanup } = await hostAndGuest();
      try {
        host.c.send({ t: 'host:source', source: src });
        const got = await guest.c.waitFor((m) => m.t === 'source', 6000);
        // The server lowercases infoHash + drops null fileIdx fields; compare the
        // fields we sent that survive sanitize.
        assert(got.source, 'guest got source:null');
        assert(got.source.kind === src.kind, `kind ${got.source.kind} != ${src.kind}`);
        if (src.kind === 'torrent') {
          assert(got.source.infoHash === src.infoHash.toLowerCase(), 'infoHash mismatch');
          assert(got.source.fileIdx === src.fileIdx, 'fileIdx mismatch');
        }
        if (src.kind === 'rd') assert(got.source.rdUrl === src.rdUrl, 'rdUrl mismatch');
        if (src.kind === 'vidking') {
          assert(got.source.tmdbId === src.tmdbId, 'tmdbId mismatch');
          assert(got.source.mediaType === src.mediaType, 'mediaType mismatch');
          if (src.season != null) assert(got.source.season === src.season, 'season mismatch');
        }
        if (src.kind === 'relay') assert(got.source.url === src.url, 'relay url mismatch');
      } finally {
        cleanup();
      }
    });
  }

  // Sanitization — bad infoHash / bad url → null.
  await test('A', 'host:source sanitize — bad infoHash → null', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      host.c.send({ t: 'host:source', source: { kind: 'torrent', infoHash: 'not-a-hash', fileIdx: 0 } });
      const got = await guest.c.waitFor((m) => m.t === 'source', 6000);
      assert(got.source === null, `expected null, got ${JSON.stringify(got.source)}`);
    } finally {
      cleanup();
    }
  });
  await test('A', 'host:source sanitize — non-http rd url → null', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      host.c.send({ t: 'host:source', source: { kind: 'rd', rdUrl: 'ftp://nope/file' } });
      const got = await guest.c.waitFor((m) => m.t === 'source', 6000);
      assert(got.source === null, `expected null, got ${JSON.stringify(got.source)}`);
    } finally {
      cleanup();
    }
  });

  // Late-joiner snapshot carries the current source.
  await test('A', 'late-joiner snapshot carries source', async () => {
    const code = await createRoom();
    const host = await joinRoom(code, 'V2 Host');
    try {
      const src = { kind: 'torrent', infoHash: 'b'.repeat(40), fileIdx: 1 };
      host.c.send({ t: 'host:source', source: src });
      await sleep(600); // let the server persist room.source
      const late = await joinRoom(code, 'V2 Late');
      try {
        assert(late.room.source, 'late snapshot source is null');
        assert(late.room.source.infoHash === src.infoHash, 'late snapshot infoHash mismatch');
        assert(late.room.source.fileIdx === 1, 'late snapshot fileIdx mismatch');
      } finally {
        late.c.close();
      }
    } finally {
      host.c.close();
    }
  });

  // host:episode clears the source (server-side) — proven by a fresh snapshot.
  await test('A', 'host:episode clears source (fresh snapshot null)', async () => {
    const code = await createRoom();
    const host = await joinRoom(code, 'V2 Host');
    try {
      host.c.send({ t: 'host:source', source: { kind: 'torrent', infoHash: 'c'.repeat(40), fileIdx: 0 } });
      await sleep(400);
      host.c.send({ t: 'host:episode', videoId: 'tt1254207:1:2' });
      await sleep(600);
      const late = await joinRoom(code, 'V2 Late');
      try {
        assert(late.room.source === null || late.room.source === undefined, `expected null source, got ${JSON.stringify(late.room.source)}`);
      } finally {
        late.c.close();
      }
    } finally {
      host.c.close();
    }
  });

  // Non-host cannot announce a source (server ignores it).
  await test('A', 'non-host host:source is ignored', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      // Guest (non-host) tries to announce — host must NOT receive a source msg.
      guest.c.send({ t: 'host:source', source: { kind: 'torrent', infoHash: 'd'.repeat(40), fileIdx: 0 } });
      await host.c.expectNone((m) => m.t === 'source', 1800);
    } finally {
      cleanup();
    }
  });

  // host:tick relays to the guest with a server-stamped sentAt.
  await test('A', 'host:tick → guest tick (server-stamped)', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      host.c.send({ t: 'host:tick', currentTime: 42.5, isPlaying: true });
      const tick = await guest.c.waitFor((m) => m.t === 'tick', 6000);
      assert(tick.currentTime === 42.5, 'currentTime mismatch');
      assert(tick.isPlaying === true, 'isPlaying mismatch');
      assert(typeof tick.sentAt === 'number' && tick.sentAt > 0, 'sentAt not server-stamped');
    } finally {
      cleanup();
    }
  });

  // Presence: the host sees the guest join.
  await test('A', 'presence — host sees guest join', async () => {
    const code = await createRoom();
    const host = await joinRoom(code, 'V2 Host');
    try {
      const guest = await joinRoom(code, 'V2 Guest');
      try {
        const pres = await host.c.waitFor((m) => m.t === 'presence' && m.kind === 'joined', 6000);
        assert(pres.userId === guest.userId, 'presence userId mismatch');
      } finally {
        guest.c.close();
      }
    } finally {
      host.c.close();
    }
  });
}

async function tierRdByHash() {
  // Bad input → 400 (deterministic, no RD needed).
  await test('RD', '/rd-by-hash bad infoHash → 400', async () => {
    const res = await fetch(`${CFG.rdByHash}?infoHash=not-a-hash`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });
  await test('RD', '/rd-by-hash non-int fileIdx → 400', async () => {
    const res = await fetch(`${CFG.rdByHash}?infoHash=${'a'.repeat(40)}&fileIdx=abc`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  // Uncached random hash → 404 {cached:false}. Bounded ~10s; the RD torrent
  // self-cleans (no multi-GB download). Real but deterministic.
  await test('RD', '/rd-by-hash uncached hash → 404', async () => {
    const randomHash = Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor((Date.now() * Math.random()) % 16)]).join('');
    const res = await fetch(`${CFG.rdByHash}?infoHash=${randomHash}&fileIdx=0`, { signal: AbortSignal.timeout(20000) });
    if (res.status === 502 || res.status === 401) return skip(`RD upstream unavailable (${res.status} — no house RD key?)`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
    const body = await res.json().catch(() => ({}));
    assert(body.cached === false, `expected {cached:false}, got ${JSON.stringify(body)}`);
  });

  // Cached hash → 200 + a real RD link. The 200 path needs a torrent actually
  // cached in the house RD account, so it's opt-in: pass RD_TEST_INFOHASH for a
  // known hash, or RD_DEEP=1 to DISCOVER a popular title's hashes via torrentio
  // (a popular movie is ~always RD-cached) and resolve the first that hits.
  await test('RD', '/rd-by-hash cached hash → 200 + RD link', async () => {
    let candidates = [];
    if (CFG.rdTestHash) {
      candidates = [{ infoHash: CFG.rdTestHash, fileIdx: CFG.rdTestFileIdx != null ? Number(CFG.rdTestFileIdx) : 0 }];
    } else if (process.env.RD_DEEP === '1') {
      const imdb = process.env.RD_DISCOVER_IMDB || 'tt1375666'; // Inception — popular
      candidates = (await discoverInfoHashes(imdb)).slice(0, 8);
    } else {
      return skip('set RD_TEST_INFOHASH or RD_DEEP=1 (discovers a popular cached torrent)');
    }
    if (!candidates.length) return skip('no infoHashes discovered');
    let found = null;
    let tried = 0;
    for (const c of candidates) {
      tried++;
      const idx = c.fileIdx != null ? `&fileIdx=${c.fileIdx}` : '';
      const res = await fetch(`${CFG.rdByHash}?infoHash=${c.infoHash}${idx}`, { signal: AbortSignal.timeout(30000) });
      if (res.status === 200) {
        found = await res.json();
        break;
      }
    }
    if (!found) return skip(`none of ${tried} candidate hashes were RD-cached`);
    assert(/^https?:\/\//.test(found.url || ''), `expected a direct URL, got ${JSON.stringify(found)}`);
    assert(/real-debrid\.com/.test(found.url), `url is not a real-debrid link: ${found.url}`);
  });
}

// Discover real infoHashes for a title via the default torrentio addon.
async function discoverInfoHashes(imdbId) {
  const res = await fetch(`https://torrentio.strem.fun/stream/movie/${imdbId}.json`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('torrentio HTTP ' + res.status);
  const j = await res.json();
  return (j.streams || [])
    .filter((s) => typeof s.infoHash === 'string')
    .map((s) => ({ infoHash: s.infoHash, fileIdx: Number.isInteger(s.fileIdx) ? s.fileIdx : 0 }));
}

async function tierB() {
  // party:request-host-stream → routed to the HOST with `from`.
  await test('B', 'party:request-host-stream → host', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      guest.c.send({ t: 'party:request-host-stream' });
      const req = await host.c.waitFor((m) => m.t === 'party:host-stream-request', 6000);
      assert(req.from && req.from.userId === guest.userId, 'request.from.userId mismatch');
      assert(req.from.displayName === 'V2 Guest', 'request.from.displayName mismatch');
    } finally {
      cleanup();
    }
  });

  // party:decline-host-stream → routed to the requesting GUEST.
  await test('B', 'party:decline-host-stream → guest', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      host.c.send({ t: 'party:decline-host-stream', targetUserId: guest.userId });
      await guest.c.waitFor((m) => m.t === 'party:host-stream-declined', 6000);
    } finally {
      cleanup();
    }
  });

  // A guest cannot decline (host-only); host must not receive a decline echo.
  await test('B', 'non-host decline is ignored', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      guest.c.send({ t: 'party:decline-host-stream', targetUserId: host.userId });
      await host.c.expectNone((m) => m.t === 'party:host-stream-declined', 1800);
    } finally {
      cleanup();
    }
  });
}

async function tierSync() {
  // Play / pause / seek — anyone's action relays to everyone else (the thing
  // that makes "pause pauses on both streams" / "seek seeks both" work).
  for (const kind of ['pause', 'play', 'seek']) {
    await test('SYNC', `event ${kind} (host) → relayed to guest`, async () => {
      const { host, guest, cleanup } = await hostAndGuest();
      try {
        host.c.send({ t: 'event', kind, currentTime: 73.2 });
        const ev = await guest.c.waitFor((m) => m.t === 'event' && m.kind === kind, 6000);
        assert(ev.currentTime === 73.2, `currentTime mismatch (${ev.currentTime})`);
        assert(ev.from && ev.from.userId === host.userId, 'event.from mismatch');
        assert(typeof ev.sentAt === 'number', 'no server-stamped sentAt');
      } finally {
        cleanup();
      }
    });
  }

  // "Anyone in the room can control" — a guest's pause reaches the host too.
  await test('SYNC', 'event pause (guest) → relayed to host', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      guest.c.send({ t: 'event', kind: 'pause', currentTime: 12 });
      const ev = await host.c.waitFor((m) => m.t === 'event' && m.kind === 'pause', 6000);
      assert(ev.from && ev.from.userId === guest.userId, 'event.from mismatch');
    } finally {
      cleanup();
    }
  });

  // Buffering gate: a buffering member holds everyone; all-ready releases.
  await test('SYNC', 'buffering → gate(true); ready → gate(false)', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      guest.c.send({ t: 'buffering', waiting: true });
      const g1 = await host.c.waitFor((m) => m.t === 'gate', 6000);
      assert(g1.waiting === true, `expected gate waiting:true, got ${JSON.stringify(g1)}`);
      guest.c.send({ t: 'buffering', waiting: false });
      const g2 = await host.c.waitFor((m) => m.t === 'gate' && m.waiting === false, 6000);
      assert(g2.waiting === false, 'expected gate waiting:false');
    } finally {
      cleanup();
    }
  });

  // The gate HOLDS until BOTH buffering members are ready (the "buffer until
  // everybody loads, then resume together" guarantee). Server only broadcasts
  // when the aggregate crosses 0↔N, so a single ready doesn't release early.
  await test('SYNC', 'gate holds until BOTH buffering members are ready', async () => {
    const code = await createRoom();
    const host = await joinRoom(code, 'V2 Host');
    const g1 = await joinRoom(code, 'V2 G1');
    const g2 = await joinRoom(code, 'V2 G2');
    try {
      g1.c.send({ t: 'buffering', waiting: true });
      await host.c.waitFor((m) => m.t === 'gate' && m.waiting === true, 6000);
      g2.c.send({ t: 'buffering', waiting: true }); // both buffering now
      await sleep(400); // ensure g2's buffering REGISTERS before g1 goes ready
      g1.c.send({ t: 'buffering', waiting: false }); // one ready, one still buffering
      await host.c.expectNone((m) => m.t === 'gate' && m.waiting === false, 1500); // must NOT release
      g2.c.send({ t: 'buffering', waiting: false }); // all ready
      await host.c.waitFor((m) => m.t === 'gate' && m.waiting === false, 6000); // now release
    } finally {
      host.c.close();
      g1.c.close();
      g2.c.close();
    }
  });
}

// A fake desktop host: opens the outbound tunnel and answers {t:'pull',id,path}
// with a synthetic HLS playlist / segment, counting pulls per path.
// proxyBase: when set, the fake host fetches `${proxyBase}/${path}` and relays the
// real bytes — exactly what apps/desktop-blissful/src/host_relay.rs does against
// the local stremio-service. When null, it answers with synthetic HLS.
async function fakeHost(room, key, proxyBase = null) {
  const ws = new WebSocket(`${CFG.partyRelayTunnel}?room=${encodeURIComponent(room)}&key=${encodeURIComponent(key)}`);
  const pullCounts = {};
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('tunnel connect timeout')), 8000);
    ws.once('open', () => {
      clearTimeout(t);
      res();
    });
    ws.once('error', (e) => {
      clearTimeout(t);
      rej(e);
    });
  });
  ws.on('message', async (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (m.t !== 'pull' || typeof m.id !== 'number') return;
    const p = String(m.path).split('?')[0];
    pullCounts[p] = (pullCounts[p] || 0) + 1;
    if (proxyBase) {
      try {
        const r = await fetch(`${proxyBase}/${m.path}`, { signal: AbortSignal.timeout(20000) });
        const buf = Buffer.from(await r.arrayBuffer());
        ws.send(JSON.stringify({ t: 'pulled', id: m.id, ok: true, status: r.status, contentType: r.headers.get('content-type'), bodyB64: buf.toString('base64') }));
      } catch {
        try {
          ws.send(JSON.stringify({ t: 'pulled', id: m.id, ok: false }));
        } catch {
          /* socket gone */
        }
      }
      return;
    }
    const isPlaylist = /\.m3u8$/i.test(p);
    const body = isPlaylist
      ? ['#EXTM3U', '#EXT-X-VERSION:3', '#EXTINF:4.0,', 'seg0.ts', '#EXT-X-ENDLIST'].join('\n')
      : 'FAKE-SEGMENT-BYTES';
    ws.send(
      JSON.stringify({
        t: 'pulled',
        id: m.id,
        ok: true,
        status: 200,
        contentType: isPlaylist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        bodyB64: Buffer.from(body).toString('base64'),
      }),
    );
  });
  return { ws, pullCounts, close: () => { try { ws.close(); } catch { /* ignore */ } } };
}

async function stremioAlive() {
  try {
    const r = await fetch(`${CFG.stremio}/settings`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function tierHLS() {
  await test('HLS', '/hlsv2 master playlist (localStremioHlsPath contract)', async () => {
    if (!(await stremioAlive())) return skip(`stremio-service not on ${CFG.stremio} (run the desktop shell or docker stremio/server)`);
    const media = 'https://media.w3.org/2010/05/sintel/trailer.webm';
    const u = `${CFG.stremio}/hlsv2/blissful-party/master.m3u8?mediaURL=${encodeURIComponent(media)}&maxWidth=3840`;
    const r = await fetch(u, { signal: AbortSignal.timeout(25000) });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    assert(/mpegurl/i.test(ct), `expected an m3u8 content-type, got ${ct}`);
    const t = await r.text();
    assert(/^#EXTM3U/.test(t.trim()), `not an m3u8: ${t.slice(0, 80)}`);
    assert(/\.m3u8/.test(t), 'master playlist has no variant sub-playlist');
  });
}

async function tierBR() {
  // Is the /party-relay handler deployed where we're pointing? Probe an unknown
  // room — the handler answers 404 'no host for room'; absence/other infra
  // answers differently.
  let live = false;
  try {
    const res = await fetch(`${CFG.partyRelay}/__probe__${rid()}/index.m3u8?k=x`, { signal: AbortSignal.timeout(8000) });
    const body = await res.text().catch(() => '');
    live = res.status === 404 && /no host for room/i.test(body);
  } catch {
    live = false;
  }
  const host = new URL(CFG.partyRelay).host;

  if (!live) {
    for (const n of ['unknown room → 404', 'wrong key → 403', 'playlist rewrite', 'segment cached']) {
      await test('BR', `/party-relay ${n}`, async () => skip(`relay handler not reachable on ${host} (Layer B not deployed there)`));
    }
    return;
  }

  await test('BR', '/party-relay unknown room → 404', async () => {
    const res = await fetch(`${CFG.partyRelay}/${rid()}/index.m3u8?k=x`, { signal: AbortSignal.timeout(8000) });
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  const room = 'e2e-' + Math.random().toString(36).slice(2, 8);
  const key = rid();
  let fake;
  try {
    fake = await fakeHost(room, key);
  } catch (err) {
    for (const n of ['wrong key → 403', 'playlist rewrite', 'segment cached']) {
      await test('BR', `/party-relay ${n}`, async () => skip(`tunnel not connectable: ${err.message}`));
    }
    return;
  }

  try {
    await test('BR', '/party-relay wrong key → 403', async () => {
      const res = await fetch(`${CFG.partyRelay}/${room}/index.m3u8?k=wrong`, { signal: AbortSignal.timeout(8000) });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test('BR', '/party-relay playlist rewrite (append k)', async () => {
      const res = await fetch(`${CFG.partyRelay}/${room}/index.m3u8?k=${key}`, { signal: AbortSignal.timeout(12000) });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const body = await res.text();
      assert(body.includes(`seg0.ts?k=${key}`), `segment URI not rewritten with key — got: ${body.slice(0, 160)}`);
    });

    await test('BR', '/party-relay segment cached (1 host pull for 2 GETs)', async () => {
      const u = `${CFG.partyRelay}/${room}/seg-cache.ts?k=${key}`;
      const r1 = await fetch(u, { signal: AbortSignal.timeout(12000) });
      await r1.arrayBuffer();
      const r2 = await fetch(u, { signal: AbortSignal.timeout(12000) });
      await r2.arrayBuffer();
      assert(r1.status === 200 && r2.status === 200, 'segment GET not 200');
      await sleep(300);
      assert(fake.pullCounts['seg-cache.ts'] === 1, `expected 1 host pull, got ${fake.pullCounts['seg-cache.ts']}`);
    });
  } finally {
    fake.close();
  }

  // Full Layer B with REAL transcoded HLS: a fake host that proxies to the local
  // stremio-service (exactly host_relay.rs) → guest pulls real /hlsv2 through the
  // relay → assert a valid, key-rewritten master playlist flows end to end.
  await test('BR', '/party-relay real stremio HLS end-to-end', async () => {
    if (!(await stremioAlive())) return skip(`stremio-service not on ${CFG.stremio}`);
    const room2 = 'e2e-' + Math.random().toString(36).slice(2, 8);
    const key2 = rid();
    const fake2 = await fakeHost(room2, key2, CFG.stremio);
    try {
      const media = 'https://media.w3.org/2010/05/sintel/trailer.webm';
      const u = `${CFG.partyRelay}/${room2}/hlsv2/blissful-party/master.m3u8?mediaURL=${encodeURIComponent(media)}&maxWidth=3840&k=${key2}`;
      const r = await fetch(u, { signal: AbortSignal.timeout(25000) });
      assert(r.status === 200, `expected 200, got ${r.status}`);
      const t = await r.text();
      assert(/^#EXTM3U/.test(t.trim()), `not an m3u8 through the relay: ${t.slice(0, 80)}`);
      assert(t.includes(`k=${key2}`), 'relay did not append k= to the rewritten playlist URIs');
    } finally {
      fake2.close();
    }
  });
}

// ---------- main -----------------------------------------------------------

async function main() {
  try {
    ({ WebSocket } = await import('ws'));
  } catch {
    console.error('\n[v2] the `ws` package is not installed. Run: npm install\n');
    process.exit(3);
  }

  log(`storage: ${CFG.storageWs}`);

  // Tier 0 — unit
  if (CFG.skipUnit) {
    results.push({ tier: '0', name: 'watchPartySource unit tests', status: 'SKIP', reason: 'SKIP_UNIT=1' });
  } else {
    log('0 · running watchPartySource unit tests (vitest)…');
    const u = await runUnit();
    if (u.code === 0) {
      results.push({ tier: '0', name: `watchPartySource unit tests${u.passed ? ` (${u.passed} passed)` : ''}`, status: 'PASS' });
      console.log(`[v2] 0 · unit tests PASS${u.passed ? ` (${u.passed})` : ''}`);
    } else {
      results.push({ tier: '0', name: 'watchPartySource unit tests', status: 'FAIL', reason: `vitest exit ${u.code}` });
      console.log(`[v2] 0 · unit tests FAIL (exit ${u.code})`);
    }
  }

  await tierA();
  await tierSync();
  await tierRdByHash();
  await tierB();
  await tierBR();
  await tierHLS();

  // ---- summary ----
  const by = (s) => results.filter((r) => r.status === s).length;
  console.log('\n================ WATCH-PARTY v2 SUITE ================');
  for (const r of results) {
    const tag = r.status === 'PASS' ? 'PASS' : r.status === 'SKIP' ? 'SKIP' : 'FAIL';
    console.log(`  [${tag}] ${r.tier} · ${r.name}${r.reason ? `  — ${r.reason}` : ''}`);
  }
  console.log('-----------------------------------------------------');
  console.log(`  ${by('PASS')} passed · ${by('FAIL')} failed · ${by('SKIP')} skipped  (of ${results.length})`);
  console.log('=====================================================');

  // Not-yet-coverable (documented gaps), so the report is honest about scope.
  console.log('\n  Remaining (genuinely needs a 2nd real device / live UI):');
  console.log('   - Same-file BEHAVIORAL in a live 2-player session (desktop torrent host + web guest');
  console.log('     landing on the same real file) — the resolution pieces (/rd-by-hash 200, source');
  console.log('     unit tests) + timeline sync (test:watchparty) are covered; only the full live');
  console.log('     2-player same-file integration is not automatable from one machine.');

  process.exit(by('FAIL') > 0 ? 1 : 0);
}

main();
