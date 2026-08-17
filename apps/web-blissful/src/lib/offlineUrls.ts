// Offline playback URL shapes. Two representations, deliberately:
//
//   1. `offline:<downloadId>` — the APP-level URL. It's what the player route,
//      stream history and progress store see, so it round-trips through
//      `/player?url=…` and Continue-Watching like any other stream URL.
//   2. `https://offline.blissful.invalid/<downloadId>/index.m3u8` — the
//      HLS.JS-facing URL. hls.js resolves each segment URI against the
//      playlist's URL (`new URL(relative, playlistUrl)`), which needs a real
//      absolute URL with a host; a bare `offline:abc` custom scheme makes that
//      resolution throw. The `.invalid` TLD is reserved by RFC 6761 and can
//      never resolve to a real host, and our custom loader answers every
//      request from IndexedDB before any network call — so nothing is ever
//      sent anywhere. It exists purely to give hls.js a resolvable base.
//
// Only offlineHlsLoader.ts should ever see form (2).

export const OFFLINE_URL_PREFIX = 'offline:';

/** Host used for the internal hls.js URLs. RFC 6761 reserved — unroutable. */
export const OFFLINE_HLS_HOST = 'offline.blissful.invalid';

/** `offline:<id>` — the app-level URL stored in history / passed to the player. */
export function offlineAppUrl(downloadId: string): string {
  return `${OFFLINE_URL_PREFIX}${downloadId}`;
}

/** True for an app-level offline URL. */
export function isOfflineUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(OFFLINE_URL_PREFIX);
}

/** The download id inside an app-level offline URL, or null. */
export function offlineIdFromUrl(url: string | null | undefined): string | null {
  if (!isOfflineUrl(url)) return null;
  const id = (url as string).slice(OFFLINE_URL_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

/** The hls.js-facing playlist URL for a download. */
export function offlinePlaylistUrl(downloadId: string): string {
  return `https://${OFFLINE_HLS_HOST}/${encodeURIComponent(downloadId)}/index.m3u8`;
}

/** The hls.js-facing URL of segment `n`. Written into the stored playlist. */
export function offlineSegmentUrl(downloadId: string, index: number): string {
  return `https://${OFFLINE_HLS_HOST}/${encodeURIComponent(downloadId)}/${index}.ts`;
}

export type OfflineRef = { downloadId: string; segment: number | null };

/** Parse an hls.js-facing offline URL back into (downloadId, segment).
 *  `segment: null` means the playlist itself. Returns null for anything that
 *  isn't ours — the loader falls through to a network load in that case. */
export function parseOfflineHlsUrl(rawUrl: string): OfflineRef | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.hostname !== OFFLINE_HLS_HOST) return null;
  // "/<id>/<index>.ts" or "/<id>/index.m3u8"
  const parts = parsed.pathname.replace(/^\/+/, '').split('/');
  if (parts.length !== 2) return null;
  const downloadId = decodeURIComponent(parts[0]);
  if (!downloadId) return null;
  if (parts[1] === 'index.m3u8') return { downloadId, segment: null };
  const m = parts[1].match(/^(\d+)\.ts$/);
  if (!m) return null;
  return { downloadId, segment: Number.parseInt(m[1], 10) };
}
