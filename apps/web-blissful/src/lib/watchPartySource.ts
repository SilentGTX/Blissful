// watchPartySource.ts — Watch Party v2 "same-file" source identity.
//
// A room carries a platform-neutral `source` (WatchPartySource in
// watchParty.ts). The HOST announces what it's actually playing; each GUEST
// resolves that source ITS OWN WAY so everyone lands on the SAME file:
//
//   torrent  desktop: 127.0.0.1:11470/{hash}/{idx} via the bundled
//                     stremio-service (P2P, exact file).
//            web:     /rd-by-hash -> key-free RD direct link -> the web
//                     player wraps it in /transcode.m3u8 for <video>.
//   rd       desktop: play the raw RD link in mpv (full quality, no transcode).
//            web:     play the RD link (the player wraps it in /transcode.m3u8).
//   vidking  honestly unshareable — each web client resolves its own Vidking;
//            a non-web guest keeps its own torrent pick (timeline-only sync).
//   relay    Layer B (host-relayed HLS) — handled there.
//
// The parsing is pure + unit-tested; the resolvers are thin (one optional
// /rd-by-hash fetch). Navigation stays in the player components.

import type { WatchPartySource } from './watchParty';

const STREMIO_SERVER_URL = 'http://127.0.0.1:11470';

// Mirrors NativeMpvPlayer's DEFAULT_TRACKERS — used when the host announced a
// torrent source without an explicit tracker list.
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.openbittorrent.com:80/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
];

/** Does this URL look like a Real-Debrid direct download link? RD serves them
 *  from `*.download.real-debrid.com` (and occasionally `real-debrid.com`). */
export function looksLikeRdLink(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return /(^|\.)real-debrid\.com$/i.test(hostname);
  } catch {
    return false;
  }
}

/** A `/transcode.m3u8?url=<encoded inner>` wrapper → the decoded inner URL, or
 *  null if `value` isn't such a wrapper. The web player wraps RD/HEVC sources
 *  this way; we unwrap to announce the underlying shareable URL. */
export function unwrapTranscodeUrl(value: string): string | null {
  if (!/^\/transcode(\.m3u8)?\?/.test(value)) return null;
  try {
    const q = value.slice(value.indexOf('?') + 1);
    const inner = new URLSearchParams(q).get('url');
    return inner || null;
  } catch {
    return null;
  }
}

/** Parse `tt1234567:2:5` → `{ season: 2, episode: 5 }` (movies → empty). */
export function parseVideoIdSeasonEpisode(
  videoId: string | null | undefined,
): { season?: number; episode?: number } {
  if (!videoId) return {};
  const parts = videoId.split(':');
  if (parts.length < 3) return {};
  const season = Number.parseInt(parts[1], 10);
  const episode = Number.parseInt(parts[2], 10);
  const out: { season?: number; episode?: number } = {};
  if (Number.isInteger(season)) out.season = season;
  if (Number.isInteger(episode)) out.episode = episode;
  return out;
}

/**
 * DESKTOP host: turn the URL mpv is playing into a shareable source.
 *   - `http://127.0.0.1:11470/{40-hex}/{idx}?tr=…` → torrent
 *   - `magnet:?xt=urn:btih:{hash}&tr=…&fileIdx=N`   → torrent
 *   - a raw Real-Debrid https link                 → rd
 *   - anything else                                → null (unshareable)
 */
export function desktopPlayingUrlToSource(url: string | null | undefined): WatchPartySource {
  if (!url) return null;
  const m = url.match(/^https?:\/\/[^/]+\/([0-9a-fA-F]{40})\/(-?\d+)(?:\?(.*))?$/);
  if (m) {
    const infoHash = m[1].toLowerCase();
    const idx = Number.parseInt(m[2], 10);
    const trackers = m[3]
      ? new URLSearchParams(m[3]).getAll('tr').filter((t) => t.length > 0)
      : [];
    return {
      kind: 'torrent',
      infoHash,
      fileIdx: Number.isInteger(idx) && idx >= 0 ? idx : null,
      trackers: trackers.length ? trackers : undefined,
    };
  }
  if (url.startsWith('magnet:?')) {
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    const xt = params.get('xt') ?? '';
    const infoHash = xt.startsWith('urn:btih:') ? xt.slice('urn:btih:'.length).toLowerCase() : '';
    if (/^[0-9a-f]{40}$/.test(infoHash)) {
      const trackers = params.getAll('tr').filter((t) => t.length > 0);
      const rawIdx = params.get('fileIdx') ?? params.get('fileIndex');
      const idx = rawIdx === null ? NaN : Number.parseInt(rawIdx, 10);
      return {
        kind: 'torrent',
        infoHash,
        fileIdx: Number.isInteger(idx) && idx >= 0 ? idx : null,
        trackers: trackers.length ? trackers : undefined,
      };
    }
  }
  if (looksLikeRdLink(url)) return { kind: 'rd', rdUrl: url };
  return null;
}

