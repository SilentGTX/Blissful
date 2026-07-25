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
  const m = /\b([a-f0-9]{40})\b/i.exec(url ?? '');
  return m ? m[1].toLowerCase() : null;
}

/**
 * Auto-pick score. Cache state dominates everything, then continuity with the
 * release the user already has progress on, then transcode cost, then quality.
 *
 * The tier gap (50k) is deliberately larger than the continuity bonus (20k):
 * resuming the same release is nice, but not at the price of waiting for RD to
 * download it when a cached alternative exists.
 */
export function scoreReleaseForAutoPick(args: {
  name: string | null | undefined;
  title?: string | null;
  url?: string | null;
  /** Infohash of the release the user last played for this exact episode. */
  savedInfohash?: string | null;
}): number {
  const tier = releaseCacheTier(args.name);
  const cacheScore = tier === 'cached' ? 100_000 : tier === 'unknown' ? 50_000 : 0;
  const continuity =
    args.savedInfohash && extractInfohash(args.url) === args.savedInfohash ? 20_000 : 0;
  const hay = `${args.name ?? ''} ${args.title ?? ''}`;
  // HEVC/x265 transcodes far more expensively than H.264 on the Mac.
  const codec = /(^|[^a-z])(x265|h\.?265|hevc)([^a-z]|$)/i.test(hay) ? 0 : 1_000;
  const quality = /1080p/i.test(hay) ? 30 : /720p/i.test(hay) ? 25 : /2160p|4k/i.test(hay) ? 15 : 10;
  return cacheScore + continuity + codec + quality;
}
