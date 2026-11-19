// hdrToSdr.ts — browser-side HDR10 → SDR correction for the watch-party relay.
//
// WHY: a desktop host relays its playback as H.264 (stremio-service /hlsv2).
// For an HDR10 / Dolby Vision source that transcode squeezes BT.2020 + PQ
// 10-bit video into 8-bit H.264 WITHOUT converting the colours and without
// tagging them, so a guest's browser decodes it as ordinary BT.709 video: grey,
// flat, desaturated (2026-11-19 — the host saw The Hobbit correctly in mpv, the
// guest got a "black and white almost" picture).
//
// The proper place to tone-map is the host's transcode (10-bit source), which
// needs a desktop release. This module fixes it on the guest instead, with a
// CSS/SVG filter on the <video>: no extra work for the host, applies to every
// released shell, runs on the guest's GPU.
//
// HOW: three SVG filter primitives, all in the ENCODED domain so the browser's
// 8-bit filter intermediates don't crush the shadows (a linear-light step in
// 8 bits would):
//   1. feColorMatrix  — undo "BT.2020 YCbCr decoded with the BT.709 matrix"
//                       (exact: that mix-up is linear in encoded R'G'B').
//   2. feComponentTransfer (table) — per channel: PQ signal → nits → BT.2390
//                       tone curve → sRGB signal, as ONE 1-D table.
//   3. feColorMatrix  — BT.2020 → BT.709 primaries. Strictly a linear-light
//                       operation; applied to gamma-encoded values it is an
//                       approximation (measured on real film colours: mean
//                       error ≈ 1/255, p95 ≈ 4/255 against the exact maths).
// The host marks an HDR relay with a `#hdr=pq` fragment on the relay URL — a
// fragment is never sent to a server and survives the storage sanitizer.

/** HDR transfer the relay stream still carries. Only PQ (HDR10 / HDR10+ / DV
 *  with an HDR10 base layer) needs correcting; HLG is watchable as SDR. */
export type RelayHdrMode = 'pq';

export const HDR_TO_SDR_FILTER_ID = 'bliss-hdr-pq-to-sdr';

// ---- SMPTE ST 2084 (PQ) ----------------------------------------------------
const PQ_M1 = 2610 / 16384;
const PQ_M2 = (2523 / 4096) * 128;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = (2413 / 4096) * 32;
const PQ_C3 = (2392 / 4096) * 32;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** PQ signal [0,1] → absolute luminance in nits (cd/m²). */
export function pqToNits(signal: number): number {
  const e = Math.pow(clamp01(signal), 1 / PQ_M2);
  return 10000 * Math.pow(Math.max(e - PQ_C1, 0) / (PQ_C2 - PQ_C3 * e), 1 / PQ_M1);
}

/** Absolute luminance in nits → PQ signal [0,1]. */
export function nitsToPq(nits: number): number {
  const y = Math.pow(Math.min(Math.max(nits, 0), 10000) / 10000, PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * y) / (1 + PQ_C3 * y), PQ_M2);
}

