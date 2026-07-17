'use strict';
// Videasy/Vidking sources decryptor — protocol v2 ("enc=2", seed-based).
//
// As of 2026-07-18 the sources API moved from api.videasy.to (now 404) to
// api.speedracelight.com and swapped its response cipher. The old CryptoJS
// payload + WASM decryptor (videasy-decrypt.js) no longer applies. The new
// flow, lifted from the Vidking player bundle
// (vidking.net/assets/VideoPlayer-*.js):
//
//   1. GET {origin}/seed?mediaId=<tmdbId>  ->  { seed, ttlMs }   (~30s TTL)
//   2. GET {origin}/<provider>/sources-with-title?...&enc=2&seed=<seed>
//   3. Decrypt: base64url-decode the body, XOR it with a keystream derived
//      from (seed, tmdbId), verify the 4-byte "mvm1" magic prefix, then the
//      remainder is the JSON { sources, subtitles } payload.
//
// The keystream helpers below are copied VERBATIM (only renamed for export)
// from the minified bundle so the 32-bit integer math — Math.imul, rotates,
// the sparse-state PRNG — is bit-identical to the client. `Af`/`wf`/`Hl`/`_f`
// are dead branches in the source (the `If(len)`/`bf(r)` gates are constant:
// len*(len+1) is always even) but are kept so this mirrors the original.

/* eslint-disable */
const _f = [1732584193, 4023233417, 2562383102, 271733878];
const Js = 61, Sf = 8, ms = 2654435769;
const Ys = [109, 118, 109, 49]; // "mvm1"
const bf = (l) => (l * (l + 1) & 1) === 0;
const If = (l) => (l * (l + 1) & 1) === 1;
const Hl = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580];

function ui(l) { return l >>>= 0, l ^= l >>> 16, l = Math.imul(l, 2246822507) >>> 0, l ^= l >>> 13, l = Math.imul(l, 3266489909) >>> 0, l ^= l >>> 16, l >>> 0; }
function ps(l, o) { return l >>>= 0, o &= 31, o === 0 ? l >>> 0 : (l << o | l >>> 32 - o) >>> 0; }
function Af(l) { let o = _f[0] >>> 0; for (let e = 0; e < l.length; e++) o = ps((o ^ Math.imul(l.charCodeAt(e), Hl[e & 15])) >>> 0, 5); return ui(o); }
function wf(l) { const o = new Array(256); for (let i = 0; i < 256; i++) o[i] = i; let e = 0; for (let i = 0; i < 256; i++) { e = e + o[i] + l.charCodeAt(i % l.length) & 255; const r = o[i]; o[i] = o[e], o[e] = r; } return o; }
function vf(l) { let o = 2166136261; for (let e = 0; e < l.length; e++) o = Math.imul(o ^ l.charCodeAt(e), 16777619) >>> 0; return ui(o); }
function Nf(l, o, e) { return ((l ^ o) >>> 0 | (l & o & e) >>> 0) >>> 0; }
function Rf(l, o) { if (If(l.length)) return { S: wf(l), acc: Af(l) }; const e = new Array(Js); let i = ui(vf(l) ^ ui(o >>> 0 ^ ms)) >>> 0; for (let r = 0; r < Sf; r++) if (bf(r)) { const n = i % Js; i = ps(i + ms >>> 0, 7 + (r & 7)), e[n] = (i ^ ui(i)) >>> 0, i = ui(i + n >>> 0); } else e[r] = Hl[r & 15]; return { S: e, acc: ui(i ^ 2779096485) >>> 0 }; }
function Cf(l, o) { const e = l.S; let i = l.acc; const r = i % Js, n = 0 - +(r in e), u = e[r] >>> 0, d = Math.imul(ms, o + 1) >>> 0; let g = Nf(i, (u ^ d) >>> 0, n); return g = (ps(g + i >>> 0, r & 31) ^ ps(i, Math.imul(r, 7) & 31)) >>> 0, i = ui(g + ms >>> 0), e[r] = i >>> 0, l.acc = i, i >>> 0; }
function xf(l, o, e) { const i = Rf(l, o), r = new Uint8Array(e); let n = 0; for (let u = 0; u < e;) { const d = Cf(i, n++); r[u++] = d & 255, u < e && (r[u++] = d >>> 8 & 255), u < e && (r[u++] = d >>> 16 & 255), u < e && (r[u++] = d >>> 24 & 255); } return r; }
function Df(l) { const o = l.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(l.length / 4) * 4, "="), e = atob(o), i = new Uint8Array(e.length); for (let r = 0; r < e.length; r++) i[r] = e.charCodeAt(r); return i; }
function Pf(l, o, e) { const i = Df(l), r = xf(o, e, i.length); for (let n = 0; n < i.length; n++) i[n] ^= r[n]; for (let n = 0; n < Ys.length; n++) if (i[n] !== Ys[n]) throw new Error("decrypt failed: bad seed or tampered payload"); return new TextDecoder("utf-8").decode(i.subarray(Ys.length)); }
/* eslint-enable */

/**
 * Decrypt an enc=2 sources-with-title response.
 * @param {string} responseText base64url ciphertext (the raw response body)
 * @param {string} seed the seed string from GET /seed?mediaId=<tmdbId>
 * @param {string|number} tmdbId the TMDB id used for this request
 * @returns {{ sources?: Array, subtitles?: Array, [k:string]: any }} parsed JSON
 */
function decryptVideasyV2(responseText, seed, tmdbId) {
  const json = Pf(String(responseText).trim(), String(seed), parseInt(String(tmdbId), 10));
  return JSON.parse(json);
}

module.exports = { decryptVideasyV2 };
