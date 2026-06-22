// AniSkip integration — OP/ED skip intervals for anime. Ported 1:1 from the
// desktop app's lib/aniskip.ts (the only change: RN-safe abort-error checks —
// Hermes has no `DOMException`). Both APIs are public, no-auth, and native
// fetch ignores CORS, so the app calls them directly (same as the subtitle/
// stream addon fetches).
//
// Resolution chain:
//   1. kitsu/imdb/anilist/anidb id -> MAL id, via ani.zip mappings
//      GET https://api.ani.zip/mappings?<param>=<value>  ->  mappings.mal_id
//   2. MAL id + episode -> skip intervals, via AniSkip v2
//      GET https://api.aniskip.com/v2/skip-times/<mal>/<ep>?types=op&types=ed...
//
// Results are cached module-side (a null/empty result is cached too) so
// re-opening the player / re-selecting an episode doesn't re-hit the network.

export type AniSkipKind = 'op' | 'ed';

export interface AniSkipInterval {
  kind: AniSkipKind;
  startTime: number;
  endTime: number;
}

// Anime id schemes we can resolve to a MAL id. `mal` needs no lookup.
export type AnimeIdScheme = 'kitsu' | 'imdb' | 'mal' | 'anilist' | 'anidb';

// ani.zip query parameter for each scheme that needs a remote lookup.
const ANIZIP_PARAM: Record<Exclude<AnimeIdScheme, 'mal'>, string> = {
  kitsu: 'kitsu_id',
  imdb: 'imdb_id',
  anilist: 'anilist_id',
  anidb: 'anidb_id',
};

const isAbort = (err: unknown): boolean => (err as { name?: string } | null)?.name === 'AbortError';

// `${scheme}:${value}` -> MAL id (null = looked up, no mapping exists).
const malCache = new Map<string, number | null>();
// `${mal}:${ep}:${len}` -> intervals ([] = looked up, none found).
const skipCache = new Map<string, AniSkipInterval[]>();

/** Resolve an anime id (kitsu/imdb/anilist/anidb value) to a MAL id via ani.zip.
 *  `mal` is returned directly. Returns null when no mapping exists or the lookup
 *  fails. */
export async function resolveMalId(
  scheme: AnimeIdScheme,
  value: string,
  signal?: AbortSignal,
): Promise<number | null> {
  if (scheme === 'mal') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const cacheKey = `${scheme}:${value}`;
  const cached = malCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const param = ANIZIP_PARAM[scheme];
    const res = await fetch(
      `https://api.ani.zip/mappings?${param}=${encodeURIComponent(value)}`,
      { signal },
    );
    if (!res.ok) {
      malCache.set(cacheKey, null);
      return null;
    }
    const data = (await res.json()) as { mappings?: { mal_id?: number | null } };
    const mal = data?.mappings?.mal_id;
    const val = typeof mal === 'number' && mal > 0 ? mal : null;
    malCache.set(cacheKey, val);
    return val;
  } catch (err: unknown) {
    if (isAbort(err)) throw err;
    // Network failure — cache null so we don't hammer the API every tick.
    malCache.set(cacheKey, null);
    return null;
  }
}

/** Fetch OP/ED skip intervals for a MAL episode. `episodeLength` (seconds)
 *  improves matching; pass 0 when unknown. Returns [] when the title/episode
 *  has no contributed skip times. `mixed-op`/`mixed-ed` fold into op/ed. */
export async function fetchAniSkipTimes(
  malId: number,
  episode: number,
  episodeLength: number,
  signal?: AbortSignal,
): Promise<AniSkipInterval[]> {
  const len =
    Number.isFinite(episodeLength) && episodeLength > 0 ? Math.round(episodeLength) : 0;
  const key = `${malId}:${episode}:${len}`;
  const cached = skipCache.get(key);
  if (cached) return cached;
  try {
    const url =
      `https://api.aniskip.com/v2/skip-times/${malId}/${episode}` +
      `?types=op&types=ed&types=mixed-op&types=mixed-ed&episodeLength=${len}`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      skipCache.set(key, []);
      return [];
    }
    const data = (await res.json()) as {
      found?: boolean;
      results?: Array<{
        interval?: { startTime?: number; endTime?: number };
        skipType?: string;
      }>;
    };
    const out: AniSkipInterval[] = [];
    if (data?.found && Array.isArray(data.results)) {
      for (const r of data.results) {
        const start = r.interval?.startTime;
        const end = r.interval?.endTime;
        const t = r.skipType ?? '';
        const kind: AniSkipKind | null = t.endsWith('op') ? 'op' : t.endsWith('ed') ? 'ed' : null;
        if (kind && typeof start === 'number' && typeof end === 'number' && end > start) {
          out.push({ kind, startTime: start, endTime: end });
        }
      }
    }
    skipCache.set(key, out);
    return out;
  } catch (err: unknown) {
    if (isAbort(err)) throw err;
    skipCache.set(key, []);
    return [];
  }
}
