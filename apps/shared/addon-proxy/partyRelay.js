'use strict';
// Pure helpers for the Watch Party host relay (`/party-relay`). Kept out of
// server.js so they can be unit-tested: node --test partyRelay.test.js
//
// Three concerns live here:
//   1. the segment cache that fans one host fetch out to every guest — bounded
//      by BYTES, not just entry count (4K segments are ~8-11 MB each; an
//      entry-count cap alone let the cache grow to ~1.9 GB in a 3.8 GB VM);
//   2. building the path we pull from the host, with the host-registered query
//      (the stremio `mediaURL`, which can embed the host's debrid key) pinned
//      server-side so guests never see or choose it;
//   3. rewriting playlists so guest-facing URIs carry only the relay key.

/**
 * TTL + byte-budgeted cache. Insertion order is age order, so eviction drops
 * the oldest entries first. Expired entries are swept on every put and by
 * `sweep()` (server.js calls it on a timer so an idle party frees memory).
 */
function createRelayCache({ maxBytes, maxEntries, now = Date.now }) {
  const map = new Map(); // key -> { exp, contentType, body:Buffer }
  let bytes = 0;

  const drop = (key) => {
    const e = map.get(key);
    if (!e) return;
    bytes -= e.body.length;
    map.delete(key);
  };
  const sweep = () => {
    const t = now();
    for (const [k, e] of map) if (e.exp <= t) drop(k);
  };

  return {
    get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (e.exp <= now()) { drop(key); return null; }
      return e;
    },
    put(key, contentType, body, ttl) {
      drop(key);
      sweep();
      if (body.length > maxBytes) return; // bigger than the whole budget: don't cache
      while (map.size && (bytes + body.length > maxBytes || map.size >= maxEntries)) {
        drop(map.keys().next().value);
      }
      map.set(key, { exp: now() + ttl, contentType, body });
      bytes += body.length;
    },
    purgePrefix(prefix) {
      for (const k of Array.from(map.keys())) if (k.startsWith(prefix)) drop(k);
    },
    sweep,
    stats() { return { entries: map.size, bytes }; },
  };
}

/** Names of the params in a query string (`a=1&b=2` -> Set{a,b}). */
function queryParamNames(query) {
  return new Set(Array.from(new URLSearchParams(query || '').keys()));
}

/**
 * The path (+query) we ask the HOST for. `guestQuery` is the parsed query of the
 * guest's request (object, values string | string[]); `hostQuery` is the query
 * string the host registered for this relay, or '' when it registered none
 * (legacy hosts put everything in the guest-facing URL).
 *
 * Host-registered params always win and come first — a guest can neither see
 * nor override them. The relay key `k` is never forwarded.
 */
function relayHostPath(pathOnly, guestQuery, hostQuery) {
  const fwd = new URLSearchParams(hostQuery || '');
  const pinned = queryParamNames(hostQuery);
  for (const [pk, pv] of Object.entries(guestQuery || {})) {
    if (pk === 'k' || pinned.has(pk)) continue;
    const vals = Array.isArray(pv) ? pv : [pv];
    for (const v of vals) if (v != null) fwd.append(pk, String(v));
  }
  const qs = fwd.toString();
  return qs ? `${pathOnly}?${qs}` : pathOnly;
}

/**
 * Rewrite one playlist URI for the guest: absolute loopback URLs (the host's
 * 127.0.0.1:11470) collapse to their path so they route back through the
 * tunnel, params in `stripParams` (the host-registered ones) are removed, and
 * the relay key is appended so the follow-up fetch is authorised.
 */
function rewriteRelayUri(uri, key, stripParams) {
  let u = uri.trim();
  const abs = u.match(/^https?:\/\/[^/]+\/(.*)$/i);
  if (abs) u = abs[1];
  if (stripParams && stripParams.size) {
    const qi = u.indexOf('?');
    if (qi >= 0) {
      const kept = new URLSearchParams();
      for (const [k, v] of new URLSearchParams(u.slice(qi + 1))) {
        if (!stripParams.has(k)) kept.append(k, v);
      }
      const rest = kept.toString();
      u = u.slice(0, qi) + (rest ? `?${rest}` : '');
    }
  }
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}k=${encodeURIComponent(key)}`;
}

/** Rewrite every URI in an HLS playlist (URI lines + URI="..." attributes). */
function rewriteRelayPlaylist(text, key, stripParams) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        // EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA carry URI="..." attributes.
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${rewriteRelayUri(uri, key, stripParams)}"`);
      }
      return rewriteRelayUri(trimmed, key, stripParams);
    })
    .join('\n');
}

module.exports = {
  createRelayCache,
  queryParamNames,
  relayHostPath,
  rewriteRelayUri,
  rewriteRelayPlaylist,
};
