// TheIntroDB integration — community intro/recap/credits/preview timestamps for
// TV shows + movies (https://theintrodb.org). Ported 1:1 from the desktop app's
// lib/introdb.ts. The skip source for non-anime series (AniSkip covers anime;
// TheIntroDB covers everything + backfills anime AniSkip is missing).
//
// API (v3, public, no key for reads; native fetch ignores CORS):
//   GET https://api.theintrodb.org/v3/media?imdb_id=tt..&season=S&episode=E
//   GET https://api.theintrodb.org/v3/media?tmdb_id=123&season=S&episode=E
//   (omit season/episode for movies)
// Times are MILLISECONDS; end_ms can be null (segment runs to EOF).

/** The three skippable segment classes the player surfaces a button for.
 *  (Owned here — the desktop imports this from its mpv `useChapterSkip`, which
 *  this RN port doesn't have.) */
export type SkipKind = 'intro' | 'recap' | 'outro';

const BASE_URL = 'https://api.theintrodb.org/v3/media';

export interface IntroDbSegment {
  kind: SkipKind;
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

const isAbort = (err: unknown): boolean => (err as { name?: string } | null)?.name === 'AbortError';

/** Fetch skip segments from TheIntroDB. Requires an imdb id (tt…) or a tmdb id;
 *  `season`+`episode` together for series (omit both for films). Returns [] on
 *  miss/failure. credits + preview both map to the `outro` kind (Skip Credits). */
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
    // The API requires season and episode together; send only when both are
    // present (films omit them).
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
    const add = (arr: RawSeg[] | undefined, kind: SkipKind) => {
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
    if (isAbort(err)) throw err;
    cache.set(key, []);
    return [];
  }
}
