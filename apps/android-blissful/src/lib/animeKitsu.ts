// Anime Kitsu — the `kitsu:` id scheme. Port of
// apps/web-blissful/src/lib/animeKitsu.ts; same recognition rules, adapted to
// the TV app, which tracks installed addons as transport URLs rather than full
// descriptors (see lib/addons.ts loadInstalledAddonUrls).
//
// The one addon whose content wants a different default audio language from the
// rest of the library (anime in its original Japanese), so the app needs to
// recognise both the addon and its ids.
//
// Kitsu content is recognised by id: the addon hands out `kitsu:<id>` for a show
// and `kitsu:<id>:<episode>` for an episode, and every downstream piece
// (streams, progress, next-episode, player params) keeps that prefix. The addon
// itself is recognised by a "kitsu" anywhere in its transport URL — the same
// loose test metaResolver and the web app use — so any of its deployments
// (anime-kitsu.strem.fun, self-hosted forks) count.

export const KITSU_ID_PREFIX = 'kitsu:';

/** True for an Anime Kitsu show or episode id (`kitsu:244`, `kitsu:244:3`). */
export function isKitsuId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.toLowerCase().startsWith(KITSU_ID_PREFIX);
}

/** True when the transport URL belongs to the Anime Kitsu addon. */
export function isKitsuAddonUrl(transportUrl: string | null | undefined): boolean {
  return typeof transportUrl === 'string' && transportUrl.toLowerCase().includes('kitsu');
}

/** True when Anime Kitsu is among the installed addon transport URLs. */
export function hasKitsuAddon(transportUrls: ReadonlyArray<string>): boolean {
  return transportUrls.some(isKitsuAddonUrl);
}
