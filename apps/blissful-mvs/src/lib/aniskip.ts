// AniSkip integration: resolve OP/ED skip intervals for anime that ship
// WITHOUT mpv chapter markers (most simulcasts and chapterless web rips).
// This is the fallback the Skip-Intro feature falls back to when
// `useChapterSkip` finds nothing usable in the file's chapter list.
//
// Resolution chain:
//   1. kitsu numeric id -> MAL id, via ani.zip mappings
//      GET https://api.ani.zip/mappings?kitsu_id=<NN>  ->  mappings.mal_id
//      (ani.zip is the mapping service the Stremio anime ecosystem uses;
//       it covers far more entries than Kitsu's own /mappings endpoint,
//       which is frequently empty.)
//   2. MAL id + episode -> skip intervals, via AniSkip v2
//      GET https://api.aniskip.com/v2/skip-times/<mal>/<ep>?types=op&types=ed...
//
// Both APIs are public, no-auth, and send `Access-Control-Allow-Origin: *`,
// so the renderer calls them directly (same pattern as api.strem.io in
// stremioApi.ts). There is no CSP connect-src restriction in this app.
//
// Results are cached module-side so re-mounting the player or re-selecting
// the same episode doesn't re-hit the network. A null/empty result is
// cached too, so a marker-less, mapping-less title doesn't get probed on
// every player mount.

export type AniSkipKind = 'op' | 'ed';

export interface AniSkipInterval {
  kind: AniSkipKind;
  startTime: number;
  endTime: number;
}

// Anime id schemes we can resolve to a MAL id. Anime reaches the player
// under any of these depending on the catalog/addon the user browsed:
// Cinemeta hands out `imdb` (tt*), anime-kitsu hands out `kitsu`, some
// MAL/AniList addons hand out their own. `mal` needs no lookup.
export type AnimeIdScheme = 'kitsu' | 'imdb' | 'mal' | 'anilist' | 'anidb';

// ani.zip query parameter for each scheme that needs a remote lookup.
const ANIZIP_PARAM: Record<Exclude<AnimeIdScheme, 'mal'>, string> = {
  kitsu: 'kitsu_id',
  imdb: 'imdb_id',
  anilist: 'anilist_id',
  anidb: 'anidb_id',
};

// `${scheme}:${value}` -> MAL id (null = looked up, no mapping exists).
const malCache = new Map<string, number | null>();
// `${mal}:${ep}:${len}` -> intervals ([] = looked up, none found).
const skipCache = new Map<string, AniSkipInterval[]>();

/** Resolve an anime id (kitsu/imdb/anilist/anidb numeric-or-tt value) to a
 *  MAL id via ani.zip. `mal` is returned directly. Anime seasons usually
 *  carry their own imdb tt, so per-season MAL resolves correctly. Returns
 *  null when no mapping exists or the lookup fails. */
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
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Network failure — cache null so we don't hammer the API every tick.
    malCache.set(cacheKey, null);
    return null;
  }
}

/** Fetch OP/ED skip intervals for a MAL episode. `episodeLength` (seconds)
 *  improves AniSkip's matching; pass 0 when unknown. Returns [] when the
 *  title/episode has no contributed skip times. AniSkip's `mixed-op` /
 *  `mixed-ed` types (OP/ED fused with a recap) are folded into op/ed. */
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
        // 'op' | 'mixed-op' -> op ; 'ed' | 'mixed-ed' -> ed.
        const kind: AniSkipKind | null = t.endsWith('op')
          ? 'op'
          : t.endsWith('ed')
            ? 'ed'
            : null;
        if (
          kind &&
          typeof start === 'number' &&
          typeof end === 'number' &&
          end > start
        ) {
          out.push({ kind, startTime: start, endTime: end });
        }
      }
    }
    skipCache.set(key, out);
    return out;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    skipCache.set(key, []);
    return [];
  }
}
