// Tests for the guest-side HDR10 → SDR correction (lib/hdrToSdr.ts).
//
// The reference numbers were produced independently with numpy while
// validating the maths against two real screenshots of the same frame of
// The Hobbit (host in mpv vs a browser guest on the relay, 2026-11-19): the
// guest's face region averaged RGB 105/94/78 (grey), the host's 131/88/59, and
// this chain brings the guest's to ~147/103/69 — same hue, same saturation.

import { describe, expect, it } from 'vitest';
import {
  BT2020_TO_BT709,
  DECODE_MATRIX_FIX,
  buildHdrToSdrTable,
  feColorMatrixValues,
  feTableValues,
  nitsToPq,
  parseRelayHdr,
  pqToNits,
  relayHdrModeForGamma,
  relayHdrModeFromParam,
  toneMapPqToSdr,
  withRelayHdr,
} from './hdrToSdr';

type Rgb = [number, number, number];

/** The filter chain exactly as a browser runs it: 8-bit clamped between steps. */
function applyChain(rgb255: Rgb): Rgb {
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255) / 255;
  const mul = (m: number[][], v: number[]) => m.map((row) => q(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));
  const table = buildHdrToSdrTable(256);
  const lookup = (v: number) => {
    const pos = v * 255;
    const lo = Math.min(254, Math.floor(pos));
    return q(table[lo] + (table[lo + 1] - table[lo]) * (pos - lo));
  };
  const a = mul(DECODE_MATRIX_FIX, rgb255.map((v) => v / 255));
  const b = a.map(lookup);
  const c = mul(BT2020_TO_BT709, b);
  return c.map((v) => Math.round(v * 255)) as Rgb;
}

describe('PQ (SMPTE ST 2084)', () => {
  it('matches the standard reference points', () => {
    expect(nitsToPq(100)).toBeCloseTo(0.5081, 4);
    expect(nitsToPq(203)).toBeCloseTo(0.5807, 4);
    expect(nitsToPq(1000)).toBeCloseTo(0.7518, 4);
    expect(nitsToPq(10000)).toBeCloseTo(1, 6);
    expect(nitsToPq(0)).toBeCloseTo(0, 5); // c1^m2 ≈ 7e-7, not exactly 0
  });

  it('round-trips', () => {
    for (const nits of [0.01, 1, 50, 203, 1000, 4000]) {
      expect(pqToNits(nitsToPq(nits)) / nits).toBeCloseTo(1, 5);
    }
  });
});

describe('tone curve (BT.2390)', () => {
  it('maps black to black and the source peak to SDR white', () => {
    expect(toneMapPqToSdr(0)).toBe(0);
    expect(toneMapPqToSdr(nitsToPq(1000))).toBeCloseTo(1, 4);
    expect(toneMapPqToSdr(1)).toBeCloseTo(1, 4); // brighter than the assumed peak clips
  });

  it('leaves everything below the knee untouched (ordinary scene brightness)', () => {
    // 50 nits is well under the ~92-nit knee for a 1000-nit source on a 203-nit display.
    const srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    expect(toneMapPqToSdr(nitsToPq(50))).toBeCloseTo(srgb(50 / 203), 4);
    expect(toneMapPqToSdr(nitsToPq(5))).toBeCloseTo(srgb(5 / 203), 4);
  });

  it('compresses highlights instead of clipping them', () => {
    const at300 = toneMapPqToSdr(nitsToPq(300));
    const at600 = toneMapPqToSdr(nitsToPq(600));
    expect(at300).toBeGreaterThan(toneMapPqToSdr(nitsToPq(150)));
    expect(at600).toBeGreaterThan(at300);
    expect(at600).toBeLessThan(1);
  });

  it('builds a monotonic table that spans 0..1', () => {
    const table = buildHdrToSdrTable(256);
    expect(table).toHaveLength(256);
    expect(table[0]).toBe(0);
    expect(table[255]).toBeCloseTo(1, 4);
    for (let i = 1; i < table.length; i += 1) expect(table[i]).toBeGreaterThanOrEqual(table[i - 1]);
  });
});

