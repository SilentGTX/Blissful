// Tests for the Stremio WatchedBitField decoder. This is a regression magnet:
// the serialized form is an anchor id + a zlib-compressed, LSB-first bitfield
// (NOT a delimited id list), so a parsing/bit-order/anchor mistake silently
// shows the wrong episodes as watched. The first fixture is Stremio's own
// canonical test value (episodes 1-5 watched, 6 not).

import { describe, expect, it } from 'vitest';
import { decodeWatchedBitField } from './watchedBitfield';

const SERIES = 'tt2934286';
const ids = (n: number) => Array.from({ length: n }, (_, i) => `${SERIES}:1:${i + 1}`);

describe('decodeWatchedBitField', () => {
  it('decodes a real Stremio bitfield to the exact watched episodes', async () => {
    // "<anchorVideoId=tt2934286:1:5>:<anchorLength=5>:<base64 zlib bitfield>"
    const watched = await decodeWatchedBitField('tt2934286:1:5:5:eJyTZwAAAEAAIA==', ids(6));
    expect([...watched].sort()).toEqual([
      'tt2934286:1:1',
      'tt2934286:1:2',
      'tt2934286:1:3',
      'tt2934286:1:4',
      'tt2934286:1:5',
    ]);
    expect(watched.has('tt2934286:1:6')).toBe(false);
  });

  it('returns an empty set for empty / null / undefined input', async () => {
    expect((await decodeWatchedBitField('', ids(6))).size).toBe(0);
    expect((await decodeWatchedBitField(null, ids(6))).size).toBe(0);
    expect((await decodeWatchedBitField(undefined, ids(6))).size).toBe(0);
  });

  it('never throws + matches nothing for malformed / non-bitfield strings', async () => {
    // Legacy CSV-style value must NOT be mis-parsed as a list of watched ids.
    expect((await decodeWatchedBitField('tt1:1:1,tt1:1:2', ids(6))).size).toBe(0);
    // Too few components.
    expect((await decodeWatchedBitField('not-a-bitfield', ids(6))).size).toBe(0);
    // Valid anchor but invalid base64 payload -> atob throws -> caught -> empty.
    expect((await decodeWatchedBitField('tt2934286:1:1:2:!!!notbase64!!!', ids(6))).size).toBe(0);
  });

  it('returns an empty set when the anchor video id is absent from the list', async () => {
    const watched = await decodeWatchedBitField('ttZZZZ:9:9:5:eJyTZwAAAEAAIA==', ids(6));
    expect(watched.size).toBe(0);
  });

  it('returns an empty set when there are no ordered video ids', async () => {
    expect((await decodeWatchedBitField('tt2934286:1:5:5:eJyTZwAAAEAAIA==', [])).size).toBe(0);
  });
});
