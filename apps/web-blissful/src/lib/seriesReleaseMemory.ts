// The release pack the user picked BY HAND for a series, so the next episode keeps it.
//
// Kept in playerSettings.seriesReleasePacks: playerSettings already syncs across
// devices through /state, and the storage server shallow-merges it, so a new key
// needs no backend change. Only a hand pick is remembered (a row in the in-player
// Releases drawer, a stream chosen on the detail page); an auto-pick never writes
// here, and an entry without source 'manual' is ignored on read. There is no UI.

import { readStoredPlayerSettings, writeStoredPlayerSettings, type PlayerSettings } from './playerSettings';
import { extractInfohash } from './rdCache';

export type PackSource = 'manual' | 'auto';
export type RememberedPack = { infohash: string; name: string; updatedAt: number; source: 'manual' };
type PackMap = NonNullable<PlayerSettings['seriesReleasePacks']>;

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
  const next: PackMap = { ...(packs ?? {}), [key]: { infohash: pack.infohash, name: pack.name, updatedAt: now, source: 'manual' } };
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
  return !!v && v.source === 'manual' && typeof v.infohash === 'string' && v.infohash.length > 0;
}

export function getRememberedPack(seriesKey: string): RememberedPack | null {
  const hit = readStoredPlayerSettings().seriesReleasePacks?.[seriesKey];
  return isPack(hit) ? hit : null;
}

/** The remembered infohash out of an already-loaded settings map (same rules as
 *  getRememberedPack: hand picks only). */
export function rememberedInfohashFrom(
  packs: PlayerSettings['seriesReleasePacks'],
  seriesKey: string,
): string | null {
  const hit = packs?.[seriesKey];
  return isPack(hit) ? hit.infohash : null;
}

/**
 * Remember `pack` for `seriesKey`. Only `source: 'manual'` is stored; an auto-pick
 * returns false and touches nothing. `persist` should be the storage context's
 * savePlayerSettings so the change reaches the server; without it the pack is
 * only stored locally. Returns whether anything was written.
 */
export function rememberPack(
  seriesKey: string,
  pack: { infohash: string; name: string; source: PackSource },
  persist?: (next: PlayerSettings) => unknown,
  now: number = Date.now(),
): boolean {
  if (pack.source !== 'manual') return false;
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

type ReleaseRow = { url: string; infoHash?: string | null; torrentName?: string | null; name?: string | null };

/** Which release a RAW release url is (the url the picker row carries, never the
 *  /transcode.m3u8 wrapper the web player plays), and its infohash. The hash comes
 *  from the url, else from the row (house /rd-fallback urls carry none). */
export function resolvePlayingRelease(
  releases: readonly ReleaseRow[] | null | undefined,
  releaseUrl: string | null | undefined,
): { release: ReleaseRow | null; infohash: string | null; name: string } {
  if (!releaseUrl) return { release: null, infohash: null, name: '' };
  const urlHash = extractInfohash(releaseUrl);
  const release =
    releases?.find((r) => r.url === releaseUrl)
    ?? (urlHash ? releases?.find((r) => extractInfohash(r.url) === urlHash) : undefined)
    ?? null;
  return {
    release,
    infohash: urlHash ?? extractInfohash(release?.infoHash),
    name: release?.torrentName || release?.name || '',
  };
}

export function packRememberLine(key: string, infohash: string | null, source: PackSource, result: string): string {
  return `[player] pack remember key=${key} hash=${infohash ? `…${infohash.slice(-8)}` : 'none'} source=${source} result=${result}`;
}

/**
 * The user picked `releaseUrl` by hand for this series: remember its pack. Series
 * only. Always reports the outcome through `log` so the player log proves the write.
 */
export function rememberManualPick(
  args: {
    type: string | null | undefined;
    id: string | null | undefined;
    releaseUrl: string;
    releases: readonly ReleaseRow[] | null | undefined;
    fallbackName?: string;
  },
  persist?: (next: PlayerSettings) => unknown,
  log?: (line: string) => void,
): string {
  const key = seriesKeyFor(args.type ?? '', args.id ?? '');
  const { infohash, name } = resolvePlayingRelease(args.releases, args.releaseUrl);
  let result: string;
  if (!args.type || args.type === 'movie' || !args.id) result = 'skipped:not-series';
  else if (!infohash) result = 'skipped:no-infohash';
  else {
    const wrote = rememberPack(key, { infohash, name: name || args.fallbackName || '', source: 'manual' }, persist);
    result = wrote ? 'written' : 'skipped:unchanged';
  }
  log?.(packRememberLine(key, infohash, 'manual', result));
  return result;
}
