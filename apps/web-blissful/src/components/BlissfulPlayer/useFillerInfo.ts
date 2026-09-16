// Filler awareness for the player: which run (if any) the CURRENT episode sits
// in, and which run the NEXT episode would start. Both are derived from one
// filler map per title (lib/fillerList), fetched once per title.
//
// Two consumers:
//   * FillerBanner — "this episode is filler, skip to Ep N" while a filler
//     episode plays;
//   * the advance gate in BlissfulPlayer — "the next N episodes are filler,
//     watch anyway / skip" when Next (button or auto-advance) would step INTO a
//     run from a canon episode.
//
// "Accepted" is per run, keyed by the run's first episode, in sessionStorage:
// choosing "Watch anyway" once covers the whole run, so a viewer who commits to
// an arc isn't asked again at every episode. The helpers are module functions
// (not closures returned by the hook) so callers can list them in useCallback
// deps without the callback churning every render.

import { useEffect, useMemo, useState } from 'react';
import {
  fetchFillerMap,
  fillerRunContaining,
  episodeNumberOf,
  type EpisodeLike,
  type FillerMap,
  type FillerRun,
} from '../../lib/fillerList';

export type FillerInfo = {
  /** null until loaded, or when the title isn't anime we can map. */
  map: FillerMap | null;
  /** The run the current episode is inside, or null when it is canon. */
  currentRun: FillerRun | null;
  /** The run the next episode would ENTER — null when the current episode is
   *  already inside that same run (moving along a run is not entering it). */
  nextRun: FillerRun | null;
};

const acceptedKey = (id: string, run: FillerRun) => `bliss:fillerOk:${id}:${run.firstEp}`;

export function isFillerRunAccepted(id: string | null | undefined, run: FillerRun): boolean {
  if (!id) return false;
  try { return sessionStorage.getItem(acceptedKey(id, run)) === '1'; } catch { return false; }
}

export function acceptFillerRun(id: string | null | undefined, run: FillerRun): void {
  if (!id) return;
  try { sessionStorage.setItem(acceptedKey(id, run), '1'); } catch { /* ignore */ }
}

export function useFillerInfo(
  id: string | null | undefined,
  videoId: string | null | undefined,
  videos: ReadonlyArray<EpisodeLike> | undefined,
  nextEpisode: number | null | undefined,
): FillerInfo {
  const [map, setMap] = useState<FillerMap | null>(null);

  useEffect(() => {
    setMap(null);
    if (!id) return;
    let cancelled = false;
    fetchFillerMap(id).then((m) => { if (!cancelled) setMap(m); });
    return () => { cancelled = true; };
  }, [id]);

  const currentEp = useMemo(() => {
    const fromList = videos?.find((v) => v.id === videoId);
    if (fromList && typeof fromList.episode === 'number' && fromList.episode > 0) return fromList.episode;
    return episodeNumberOf(videoId);
  }, [videos, videoId]);

  const currentRun = useMemo(
    () => fillerRunContaining(map, videos ?? [], currentEp),
    [map, videos, currentEp],
  );

  const nextRun = useMemo(() => {
    if (nextEpisode == null) return null;
    const run = fillerRunContaining(map, videos ?? [], nextEpisode);
    if (!run) return null;
    if (currentRun && currentRun.firstEp === run.firstEp) return null;
    return run;
  }, [map, videos, nextEpisode, currentRun]);

  return { map, currentRun, nextRun };
}
