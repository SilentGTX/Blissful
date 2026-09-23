'use strict';
// Regression test for the /transcode RD-link resolution guard.
// Run: node --test transcodeSrcResolution.test.js
//
// Guards the 2026-09-22 bug: torrentio answers a not-yet-ready torrent with a
// 302 back onto its own host, the resolver cached that as a real resolution,
// and every /transcode.m3u8 for the next 8 minutes returned 409 — so the player
// dropped to a progressive, non-seekable stream for the whole episode.

const test = require('node:test');
const assert = require('node:assert');
const { isResolvedOffHost } = require('./transcodeSrcResolution');

// The exact URLs from the incident.
const SRC = 'https://torrentio.strem.fun/resolve/realdebrid/KEY/0295ba041af050604818ec0320dbca87275b473a/null/151/Bleach%20-%20120.mkv';
const RD_DIRECT = 'https://43-4.download.real-debrid.com/d/XKD5BWHC4N3CS/Bleach%20-%20120.mkv';

test('a redirect onto the debrid CDN is a real resolution', () => {
  assert.strictEqual(isResolvedOffHost(SRC, RD_DIRECT), true);
});

test('a 302 back onto torrentio is the "not ready" relay, not a resolution', () => {
  // THE REGRESSION: caching this is what pinned /transcode.m3u8 to 409.
  assert.strictEqual(
    isResolvedOffHost(SRC, 'https://torrentio.strem.fun/relay/not-ready/0295ba04.mkv'),
    false
  );
});

test('no redirect at all (direct === src) is not a resolution', () => {
  // The resolver falls `direct` back to `src` on a 5xx / timeout / error.
  assert.strictEqual(isResolvedOffHost(SRC, SRC), false);
});

test('host comparison ignores path, query and scheme-relative differences', () => {
  assert.strictEqual(
    isResolvedOffHost('https://torrentio.strem.fun/resolve/x', 'https://torrentio.strem.fun/other?a=1'),
    false
  );
});

test('a different port on the same hostname still counts as off-host', () => {
  // URL.host includes the port, so these are genuinely different origins.
  assert.strictEqual(isResolvedOffHost('https://h.example:1/a', 'https://h.example:2/b'), true);
});

test('other debrid backends resolve off-host too (not real-debrid-specific)', () => {
  for (const direct of [
    'https://cdn.alldebrid.com/dl/abc/file.mkv',
    'https://sgp1.premiumize.me/dl/abc/file.mkv',
    'https://elfhosted.com/stream/abc.mkv',
  ]) {
    assert.strictEqual(isResolvedOffHost(SRC, direct), true, direct);
  }
});

test('unparseable input is never cached', () => {
  assert.strictEqual(isResolvedOffHost(SRC, 'not a url'), false);
  assert.strictEqual(isResolvedOffHost('not a url', RD_DIRECT), false);
  assert.strictEqual(isResolvedOffHost(SRC, ''), false);
});
