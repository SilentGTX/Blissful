'use strict';
// Pure helpers for the /transcode RD-link resolution. Split out of server.js so
// they can be unit-tested without booting the proxy (same split as
// videasy-decrypt-v2.js).

/** Did a torrentio /resolve/ redirect actually hand back a debrid CDN link?
 *
 *  A torrent Real-Debrid hasn't finished minting a link for gets a 302 back onto
 *  torrentio's OWN host — its "not ready" relay. That is a redirect, but it is
 *  not a resolution, and caching it as one pinned /transcode.m3u8 to
 *  409 MEDIA_NOT_CACHED_YET for the whole TRANSCODE_SRC_TTL — long after RD had
 *  the link ready. The player takes a 409 as "this release is unavailable", so a
 *  single moment of RD lag cost the viewer seeking for the rest of the episode
 *  (observed 2026-09-22 on Bleach 120: cached 00:03:06, still 409 at 00:11:04,
 *  healthy 00:11:29 the instant the entry aged out).
 *
 *  A genuine resolution always leaves the source host, so that — rather than a
 *  hardcoded real-debrid.com — is the test: it holds for every debrid backend
 *  torrentio can front, and for the relay hosts it may add later.
 */
function isResolvedOffHost(src, direct) {
  try {
    return new URL(direct).host !== new URL(src).host;
  } catch {
    return false; // unparseable either side — never cache a mapping we can't verify
  }
}

module.exports = { isResolvedOffHost };
