// "Skip Intro / Recap / Credits" data hook — ported from the desktop app's
// NativeMpvPlayer/useSkipSegments.ts. Two layered HTTP sources, in priority:
//   1. AniSkip   — anime OP/ED, keyed by MAL id (resolved from the content id
//      via ani.zip). Tried first.
//   2. TheIntroDB — intro/recap/credits/preview for TV + film, keyed by
//      imdb/tmdb id (+ season/episode). Live-action series have no MAL mapping,
//      so AniSkip returns empty and TheIntroDB takes over naturally.
//
// (The desktop ALSO reads mpv chapter markers via a separate `useChapterSkip`
// and prefers them; expo-video exposes no chapters, so this RN port uses only
// the two HTTP sources — which is what was asked for.)
//
// Visibility is purely a function of the live playback time vs. each segment —
// NO sticky dismissal, so seeking back into an intro shows the button again
// (matches Netflix). The player seeks past the segment on OK, which hides it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveMalId, fetchAniSkipTimes, type AnimeIdScheme } from '../../lib/aniskip';
import { fetchIntroDbSegments, type IntroDbSegment, type SkipKind } from '../../lib/introdb';

const LABELS: Record<SkipKind, string> = {
  intro: 'Skip Intro',
  recap: 'Skip Recap',
  outro: 'Skip Credits',
};

/** The active skip segment surfaced to the player (drives the Skip button). */
export type SkipState = {
  kind: SkipKind;
  label: string;
  /** Seconds to seek to when the user skips (the segment end, or EOF). */
  endTime: number;
};

// A normalized skip window (seconds). `end` null = runs to end of file.
type Segment = { kind: SkipKind; start: number; end: number | null };

const EMPTY: Segment[] = [];

interface ParsedTargets {
  anime: { scheme: AnimeIdScheme; value: string; episode: number } | null;
  introdb: { imdbId?: string; tmdbId?: number; season?: number; episode?: number } | null;
  key: string | null;
}

function parseTargets(id: string, videoId: string | null): ParsedTargets {
  const head = id.split(':')[0];
  const vidParts = videoId ? videoId.split(':') : [];
  // Episode = last numeric segment of the videoId (kitsu:NN:EP, tt:S:E).
  let episode: number | undefined;
  if (vidParts.length > 0) {
    const n = Number.parseInt(vidParts[vidParts.length - 1], 10);
    if (Number.isFinite(n) && n > 0) episode = n;
  }

  // Anime id scheme (for AniSkip).
  let scheme: AnimeIdScheme | null = null;
  let value: string | null = null;
  if (id.startsWith('kitsu:')) {
    scheme = 'kitsu';
    value = id.slice('kitsu:'.length).split(':')[0];
  } else if (id.startsWith('mal:')) {
    scheme = 'mal';
    value = id.slice('mal:'.length).split(':')[0];
  } else if (id.startsWith('anilist:')) {
    scheme = 'anilist';
    value = id.slice('anilist:'.length).split(':')[0];
  } else if (id.startsWith('anidb:')) {
    scheme = 'anidb';
    value = id.slice('anidb:'.length).split(':')[0];
  } else if (/^tt\d+$/.test(head)) {
    scheme = 'imdb';
    value = head;
  }
  const anime = scheme && value ? { scheme, value, episode: episode ?? 1 } : null;

  // imdb/tmdb id (for TheIntroDB). Season is only meaningful for the Stremio
  // `id:season:episode` video id used by imdb/tmdb content.
  let introdb: ParsedTargets['introdb'] = null;
  let season: number | undefined;
  if (vidParts.length >= 3) {
    const s = Number.parseInt(vidParts[vidParts.length - 2], 10);
    if (Number.isFinite(s) && s > 0) season = s;
  }
  if (/^tt\d+$/.test(head)) {
    introdb = { imdbId: head, season, episode };
  } else if (id.startsWith('tmdb:')) {
    const n = Number.parseInt(id.slice('tmdb:'.length).split(':')[0], 10);
    if (Number.isFinite(n) && n > 0) introdb = { tmdbId: n, season, episode };
  }

  const key = anime
    ? `a:${anime.scheme}:${anime.value}:${anime.episode}`
    : introdb
      ? `i:${introdb.imdbId ?? `tmdb${introdb.tmdbId}`}:${introdb.season ?? ''}:${introdb.episode ?? ''}`
      : null;

  return { anime, introdb, key };
}

/**
 * Resolve external skip segments (AniSkip → TheIntroDB) for the current media
 * and expose the segment active at `currentTime` as a `SkipState`.
 */
export function useSkipSegments(params: {
  id: string;
  videoId: string | null;
  duration: number;
  currentTime: number;
}): SkipState | null {
  const { id, videoId, duration, currentTime } = params;
  const { anime, introdb, key } = useMemo(() => parseTargets(id, videoId), [id, videoId]);

  // Segments tagged with the target key they belong to, so a late async response
  // or a stale value from the previous episode is ignored on a key mismatch.
  const [loaded, setLoaded] = useState<{ key: string; segments: Segment[] } | null>(null);

  // Latest duration without re-firing the fetch (AniSkip matches fine with 0).
  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        let segments: Segment[] = [];

        // 1) AniSkip (anime).
        if (anime) {
          const mal = await resolveMalId(anime.scheme, anime.value, controller.signal);
          if (cancelled) return;
          if (mal) {
            const times = await fetchAniSkipTimes(
              mal,
              anime.episode,
              durationRef.current,
              controller.signal,
            );
            if (cancelled) return;
            segments = times.map((t) => ({
              kind: t.kind === 'op' ? ('intro' as const) : ('outro' as const),
              start: t.startTime,
              end: t.endTime,
            }));
          }
        }

        // 2) TheIntroDB (live-action series + anime backfill).
        if (segments.length === 0 && introdb) {
          const segs: IntroDbSegment[] = await fetchIntroDbSegments(introdb, controller.signal);
          if (cancelled) return;
          segments = segs;
        }

        if (segments.length === 0) return;
        setLoaded({ key, segments });
      } catch {
        // Abort or any failure: feature stays absent, no button.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, anime, introdb]);

  const segments = useMemo(
    () => (loaded && loaded.key === key ? loaded.segments : EMPTY),
    [loaded, key],
  );

  return useMemo<SkipState | null>(() => {
    if (!key || segments.length === 0) return null;
    const dur = Number.isFinite(duration) && duration > 0 ? duration : null;
    const active = segments.find((s) => {
      const end = s.end ?? dur ?? Number.POSITIVE_INFINITY;
      return currentTime >= s.start && currentTime < end;
    });
    if (!active) return null;
    const endTime = active.end ?? dur ?? active.start + 1;
    return { kind: active.kind, label: LABELS[active.kind], endTime };
  }, [segments, currentTime, key, duration]);
}
