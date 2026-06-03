// Pure "next-to-watch" computation for a series, shared by the detail page
// (TV default season + autofocus) and the Continue-Watching open flow.
//
// Given the meta videos in NATIVE order, the decoded watched-id Set, and the
// last-played episode's progress, decide which episode the detail page lands
// on:
//   (a) IN-PROGRESS: the last-played episode, when it is NOT yet watched and
//       carries genuine partial progress (>= MIN_RESUME_SECONDS and, when the
//       duration is known, <= MAX_RESUME_FRACTION of it) -> RESUME it.
//   (b) ADVANCE: otherwise the episode immediately AFTER the FURTHEST-watched
//       index in native order (a fresh 0:00 episode -> open the selector).
//   - none watched -> first non-Specials episode (episode 1).
//   - finale already watched (no next) -> last-played, else last episode.
//
// Never throws; returns null when there is nothing sensible to pick (movies /
// no videos).

export type NextToWatchVideo = { id: string; season?: number; episode?: number };

export type NextToWatch = {
  videoId: string;
  /** true => genuine partial progress on the last-played ep (case a): caller
   *  RESUMEs it. false => fresh episode (case b/edge): open selector at 0:00. */
  inProgress: boolean;
  /** Seconds to resume at; 0 unless `inProgress`. */
  resumeSeconds: number;
};

type ProgressLike = { timeSeconds: number; durationSeconds: number };

/** Below this many saved seconds the offset is effectively "from the start"
 *  (and would render as "Resume 0:00"), so it is NOT treated as resumable. */
export const MIN_RESUME_SECONDS = 15;
/** Above this fraction of the runtime the episode counts as finished rather
 *  than resumable. */
export const MAX_RESUME_FRACTION = 0.95;

export function computeNextToWatch<V extends NextToWatchVideo>(params: {
  videos: V[];
  watchedIds: Set<string>;
  /** state.video_id — the last-played episode id (may be null/absent). */
  lastPlayedVideoId: string | null | undefined;
  /** Progress for the last-played episode only; null when unknown. */
  lastPlayedProgress: ProgressLike | null;
}): NextToWatch | null {
  const { videos, watchedIds, lastPlayedVideoId, lastPlayedProgress } = params;
  if (videos.length === 0) return null;

  // (a) IN-PROGRESS: last-played present + not watched + genuine partial.
  if (lastPlayedVideoId && videos.some((v) => v.id === lastPlayedVideoId)) {
    const watched = watchedIds.has(lastPlayedVideoId);
    const t = lastPlayedProgress?.timeSeconds ?? 0;
    const d = lastPlayedProgress?.durationSeconds ?? 0;
    const genuine = t >= MIN_RESUME_SECONDS && (d <= 0 || t <= d * MAX_RESUME_FRACTION);
    if (!watched && genuine) {
      return { videoId: lastPlayedVideoId, inProgress: true, resumeSeconds: t };
    }
  }

  // (b) ADVANCE: episode immediately AFTER the FURTHEST-watched index in the
  // native meta order (the same order the WatchedBitField decodes against).
  let furthestIdx = -1;
  for (let i = 0; i < videos.length; i += 1) {
    if (watchedIds.has(videos[i].id)) furthestIdx = i;
  }
  let nextIdx = furthestIdx + 1;
  // Skip Specials (season 0) as an advance TARGET — a watched special still
  // advances furthestIdx, but we never land the user on one.
  while (nextIdx < videos.length && videos[nextIdx].season === 0) nextIdx += 1;
  if (nextIdx < videos.length) {
    return { videoId: videos[nextIdx].id, inProgress: false, resumeSeconds: 0 };
  }

  // Edge: finale watched (no next) -> last-played, else last episode.
  const fallback =
    lastPlayedVideoId && videos.some((v) => v.id === lastPlayedVideoId)
      ? lastPlayedVideoId
      : videos[videos.length - 1].id;
  return { videoId: fallback, inProgress: false, resumeSeconds: 0 };
}
