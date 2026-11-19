'use strict';
// Unit tests for the Watch Party host-relay helpers.
// Run: node --test partyRelay.test.js
//
// Guards two 2026-11-19 findings from a live 4K party:
//   - the segment cache was capped by entry count only (400), so ~8-11 MB 4K
//     segments grew it to ~1.9 GB inside a 3.8 GB Docker VM;
//   - the relay URL announced to the room carried stremio's `mediaURL`, which
//     for a torrentio-RD stream embeds the HOST's Real-Debrid key — every guest
//     received it. The host now pins that query server-side.

const test = require('node:test');
const assert = require('node:assert');
const {
  createRelayCache,
  queryParamNames,
  relayHostPath,
  rewriteRelayUri,
  rewriteRelayPlaylist,
} = require('./partyRelay');

const buf = (n) => Buffer.alloc(n, 1);

test('cache: stays inside the byte budget, evicting oldest first', () => {
  const c = createRelayCache({ maxBytes: 100, maxEntries: 1000 });
  c.put('a', 't', buf(40), 60000);
  c.put('b', 't', buf(40), 60000);
  c.put('c', 't', buf(40), 60000); // 120 > 100 → 'a' goes
  assert.strictEqual(c.get('a'), null);
  assert.ok(c.get('b'));
  assert.ok(c.get('c'));
  assert.deepStrictEqual(c.stats(), { entries: 2, bytes: 80 });
});

test('cache: a 4K-sized run never exceeds the budget', () => {
  const budget = 600 * 1024 * 1024;
  const c = createRelayCache({ maxBytes: budget, maxEntries: 400 });
  // Same Buffer reused so the test itself stays small; the cache only counts length.
  const seg = buf(11 * 1024 * 1024);
  for (let i = 0; i < 500; i++) {
    c.put(`room\nvideo0/segment${i}.m4s`, 'video/mp4', seg, 120000);
    assert.ok(c.stats().bytes <= budget, `over budget at segment ${i}`);
  }
  assert.ok(c.get('room\nvideo0/segment499.m4s'), 'newest segment is kept');
  assert.strictEqual(c.get('room\nvideo0/segment0.m4s'), null, 'oldest segment is gone');
});

test('cache: entry cap still applies', () => {
  const c = createRelayCache({ maxBytes: 1e9, maxEntries: 3 });
  for (let i = 0; i < 5; i++) c.put(`k${i}`, 't', buf(1), 60000);
  assert.strictEqual(c.stats().entries, 3);
  assert.strictEqual(c.get('k0'), null);
  assert.ok(c.get('k4'));
});

test('cache: expired entries are dropped on get, on put, and by sweep', () => {
  let t = 1000;
  const c = createRelayCache({ maxBytes: 1000, maxEntries: 100, now: () => t });
  c.put('old', 't', buf(10), 50);
  c.put('keep', 't', buf(10), 5000);
  t += 100;
  assert.strictEqual(c.get('old'), null);
  c.put('old2', 't', buf(10), 50);
  t += 100;
  c.put('new', 't', buf(10), 5000); // put sweeps 'old2'
  assert.deepStrictEqual(c.stats(), { entries: 2, bytes: 20 });
  t += 10000;
  c.sweep();
  assert.deepStrictEqual(c.stats(), { entries: 0, bytes: 0 });
});

test('cache: replacing a key does not double-count its bytes', () => {
  const c = createRelayCache({ maxBytes: 1000, maxEntries: 100 });
  c.put('a', 't', buf(100), 60000);
  c.put('a', 't', buf(30), 60000);
  assert.deepStrictEqual(c.stats(), { entries: 1, bytes: 30 });
});

test('cache: purgePrefix drops one room only; oversize bodies are not cached', () => {
  const c = createRelayCache({ maxBytes: 100, maxEntries: 100 });
  c.put('r1\nx', 't', buf(10), 60000);
  c.put('r1\ny', 't', buf(10), 60000);
  c.put('r2\nx', 't', buf(10), 60000);
  c.purgePrefix('r1\n');
  assert.deepStrictEqual(c.stats(), { entries: 1, bytes: 10 });
  c.put('huge', 't', buf(101), 60000);
  assert.strictEqual(c.get('huge'), null);
  assert.ok(c.get('r2\nx'), 'an oversize put must not evict what is cached');
});

