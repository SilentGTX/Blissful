// The release pack a series was last played from, so the next episode keeps it.
//
// Kept in playerSettings.seriesReleasePacks: playerSettings already syncs across
// devices through /state, and the storage server shallow-merges it, so a new key
// needs no backend change. Written implicitly by the player on first real
// playback (a manual pick of another release overwrites it); there is no UI.

import { readStoredPlayerSettings, writeStoredPlayerSettings, type PlayerSettings } from './playerSettings';

export type RememberedPack = { infohash: string; name: string; updatedAt: number };
type PackMap = Record<string, RememberedPack>;

export const MAX_REMEMBERED_SERIES = 200;
// An unchanged pack is not re-written on every episode (each write is a server
// sync), but it is refreshed this often so a series still being watched is not
// evicted as the oldest.
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function seriesKeyFor(type: string, id: string): string {
  return `${type}:${id}`;
}

/** Pure: `packs` with `pack` stored under `key`, oldest entries dropped past the cap. */
export function withRememberedPack(
  packs: PackMap | undefined,
  key: string,
  pack: { infohash: string; name: string },
  now: number,
): PackMap {
  const next: PackMap = { ...(packs ?? {}), [key]: { infohash: pack.infohash, name: pack.name, updatedAt: now } };
  const keys = Object.keys(next);
  if (keys.length > MAX_REMEMBERED_SERIES) {
    keys
      .sort((a, b) => next[a].updatedAt - next[b].updatedAt)
      .slice(0, keys.length - MAX_REMEMBERED_SERIES)
      .forEach((k) => { delete next[k]; });
  }
  return next;
}

function isPack(value: unknown): value is RememberedPack {
  const v = value as Partial<RememberedPack> | null;
  return !!v && typeof v.infohash === 'string' && v.infohash.length > 0;
}

export function getRememberedPack(seriesKey: string): RememberedPack | null {
  const hit = readStoredPlayerSettings().seriesReleasePacks?.[seriesKey];
  return isPack(hit) ? hit : null;
}

/**
 * Remember `pack` for `seriesKey`. `persist` should be the storage context's
 * savePlayerSettings so the change reaches the server; without it the pack is
 * only stored locally. Returns whether anything was written.
 */
export function rememberPack(
  seriesKey: string,
  pack: { infohash: string; name: string },
  persist?: (next: PlayerSettings) => unknown,
  now: number = Date.now(),
): boolean {
  const current = readStoredPlayerSettings();
  const existing = current.seriesReleasePacks?.[seriesKey];
  if (isPack(existing) && existing.infohash === pack.infohash && now - existing.updatedAt < REFRESH_AFTER_MS) {
    return false;
  }
  const next: PlayerSettings = {
    ...current,
    seriesReleasePacks: withRememberedPack(current.seriesReleasePacks, seriesKey, pack, now),
  };
  if (persist) persist(next);
  else writeStoredPlayerSettings(next);
  return true;
}
