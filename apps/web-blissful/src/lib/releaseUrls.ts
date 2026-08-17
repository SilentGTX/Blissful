// Small predicates about release URLs, in their own module so the download modal
// can use them without pulling in the downloader.

/** Torrentio answers with a placeholder clip — `/videos/failed_unexpected_v2.mp4`
 *  and friends — when it can't resolve a release (Real-Debrid throttling a burst
 *  of link mints is the usual cause). It's a few hundred KB of error message, and
 *  it looks like the smallest possible file to a smallest-first ranker, so it
 *  would win every time. Never offer one as a download.
 *
 *  Observed live: two episodes resolved back-to-back, and the first came back as
 *  `https://torrentio.strem.fun/videos/failed_unexpected_v2.mp4`. */
export function isPlaceholderUrl(url: string): boolean {
  return /\/videos\/[a-z0-9_-]*failed/i.test(url);
}
