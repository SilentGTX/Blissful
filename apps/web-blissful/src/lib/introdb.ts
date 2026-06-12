// TheIntroDB integration: community-sourced intro/recap/credits/preview
// timestamps for TV shows and movies (https://theintrodb.org). Used as
// the skip-segment source for non-anime series — AniSkip covers anime,
// TheIntroDB covers everything (and backfills anime episodes AniSkip is
// missing).
//
// API (v3, public, no key required for reads — a key only unlocks your
// own pending submissions; CORS reflects the request Origin):
//   GET https://api.theintrodb.org/v3/media?imdb_id=tt..&season=S&episode=E
//   GET https://api.theintrodb.org/v3/media?tmdb_id=123&season=S&episode=E
//   (omit season/episode for movies)
// Response: { tmdb_id, type, season?, episode?,
//             intro?:   [{ start_ms, end_ms }],
//             recap?:   [{ start_ms, end_ms }],
//             credits?: [{ start_ms, end_ms }],
//             preview?: [{ start_ms, end_ms }] }
// Times are MILLISECONDS; end_ms can be null (segment runs to EOF).

import type { ChapterSkipKind } from '../components/NativeMpvPlayer/useChapterSkip';

const BASE_URL = 'https://api.theintrodb.org/v3/media';

export interface IntroDbSegment {
  kind: ChapterSkipKind;
  /** seconds */
  start: number;
  /** seconds; null = runs to end of file */
  end: number | null;
}

// `${imdb|tmdb}:${season}:${episode}` -> segments ([] = looked up, none).
const cache = new Map<string, IntroDbSegment[]>();

interface RawSeg {
  start_ms?: number | null;
  end_ms?: number | null;
}

/** Fetch skip segments from TheIntroDB. Requires an imdb id (tt…) or a
 *  tmdb id; `season`+`episode` together for series (omit both for films).
 *  Returns [] on miss/failure. credits + preview both map to the `outro`
 *  kind (Skip Credits). */
export async function fetchIntroDbSegments(
  params: { imdbId?: string; tmdbId?: number; season?: number; episode?: number },
  signal?: AbortSignal,
): Promise<IntroDbSegment[]> {
  const idPart = params.imdbId ?? (params.tmdbId != null ? `t${params.tmdbId}` : '');
  if (!idPart) return [];
  const key = `${idPart}:${params.season ?? ''}:${params.episode ?? ''}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const q = new URLSearchParams();
    if (params.imdbId) q.set('imdb_id', params.imdbId);
    else if (params.tmdbId != null) q.set('tmdb_id', String(params.tmdbId));
    // The API requires season and episode together; send only when both
    // are present (films omit them).
    if (params.season != null && params.episode != null) {
      q.set('season', String(params.season));
      q.set('episode', String(params.episode));
    }

    const res = await fetch(`${BASE_URL}?${q.toString()}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) {
      cache.set(key, []);
      return [];
    }
    const data = (await res.json()) as {
      intro?: RawSeg[];
      recap?: RawSeg[];
      credits?: RawSeg[];
      preview?: RawSeg[];
    };

    const out: IntroDbSegment[] = [];
    const add = (arr: RawSeg[] | undefined, kind: ChapterSkipKind) => {
      for (const s of arr ?? []) {
        if (typeof s.start_ms !== 'number') continue;
        out.push({
          kind,
          start: s.start_ms / 1000,
          end: typeof s.end_ms === 'number' ? s.end_ms / 1000 : null,
        });
      }
    };
    add(data.intro, 'intro');
    add(data.recap, 'recap');
    add(data.credits, 'outro');
    add(data.preview, 'outro');

    cache.set(key, out);
    return out;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    cache.set(key, []);
    return [];
  }
}
