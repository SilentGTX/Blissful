// Real-Debrid cache state of a release, read from the addon's stream name.
//
// This matters more than any quality heuristic: a CACHED release starts
// instantly, while an uncached one makes RD download the torrent first — the
// player just sits there. So the auto-pick must treat "cached" as a hard tier,
// not a tiebreaker.
//
// Markers (same vocabulary the releases picker shows as CACHED / NOT CACHED):
//   Torrentio "[RD+]"            → cached, and empirically instant, so trusted.
//   "[RD download]" / "[RD↓]"    → explicitly NOT cached.
//   Comet "[RD⚡]"                → the addon's *claim*, from a stale public
//                                  cache guess (RD dropped /instantAvailability
//                                  in 2024) — treated as UNKNOWN, not cached.

export type CacheTier = 'cached' | 'unknown' | 'uncached';

export function isCachedRelease(name: string | null | undefined): boolean {
  return /\[\s*RD\s*\+/iu.test(name ?? '');
}

export function isUncachedRelease(name: string | null | undefined): boolean {
  return /\[\s*RD\s*(?:download|↓|⬇|⏳)/iu.test(name ?? '');
}

export function releaseCacheTier(name: string | null | undefined): CacheTier {
  if (isCachedRelease(name)) return 'cached';
  if (isUncachedRelease(name)) return 'uncached';
  return 'unknown';
}

/** The 40-hex BitTorrent infohash, which identifies the same torrent across
 *  every URL shape it arrives in (addon stream url, RD resolve url, magnet,
 *  local streaming-server path). Used to recognise "the release I was already
 *  watching" among a fresh set of candidates. */
export function extractInfohash(url: string | null | undefined): string | null {
  const raw = url ?? '';
  const direct = /\b([a-f0-9]{40})\b/i.exec(raw);
  if (direct) return direct[1].toLowerCase();
  // A url wrapped as /transcode.m3u8?url=<encoded release url> has the hash behind
  // a "%2F", where "F" is a word character and there is no \b in front of it.
  let decoded = raw;
  for (let i = 0; i < 2; i += 1) {
    try { decoded = decodeURIComponent(decoded); } catch { break; }
  }
  const m = /\b([a-f0-9]{40})\b/i.exec(decoded);
  return m ? m[1].toLowerCase() : null;
}
