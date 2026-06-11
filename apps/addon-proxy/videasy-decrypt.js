'use strict';

// Server-side decryptor for Videasy /sources-with-title responses.
// Mirrors walterwhite-69/Videasy.net-Decryptor (decrypt.js + module.wasm)
// — WASM module exposes serve()/verify()/decrypt(), driven by an
// in-process fake-window context. After WASM stage we run CryptoJS
// AES.decrypt with an empty passphrase to get the JSON plaintext.
//
// Origin spoofing: the WASM `verify(hash)` step rejects hashes that
// aren't derived from a known partner hostname. cineby.sc is the
// canonical one and works as of writing.

const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const CryptoJS = require('crypto-js');

const WASM_PATH = path.join(__dirname, 'videasy-module.wasm');
let cachedBuf = null;

function getWasmBytes() {
  if (!cachedBuf) cachedBuf = fs.readFileSync(WASM_PATH);
  return cachedBuf;
}

function readString(memory, ptr) {
  if (!ptr) return null;
  const u32 = new Uint32Array(memory.buffer);
  const u16 = new Uint16Array(memory.buffer);
  const endOffStr = ptr + u32[(ptr - 4) >>> 2];
  const tEnd = endOffStr >>> 1;
  let nStart = ptr >>> 1;
  if (tEnd - nStart > 5_000_000 || tEnd - nStart < 0) return null;
  let s = '';
  for (; tEnd - nStart > 1024; ) {
    s += String.fromCharCode(...u16.subarray(nStart, (nStart += 1024)));
  }
  return s + String.fromCharCode(...u16.subarray(nStart, tEnd));
}

function writeString(exp, memory, str) {
  const ptr = exp.__new(str.length << 1, 2) >>> 0;
  const u16 = new Uint16Array(memory.buffer);
  for (let i = 0; i < str.length; i++) u16[(ptr >>> 1) + i] = str.charCodeAt(i);
  return ptr;
}

async function decryptVideasyResponse(ciphertextHex, tmdbId) {
  const wasmBytes = getWasmBytes();
  const env = {
    seed: () => Date.now() * Math.random(),
    abort() {
      /* swallow */
    },
  };
  const { instance } = await WebAssembly.instantiate(wasmBytes, { env });
  const exp = instance.exports;
  const memory = exp.memory;

  // serve() returns a chunk of obfuscated JS. eval it inside a
  // sandboxed fake-window so it can compute window.hash.
  const servePtr = exp.serve() >>> 0;
  let serveCode = readString(memory, servePtr);
  if (!serveCode) throw new Error('serve() returned empty');
  // Same workaround as the reference impl — strips a defensive
  // self-call wrapper that throws under Node.
  serveCode = serveCode.replace(/_0x24\(\),_0x36\(/g, '_0x36(');

  const fakeWindow = {
    location: { hostname: 'cineby.sc', href: 'https://cineby.sc/' },
  };
  const fn = new Function('window', 'crypto', 'TextEncoder', serveCode);
  fn(fakeWindow, webcrypto, TextEncoder);

  // Give async hash-derivation a tick to complete.
  await new Promise((r) => setTimeout(r, 100));
  const hash = String(fakeWindow.hash);
  if (!hash || hash === 'undefined') throw new Error('Failed to derive window.hash');

  const hashPtr = writeString(exp, memory, hash);
  if (!exp.verify(hashPtr)) throw new Error('WASM verify(hash) failed');

  const ctPtr = writeString(exp, memory, ciphertextHex);
  const resPtr = exp.decrypt(ctPtr, parseInt(tmdbId, 10)) >>> 0;
  const wasmDecryptedStr = readString(memory, resPtr);
  if (!wasmDecryptedStr) throw new Error('WASM decrypt returned null');

  const pt = CryptoJS.AES.decrypt(wasmDecryptedStr, '').toString(CryptoJS.enc.Utf8);
  if (!pt) throw new Error('AES decrypt yielded empty string');
  return JSON.parse(pt);
}

module.exports = { decryptVideasyResponse };
