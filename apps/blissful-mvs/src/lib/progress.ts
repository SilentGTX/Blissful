// Shared progress resolver. There are TWO sources of playback progress
// in this app:
//
//   1. The local `progressStore` (localStorage `blissfulProgressV1`) —
//      written by the player every ~5s while playing.
//   2. Stremio library state — synced from Stremio's cloud and surfaced
//      on each `LibraryItem.state.timeOffset` / `state.duration` (ms).
//
// They drift: the local store is the freshest source for the current
// session, the cloud state is what other devices and Stremio Desktop
// already have. Picking either alone leaves rows showing 0% when the
// data is in the other source.
//
// `resolveProgress` reads BOTH and returns whichever has the higher
// percentage, plus the corresponding time + duration so callers can show
// `h:mm:ss` instead of just a percent.

import { getProgress, getProgressPercent } from './progressStore';
import type { LibraryItem } from './stremioApi';

export type ResolvedProgress = {
  percent: number;
  timeSeconds: number;
  durationSeconds: number;
  hasProgress: boolean;
  watched: boolean;
};

export const EMPTY_PROGRESS: ResolvedProgress = {
  percent: 0,
  timeSeconds: 0,
  durationSeconds: 0,
  hasProgress: false,
  watched: false,
};

type ResolveProgressParams = {
  type: string;
  id: string;
  videoId?: string | null;
  /** When provided, the Stremio library state is consulted alongside the
   *  local progress store. The function picks whichever percent is higher. */
  libraryItem?: LibraryItem | null;
};

export function resolveProgress(params: ResolveProgressParams): ResolvedProgress {
  const { type, id, videoId, libraryItem } = params;

  // Local progressStore — primary source for the active session.
  const localEntry = getProgress({ type, id, videoId });
  const localPercent = getProgressPercent({ type, id, videoId });
  const localTime = localEntry?.time ?? 0;
  const localDur = localEntry?.duration ?? 0;

  // Stremio library state — primary source for content played on other
  // devices or in Stremio Desktop directly (cloud-synced).
  const state = libraryItem?.state as
    | { timeOffset?: number; duration?: number; video_id?: string | null }
    | undefined;
  // For series the cloud state's `video_id` must match the videoId we
  // care about; otherwise we'd report the LAST watched episode's offset
  // for a different episode.
  const stremioMatches =
    !state ? false : videoId ? state.video_id === videoId : true;
  const stremioTime =
    stremioMatches && typeof state?.timeOffset === 'number'
      ? Math.max(0, state.timeOffset) / 1000
      : 0;
  const stremioDur =
    stremioMatches && typeof state?.duration === 'number'
      ? Math.max(0, state.duration) / 1000
      : 0;
  const stremioPercent =
    stremioDur > 0 ? Math.min(100, Math.max(0, (stremioTime / stremioDur) * 100)) : 0;

  // Prefer whichever percent is higher (= later watch position).
  const useStremio = stremioPercent > localPercent;
  const timeSeconds = useStremio ? stremioTime : localTime;
  const durationSeconds = useStremio ? stremioDur : localDur;
  const percent = Math.max(localPercent, stremioPercent);

  return {
    percent,
    timeSeconds,
    durationSeconds,
    hasProgress: percent > 0 || timeSeconds > 0,
    watched: percent >= 90,
  };
}

/** hh:mm:ss when there's at least an hour, else mm:ss. */
export function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
