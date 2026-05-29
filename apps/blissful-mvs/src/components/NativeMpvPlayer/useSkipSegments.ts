// External skip-segment source for the Skip-Intro/Recap/Credits button,
// used as the fallback when the file has no mpv chapter markers.
//
// Two layered sources, in priority order:
//   1. AniSkip  — anime OP/ED, keyed by MAL id (resolved from the content
//      id via ani.zip). Preferred for anime.
//   2. TheIntroDB — intro/recap/credits/preview for TV + film, keyed by
//      imdb/tmdb id (+ season/episode). Covers live-action series and
//      backfills anime episodes AniSkip is missing.
// AniSkip is tried first; if it yields nothing, TheIntroDB is queried.
// Since a live-action series has no MAL mapping, AniSkip returns empty and
// TheIntroDB takes over — so anime → AniSkip, series → TheIntroDB falls
// out naturally without us having to classify the content ourselves.
//
// Exposes the same `ChapterSkipState` shape as `useChapterSkip`, so the
// player renders the identical floating button. Chapter markers still win
// (player computes `chapterSkip ?? segmentSkip`).
//
// Visibility is purely a function of the live playback time vs. each
// segment — there is NO sticky dismissal, so seeking back into an intro
// shows the button again (matches Netflix). Clicking it seeks past the
// segment, which naturally hides it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { desktop } from '../../lib/desktop';
import { resolveMalId, fetchAniSkipTimes, type AnimeIdScheme } from '../../lib/aniskip';
import { fetchIntroDbSegments, type IntroDbSegment } from '../../lib/introdb';
import type { ChapterSkipKind, ChapterSkipState } from './useChapterSkip';

const LABELS: Record<ChapterSkipKind, string> = {
  intro: 'Skip Intro',
  recap: 'Skip Recap',
  outro: 'Skip Credits',
};

// A normalized skip window (seconds). `end` null = runs to end of file.
type Segment = { kind: ChapterSkipKind; start: number; end: number | null };

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
  const anime =
    scheme && value ? { scheme, value, episode: episode ?? 1 } : null;

  // imdb/tmdb id (for TheIntroDB). Season is only meaningful for the
  // Stremio `id:season:episode` video id used by imdb/tmdb content.
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
 * Resolve external skip segments (AniSkip → TheIntroDB) for the current
 * media and expose the segment active at `currentTime` as a
 * `ChapterSkipState`, mirroring `useChapterSkip`'s contract.
 */
export function useSkipSegments(params: {
  id: string;
  videoId: string | null;
  duration: number;
  currentTime: number;
}): ChapterSkipState | null {
  const { id, videoId, duration, currentTime } = params;
  const { anime, introdb, key } = useMemo(
    () => parseTargets(id, videoId),
    [id, videoId],
  );

  // Segments tagged with the target key they belong to, so a late async
  // response or a stale value from the previous episode is ignored on a
  // key mismatch (no synchronous setState inside the effect).
  const [loaded, setLoaded] = useState<{ key: string; segments: Segment[] } | null>(null);

  // Latest duration without re-firing the fetch effect (AniSkip matches
  // fine with 0; TheIntroDB ignores it).
  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    const log = (line: string) => {
      desktop.log(`[skip] ${line}`).catch(() => {});
    };
    if (!key) {
      log(`id="${id}" videoId="${videoId ?? ''}" -> no skip target`);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        let segments: Segment[] = [];
        let source = '';

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
            if (segments.length) source = `aniskip mal=${mal} ep=${anime.episode}`;
          }
        }

        // 2) TheIntroDB (live-action series + anime backfill).
        if (segments.length === 0 && introdb) {
          const segs: IntroDbSegment[] = await fetchIntroDbSegments(
            introdb,
            controller.signal,
          );
          if (cancelled) return;
          segments = segs;
          if (segments.length) {
            source = `introdb ${introdb.imdbId ?? `tmdb:${introdb.tmdbId}`} s${introdb.season ?? '-'}e${introdb.episode ?? '-'}`;
          }
        }

        if (segments.length === 0) {
          log(`${key}: no segments from any source`);
          return;
        }
        log(
          `${source}: ` +
            segments
              .map(
                (s) =>
                  `${s.kind}[${s.start.toFixed(0)}-${s.end != null ? s.end.toFixed(0) : 'EOF'}]`,
              )
              .join(', '),
        );
        setLoaded({ key, segments });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Any other failure: feature stays absent, no button.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, anime, introdb, id, videoId]);

  const segments = useMemo(
    () => (loaded && loaded.key === key ? loaded.segments : EMPTY),
    [loaded, key],
  );

  return useMemo<ChapterSkipState | null>(() => {
    if (!key || segments.length === 0) return null;
    const dur = Number.isFinite(duration) && duration > 0 ? duration : null;
    const active = segments.find((s) => {
      const end = s.end ?? dur ?? Number.POSITIVE_INFINITY;
      return currentTime >= s.start && currentTime < end;
    });
    if (!active) return null;
    // Seek target: the segment end, or the file end for to-EOF segments.
    const endTime = active.end ?? dur ?? active.start + 1;
    return {
      kind: active.kind,
      label: LABELS[active.kind],
      endTime,
      // No sticky dismissal — seeking back in re-shows the button.
      onSkip: () => {
        desktop.seek(endTime, 'absolute').catch(() => {});
      },
    };
  }, [segments, currentTime, key, duration]);
}