/**
 * WEB host: derive the room source from the player's current state.
 *   - on a `/transcode.m3u8?url=<rd>` wrapper → rd (the underlying RD link)
 *   - a raw Real-Debrid link                  → rd
 *   - otherwise (Vidking placeholder) and we know the TMDB id → vidking
 *   - else → null
 */
export function webPlayingToSource(args: {
  url: string | null | undefined;
  tmdbId: number | null | undefined;
  type: 'movie' | 'series';
  videoId: string | null | undefined;
}): WatchPartySource {
  const { url, tmdbId, type, videoId } = args;
  if (url) {
    const inner = unwrapTranscodeUrl(url);
    if (inner && looksLikeRdLink(inner)) return { kind: 'rd', rdUrl: inner };
    if (looksLikeRdLink(url)) return { kind: 'rd', rdUrl: url };
  }
  if (tmdbId != null && Number.isInteger(tmdbId)) {
    const { season, episode } = parseVideoIdSeasonEpisode(videoId);
    return {
      kind: 'vidking',
      tmdbId,
      mediaType: type === 'series' ? 'tv' : 'movie',
      ...(season != null ? { season } : {}),
      ...(episode != null ? { episode } : {}),
    };
  }
  return null;
}

/** Build the stremio-service URL for a torrent source (desktop). null if the
 *  source has no file index (can't address a precise file). */
export function torrentToStreamingServerUrl(
  source: Extract<WatchPartySource, { kind: 'torrent' }>,
): string | null {
  if (source.fileIdx == null) return null;
  const trackers = source.trackers && source.trackers.length ? source.trackers : DEFAULT_TRACKERS;
  const tr = trackers.map((t) => `tr=${encodeURIComponent(t)}`).join('&');
  return `${STREMIO_SERVER_URL}/${source.infoHash}/${source.fileIdx}${tr ? `?${tr}` : ''}`;
}

/** Resolve a torrent infoHash to a key-free RD direct link via the proxy.
 *  Returns null on a cache miss (the guest then falls back). */
export async function rdByHash(
  infoHash: string,
  fileIdx: number | null,
): Promise<string | null> {
  try {
    const qs = new URLSearchParams({ infoHash });
    if (fileIdx != null) qs.set('fileIdx', String(fileIdx));
    const res = await fetch(`/rd-by-hash?${qs.toString()}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { url?: string; cached?: boolean };
    return json && typeof json.url === 'string' && /^https?:\/\//i.test(json.url) ? json.url : null;
  } catch {
    return null;
  }
}

/**
 * WEB guest: resolve a host source to a player `url` param (+ whether to set
 * `rdsel=1` so the page skips its own Vidking resolution and plays this exact
 * URL). Returns null when there's nothing to switch to (vidking / relay / miss
 * / null) — the guest keeps its own resolution (timeline-only sync).
 */
export async function resolveSourceForWeb(
  source: WatchPartySource,
): Promise<{ url: string; rdsel: boolean } | null> {
  if (!source) return null;
  if (source.kind === 'rd') return { url: source.rdUrl, rdsel: true };
  if (source.kind === 'torrent') {
    const direct = await rdByHash(source.infoHash, source.fileIdx);
    return direct ? { url: direct, rdsel: true } : null;
  }
  // Layer B: the host relays its exact stream as HLS through the Mac. The URL is
  // already an `…/party-relay/{room}/index.m3u8?k=` playlist — hls.js plays it
  // directly (no /transcode wrap), so pin it like an rd source.
  if (source.kind === 'relay') return { url: source.url, rdsel: true };
  // vidking → web guest keeps its own source (Vidking is unshareable).
  return null;
}

/**
 * DESKTOP guest: resolve a host source to a URL mpv can load. Prefers the P2P
 * stremio-service URL for torrents (exact file), falls back to a /rd-by-hash
 * direct link when no file index is known; plays raw RD links directly.
 * Returns null for vidking (keep our own torrent pick — timeline-only).
 */
export async function resolveSourceForDesktop(source: WatchPartySource): Promise<string | null> {
  if (!source) return null;
  if (source.kind === 'rd') return source.rdUrl;
  if (source.kind === 'torrent') {
    const direct = torrentToStreamingServerUrl(source);
    if (direct) return direct;
    // No file index — let RD pick the largest file and play that link in mpv.
    return rdByHash(source.infoHash, source.fileIdx);
  }
  return null;
}
