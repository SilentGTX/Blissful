// RD-ONLY Android (Tauri TV build): no local torrent streaming server, so
// only DIRECT http(s) streams (e.g. debrid CDN links) can play. magnet: URIs
// and local stremio-server (/stremio-server/...) URLs require the absent
// server and would silently fail. Shared by DetailPage.handleNavigateToPlayer
// and the sidebar Continue-Watching resume path so there is ONE definition.
export function isAndroidPlayableUrl(rawUrl: string | null): boolean {
  if (!rawUrl) return false;
  if (rawUrl.startsWith('magnet:')) return false;
  // normalizePlaybackUrl rewrites 127.0.0.1:11470/12470 -> /stremio-server/...
  if (rawUrl.includes('/stremio-server/')) return false;
  return /^https?:\/\//i.test(rawUrl);
}

// Copy shown when a stream can't play on the RD-only TV build because it
// needs the absent local streaming server. Hoisted here so DetailPage's
// inline RD modals and the global StreamUnavailableModal (fired by the
// Continue-Watching resume guard) use the SAME wording with no drift.
export const RD_REQUIRED_MESSAGE =
  'This source needs the local streaming server, which the TV app does not include. Pick a Real-Debrid (direct) stream instead.';