const MEDIA = 'https://torrentio.strem.fun/resolve/realdebrid/SECRETKEY/abc/null/0/Some%20Movie.mkv';
const HOST_QUERY = new URLSearchParams({ mediaURL: MEDIA, maxWidth: '3840' }).toString();

test('relayHostPath: legacy host (nothing pinned) forwards every param but the relay key', () => {
  const p = relayHostPath('hlsv2/x/master.m3u8', { mediaURL: MEDIA, maxWidth: '3840', k: 'KEY' }, '');
  assert.strictEqual(p, `hlsv2/x/master.m3u8?${HOST_QUERY}`);
});

test('relayHostPath: a pinned query is attached to key-only guest requests', () => {
  const p = relayHostPath('hlsv2/x/video0/segment7.m4s', { k: 'KEY' }, HOST_QUERY);
  assert.strictEqual(p, `hlsv2/x/video0/segment7.m4s?${HOST_QUERY}`);
});

test('relayHostPath: a guest cannot override a pinned param', () => {
  const p = relayHostPath('hlsv2/x/master.m3u8', { mediaURL: 'http://169.254.169.254/', k: 'KEY' }, HOST_QUERY);
  assert.strictEqual(p, `hlsv2/x/master.m3u8?${HOST_QUERY}`);
});

test('relayHostPath: pinned and legacy requests map to the SAME host path (one cache entry)', () => {
  const pinned = relayHostPath('hlsv2/x/video0/segment7.m4s', { k: 'KEY' }, HOST_QUERY);
  const legacy = relayHostPath('hlsv2/x/video0/segment7.m4s', { mediaURL: MEDIA, maxWidth: '3840', k: 'KEY' }, '');
  assert.strictEqual(pinned, legacy);
});

test('relayHostPath: unpinned guest params still pass through; no query → bare path', () => {
  assert.strictEqual(
    relayHostPath('hlsv2/x/a.m4s', { k: 'KEY', extra: '1' }, 'mediaURL=m'),
    'hlsv2/x/a.m4s?mediaURL=m&extra=1',
  );
  assert.strictEqual(relayHostPath('index.m3u8', { k: 'KEY' }, ''), 'index.m3u8');
});

test('rewriteRelayUri: appends the key; strips pinned params only', () => {
  const strip = queryParamNames(HOST_QUERY);
  assert.strictEqual(rewriteRelayUri(`video0.m3u8?${HOST_QUERY}`, 'KEY', strip), 'video0.m3u8?k=KEY');
  assert.strictEqual(rewriteRelayUri(`seg1.m4s?${HOST_QUERY}&x=1`, 'KEY', strip), 'seg1.m4s?x=1&k=KEY');
  assert.strictEqual(rewriteRelayUri('seg1.m4s', 'KEY', strip), 'seg1.m4s?k=KEY');
  // Legacy: nothing pinned → query kept, key appended.
  assert.strictEqual(rewriteRelayUri('seg1.m4s?a=b', 'KEY', null), 'seg1.m4s?a=b&k=KEY');
  // Absolute loopback URLs collapse to their path.
  assert.strictEqual(
    rewriteRelayUri('http://127.0.0.1:11470/hlsv2/x/seg1.m4s?a=b', 'KEY', null),
    'hlsv2/x/seg1.m4s?a=b&k=KEY',
  );
});

test('rewriteRelayPlaylist: no pinned param (or debrid key) survives into the guest playlist', () => {
  const strip = queryParamNames(HOST_QUERY);
  const playlist = [
    '#EXTM3U',
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="audio0.m3u8?${HOST_QUERY}"`,
    `#EXT-X-MAP:URI="video0/init.mp4?${HOST_QUERY}"`,
    '#EXTINF:4.0,',
    `video0/segment1.m4s?${HOST_QUERY}`,
    '',
  ].join('\n');
  const out = rewriteRelayPlaylist(playlist, 'KEY', strip);
  assert.ok(!out.includes('mediaURL'), out);
  assert.ok(!out.includes('SECRETKEY'), out);
  assert.ok(out.includes('URI="audio0.m3u8?k=KEY"'));
  assert.ok(out.includes('URI="video0/init.mp4?k=KEY"'));
  assert.ok(out.includes('\nvideo0/segment1.m4s?k=KEY\n'));
  assert.ok(out.includes('GROUP-ID="a"'), 'non-URI attributes untouched');
});
