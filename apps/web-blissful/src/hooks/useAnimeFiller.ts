// Filler map for an Anime Kitsu show — the React face of lib/animeFiller.
//
// Serves the localStorage copy synchronously (so badges are there on first
// paint for a show seen before) and refreshes it in the background when it is
// missing or stale. The shared fetch is deliberately NOT aborted on unmount:
// the detail page and the player both ask for the same show, and the result
// lands in the cache for whichever surface is mounted next.
//
// Returns null (feature invisible) for non-Kitsu content, when disabled in
// settings, before any data exists, and when MAL's episode count does not
// match the addon's list (a wrong mapping must not badge the wrong episodes).

import { useEffect, useMemo, useState } from 'react';
import {
  fetchFillerEpisodes,
  fillerEpisodesCompatible,
  kitsuEntryId,
  readCachedFillerEpisodes,
  type FillerEpisodes,
} from '../lib/animeFiller';

export function useAnimeFiller(params: {
  /** Show or episode id — anything `kitsu:`-prefixed qualifies. */
  metaId: string | null | undefined;
  /** How many episodes the addon lists (0 = unknown yet). */
  episodeCount: number;
  enabled: boolean;
}): FillerEpisodes | null {
  const { metaId, episodeCount, enabled } = params;
  const kitsuId = useMemo(() => (enabled ? kitsuEntryId(metaId) : null), [metaId, enabled]);
  const cached = useMemo(() => (kitsuId ? readCachedFillerEpisodes(kitsuId) : null), [kitsuId]);
  const [fetched, setFetched] = useState<{ kitsuId: string; data: FillerEpisodes | null } | null>(null);

  useEffect(() => {
    if (!kitsuId) return;
    if (cached && !cached.stale) return;
    let cancelled = false;
    fetchFillerEpisodes(kitsuId)
      .then((data) => {
        if (!cancelled) setFetched({ kitsuId, data });
      })
      .catch(() => {
        // Lookup failed — a stale cache entry (if any) keeps serving.
      });
    return () => {
      cancelled = true;
    };
  }, [kitsuId, cached]);

  const data = fetched && fetched.kitsuId === kitsuId ? fetched.data : cached?.data ?? null;
  return useMemo(
    () => (data && fillerEpisodesCompatible(data, episodeCount) ? data : null),
    [data, episodeCount],
  );
}
