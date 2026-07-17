'use strict';
// Regression test for the enc=2 (seed-based) Videasy sources decryptor.
// Run: node --test videasy-decrypt-v2.test.js
//
// The fixture (videasy-v2.fixture.json) is a REAL response captured from
// api.speedracelight.com/cdn/sources-with-title, frozen with the exact seed
// and tmdbId it was fetched with. decryptVideasyV2 is a pure function that
// never re-contacts the API, so the seed expiring (~30s TTL) does not matter —
// the ciphertext decrypts deterministically forever. This guards the ported
// 32-bit keystream math (videasy-decrypt-v2.js) against accidental edits: any
// change to ui/ps/vf/Rf/Cf/xf/Pf breaks the "mvm1" magic-prefix check and this
// test fails loudly.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decryptVideasyV2 } = require('./videasy-decrypt-v2');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'videasy-v2.fixture.json'), 'utf8')
);

test('decrypts a real captured enc=2 payload into { sources, subtitles }', () => {
  const payload = decryptVideasyV2(fixture.ciphertext, fixture.seed, fixture.tmdbId);
  assert.ok(Array.isArray(payload.sources), 'sources is an array');
  assert.ok(payload.sources.length > 0, 'has at least one source');
  assert.ok(Array.isArray(payload.subtitles), 'subtitles is an array');
  for (const s of payload.sources) {
    assert.ok(typeof s.url === 'string' && /^https?:\/\//.test(s.url), 'source url is absolute http(s)');
  }
});

test('throws on a wrong seed (magic-prefix guard catches bad keystream)', () => {
  const badSeed = `${fixture.seed}x`; // any altered seed yields a different keystream
  assert.throws(
    () => decryptVideasyV2(fixture.ciphertext, badSeed, fixture.tmdbId),
    /decrypt failed/,
    'a mismatched seed must be rejected, not returned as garbage'
  );
});

test('throws on a wrong tmdbId (tmdbId is part of the key)', () => {
  assert.throws(
    () => decryptVideasyV2(fixture.ciphertext, fixture.seed, '1'),
    /decrypt failed/
  );
});