function srgbEncode(linear: number): number {
  const v = clamp01(linear);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export type ToneMapOptions = {
  /** Brightest the source is assumed to reach. The relay carries no HDR
   *  metadata; 1000 nits is the common mastering peak. Brighter content clips. */
  sourcePeakNits?: number;
  /** Luminance shown as SDR white — 203 nits, the BT.2408 reference white (and
   *  what mpv targets on an SDR display, so guests match the host). */
  displayWhiteNits?: number;
};

/**
 * One channel: PQ-encoded value → sRGB-encoded SDR value, through the BT.2390
 * EETF (identity below the knee, Hermite roll-off of the highlights above it).
 */
export function toneMapPqToSdr(signal: number, opts: ToneMapOptions = {}): number {
  const sourcePeak = opts.sourcePeakNits ?? 1000;
  const displayWhite = opts.displayWhiteNits ?? 203;
  const lw = nitsToPq(sourcePeak);
  const e1 = clamp01(clamp01(signal) / lw);
  const maxLum = nitsToPq(displayWhite) / lw;
  const ks = 1.5 * maxLum - 0.5;
  let e2 = e1;
  if (e1 >= ks) {
    const t = clamp01((e1 - ks) / (1 - ks));
    const t2 = t * t;
    const t3 = t2 * t;
    e2 = (2 * t3 - 3 * t2 + 1) * ks + (t3 - 2 * t2 + t) * (1 - ks) + (-2 * t3 + 3 * t2) * maxLum;
  }
  return srgbEncode(pqToNits(e2 * lw) / displayWhite);
}

/** The 1-D table for feComponentTransfer (`type="table"` interpolates linearly
 *  between points; 256 points is exact for 8-bit input). */
export function buildHdrToSdrTable(points = 256, opts: ToneMapOptions = {}): number[] {
  const out: number[] = [];
  for (let i = 0; i < points; i += 1) out.push(toneMapPqToSdr(i / (points - 1), opts));
  return out;
}

// ---- matrices --------------------------------------------------------------
type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

/** R'G'B' → Y'CbCr for luma coefficients (Kr, Kb). */
function ycbcrMatrix(kr: number, kb: number): Mat3 {
  const kg = 1 - kr - kb;
  return [
    [kr, kg, kb],
    [-kr / (2 * (1 - kb)), -kg / (2 * (1 - kb)), 0.5],
    [0.5, -kg / (2 * (1 - kr)), -kb / (2 * (1 - kr))],
  ];
}

/** Y'CbCr → R'G'B' for luma coefficients (Kr, Kb). */
function rgbFromYcbcrMatrix(kr: number, kb: number): Mat3 {
  const kg = 1 - kr - kb;
  return [
    [1, 0, 2 * (1 - kr)],
    [1, (-2 * kb * (1 - kb)) / kg, (-2 * kr * (1 - kr)) / kg],
    [1, 2 * (1 - kb), 0],
  ];
}

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as Mat3;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
    }
  }
  return out;
}

/**
 * The browser turned BT.2020 Y'CbCr into R'G'B' with the BT.709 matrix. This
 * puts it right: back to Y'CbCr the way the browser came from it (709), then
 * to R'G'B' the way it was actually encoded (2020).
 */
export const DECODE_MATRIX_FIX: Mat3 = multiply(
  rgbFromYcbcrMatrix(0.2627, 0.0593),
  ycbcrMatrix(0.2126, 0.0722),
);

/** BT.2020 → BT.709 primaries (ITU-R BT.2087). */
export const BT2020_TO_BT709: Mat3 = [
  [1.660491, -0.587641, -0.07285],
  [-0.12455, 1.1329, -0.008349],
  [-0.018151, -0.100579, 1.11873],
];

/** A 3×3 colour matrix as feColorMatrix `values` (4×5, alpha untouched). */
export function feColorMatrixValues(m: Mat3): string {
  const f = (n: number) => Number(n.toFixed(6)).toString();
  return [
    `${f(m[0][0])} ${f(m[0][1])} ${f(m[0][2])} 0 0`,
    `${f(m[1][0])} ${f(m[1][1])} ${f(m[1][2])} 0 0`,
    `${f(m[2][0])} ${f(m[2][1])} ${f(m[2][2])} 0 0`,
    '0 0 0 1 0',
  ].join(' ');
}

/** `tableValues` for the tone table. */
export function feTableValues(table: number[]): string {
  return table.map((v) => Number(v.toFixed(5)).toString()).join(' ');
}

// ---- the relay URL marker ---------------------------------------------------

/** mpv's `video-params/gamma` → the mode a guest must correct for, if any. */
export function relayHdrModeForGamma(gamma: string | null | undefined): RelayHdrMode | null {
  return gamma === 'pq' ? 'pq' : null;
}

/** Add/replace/remove the `#hdr=…` marker on a relay URL. */
export function withRelayHdr(url: string, mode: RelayHdrMode | null): string {
  const hash = url.indexOf('#');
  const base = hash >= 0 ? url.slice(0, hash) : url;
  return mode ? `${base}#hdr=${mode}` : base;
}

/** Split a relay URL into the URL to load (no fragment) and its HDR marker. */
export function parseRelayHdr(url: string): { url: string; hdr: RelayHdrMode | null } {
  const hash = url.indexOf('#');
  if (hash < 0) return { url, hdr: null };
  const mode = new URLSearchParams(url.slice(hash + 1)).get('hdr');
  return { url: url.slice(0, hash), hdr: mode === 'pq' ? 'pq' : null };
}

/** The `hdr` player-URL param → a mode (anything unknown is "no correction"). */
export function relayHdrModeFromParam(value: string | null | undefined): RelayHdrMode | null {
  return value === 'pq' ? 'pq' : null;
}
