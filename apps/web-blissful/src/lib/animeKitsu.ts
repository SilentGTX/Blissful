// Anime Kitsu — the `kitsu:` id scheme. The one addon whose content wants a
// different default audio language from the rest of the library (anime in its
// original Japanese), so the app needs to recognise both the addon and its ids.
//
// Kitsu content is recognised by id: the addon hands out `kitsu:<id>` for a
// show and `kitsu:<id>:<episode>` for an episode, and every downstream piece
// (streams, progress, next-episode, player URLs) keeps that prefix. The addon
// itself is recognised the way `useMetaDetails` and the search page already do
// it — a "kitsu" anywhere in its transport URL, manifest id or name — so any of
// its deployments (anime-kitsu.strem.fun, self-hosted forks) count.

import type { AddonDescriptor } from './mediaTypes';

export const KITSU_ID_PREFIX = 'kitsu:';

type AddonLike = Pick<AddonDescriptor, 'transportUrl' | 'manifest'>;

/** True for an Anime Kitsu show or episode id (`kitsu:244`, `kitsu:244:3`). */
export function isKitsuId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.toLowerCase().startsWith(KITSU_ID_PREFIX);
}

/** True when the descriptor is the Anime Kitsu addon. */
export function isKitsuAddon(addon: AddonLike): boolean {
  const hay = `${addon.transportUrl ?? ''} ${addon.manifest?.id ?? ''} ${addon.manifest?.name ?? ''}`.toLowerCase();
  return hay.includes('kitsu');
}

/** True when the Anime Kitsu addon is among the installed addons. */
export function hasKitsuAddon(addons: ReadonlyArray<AddonLike>): boolean {
  return addons.some(isKitsuAddon);
}