describe('matrices', () => {
  it('decode-matrix fix equals the independently computed reference', () => {
    const ref = [
      [0.9499, 0.04551, 0.00459],
      [-0.05422, 1.03811, 0.01612],
      [-0.00296, -0.00994, 1.0129],
    ];
    DECODE_MATRIX_FIX.forEach((row, r) => row.forEach((v, c) => expect(v).toBeCloseTo(ref[r][c], 4)));
  });

  it('both matrices keep greys grey (rows sum to 1)', () => {
    for (const m of [DECODE_MATRIX_FIX, BT2020_TO_BT709]) {
      for (const row of m) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 4);
    }
  });

  it('serialises for SVG', () => {
    const values = feColorMatrixValues(BT2020_TO_BT709).split(' ');
    expect(values).toHaveLength(20);
    expect(values.slice(15)).toEqual(['0', '0', '0', '1', '0']); // alpha passes through
    expect(Number(values[0])).toBeCloseTo(1.660491, 6);
    expect(feTableValues([0, 0.5, 1])).toBe('0 0.5 1');
  });
});

describe('the whole chain on real pixels', () => {
  it('turns the washed-out skin tone back into a warm one', () => {
    const [r, g, b] = applyChain([105, 94, 78]); // guest face average, as received
    expect(r / g).toBeGreaterThan(1.35); // host: 131/88 = 1.49 — was 1.12 before
    expect(b / g).toBeLessThan(0.72); // host: 59/88 = 0.67 — was 0.83 before
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(175);
  });

  it('keeps neutral greys neutral and black black', () => {
    expect(applyChain([0, 0, 0])).toEqual([0, 0, 0]);
    const [r, g, b] = applyChain([128, 128, 128]);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - g)).toBeLessThanOrEqual(1);
  });

  it('raises contrast: mid PQ grey is far brighter than dark PQ grey', () => {
    // As received, PQ video looks flat. 8-bit 128 is ~100 nits, 64 is ~5 nits.
    const dark = applyChain([64, 64, 64])[1];
    const mid = applyChain([128, 128, 128])[1];
    expect(mid - dark).toBeGreaterThan(128 - 64);
  });
});

describe('relay URL marker', () => {
  const url = 'https://blissful.budinoff.com/party-relay/abc-def/hlsv2/blissful-party/master.m3u8?k=key';

  it('only PQ needs correcting', () => {
    expect(relayHdrModeForGamma('pq')).toBe('pq');
    expect(relayHdrModeForGamma('hlg')).toBeNull();
    expect(relayHdrModeForGamma('bt.1886')).toBeNull();
    expect(relayHdrModeForGamma(null)).toBeNull();
  });

  it('adds, replaces and removes the marker without touching the URL', () => {
    expect(withRelayHdr(url, 'pq')).toBe(`${url}#hdr=pq`);
    expect(withRelayHdr(`${url}#hdr=pq`, 'pq')).toBe(`${url}#hdr=pq`);
    expect(withRelayHdr(`${url}#hdr=pq`, null)).toBe(url);
    expect(withRelayHdr(url, null)).toBe(url);
  });

  it('parses the marker and returns the URL to load without it', () => {
    expect(parseRelayHdr(`${url}#hdr=pq`)).toEqual({ url, hdr: 'pq' });
    expect(parseRelayHdr(url)).toEqual({ url, hdr: null });
    expect(parseRelayHdr(`${url}#hdr=dolby`)).toEqual({ url, hdr: null });
    expect(parseRelayHdr(`${url}#other=1`)).toEqual({ url, hdr: null });
  });

  it('reads the player-URL param defensively', () => {
    expect(relayHdrModeFromParam('pq')).toBe('pq');
    expect(relayHdrModeFromParam('1')).toBeNull();
    expect(relayHdrModeFromParam(null)).toBeNull();
  });
});
