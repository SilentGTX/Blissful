// Filler / recap flags for anime episodes.
//
// Source: MyAnimeList's per-episode `filler` and `recap` booleans, read through
// the Jikan API by the addon-proxy (`/skip-times?filler=1&mal=<id>`), which
// pages through the whole list once and caches it — the flags never change for
// an aired episode, and Jikan is rate-limited (3 req/s), so every viewer hitting
// it directly for a 366-episode show would be four requests each. The proxy
// route lives under `/skip-times` because only a fixed set of path prefixes is
// routed to the proxy at the edge; a new top-level path would be swallowed by
// the SPA's index.html (same reason `/opensubs?src=` exists).
//
// The MAL id comes from the same Kitsu -> MAL mapping the skip-intro feature
// uses (lib/aniskip resolveMalId via ani.zip), so this works for exactly the
// content that already gets AniSkip data: kitsu/mal/anilist/anidb ids and imdb
// ids that ani.zip knows as anime. Episode numbers on Kitsu are absolute for
// long-running shows and so are MAL's, so `kitsu:244:65` is MAL 269 episode 65.
//
// A recap is treated as filler for the purpose of "do you want to skip these":
// it is an episode of nothing new, which is what the viewer is deciding about.

import { resolveMalId, type AnimeIdScheme } from './aniskip';

export type FillerKind = 'filler' | 'recap';
/** episode number -> kind; canon episodes are absent. */
export type FillerMap = Map<number, FillerKind>;

export type EpisodeLike = { id: string; episode?: number | null; number?: number | null };

/** A consecutive stretch of filler/recap episodes. `resume*` is the first canon
 *  episode after the run — null when the run reaches the end of the list. */
export type FillerRun = {
  firstEp: number;
  lastEp: number;
  count: number;
  /** True when at least one episode in the run is a recap rather than filler. */
  hasRecap: boolean;
  resumeEp: number | null;
  resumeVideoId: string | null;
};

/** The anime id scheme + value carried by a content id, or null when the id is
 *  not one we can map to MAL. Mirrors NativeMpvPlayer/useSkipSegments. */
export function animeIdOf(id: string | null | undefined): { scheme: AnimeIdScheme; value: string } | null {
  if (!id) return null;
  for (const scheme of ['kitsu', 'mal', 'anilist', 'anidb'] as const) {
    const prefix = `${scheme}:`;
    if (id.startsWith(prefix)) {
      const value = id.slice(prefix.length).split(':')[0];
      return value ? { scheme, value } : null;
    }
  }
  const head = id.split(':')[0];
  if (/^tt\d+$/.test(head)) return { scheme: 'imdb', value: head };
  return null;
}

/** Episode number = the last numeric segment of a video id (`kitsu:244:65`,
 *  `tt0434665:1:65`). */
export function episodeNumberOf(videoId: string | null | undefined): number | null {
  if (!videoId) return null;
  const parts = videoId.split(':');
  const n = Number.parseInt(parts[parts.length - 1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function episodeOf(v: EpisodeLike): number | null {
  if (typeof v.episode === 'number' && v.episode > 0) return v.episode;
  if (typeof v.number === 'number' && v.number > 0) return v.number;
  return episodeNumberOf(v.id);
}

/** The run of filler/recap episodes that CONTAINS `ep` (walking back to its
 *  start and forward to its end), or null when `ep` is canon or unknown.
 *  `videos` supplies the episode order and the video id to resume on. */
export function fillerRunContaining(map: FillerMap | null, videos: ReadonlyArray<EpisodeLike>, ep: number | null): FillerRun | null {
  if (!map || ep == null || !map.has(ep)) return null;
  const ordered = videos
    .map((v) => ({ v, ep: episodeOf(v) }))
    .filter((x): x is { v: EpisodeLike; ep: number } => x.ep != null)
    .sort((a, b) => a.ep - b.ep);
  const idx = ordered.findIndex((x) => x.ep === ep);
  // The map alone can define the run when the episode list is missing or
  // doesn't include this episode; resumeVideoId then stays null.
  let first = ep;
  while (map.has(first - 1)) first -= 1;
  let last = ep;
  while (map.has(last + 1)) last += 1;
  let hasRecap = false;
  for (let e = first; e <= last; e += 1) if (map.get(e) === 'recap') hasRecap = true;
  let resumeEp: number | null = null;
  let resumeVideoId: string | null = null;
  if (idx !== -1) {
    const after = ordered.find((x) => x.ep > last);
    if (after) { resumeEp = after.ep; resumeVideoId = after.v.id; }
  } else if (ordered.some((x) => x.ep > last)) {
    const after = ordered.find((x) => x.ep > last)!;
    resumeEp = after.ep; resumeVideoId = after.v.id;
  }
  return { firstEp: first, lastEp: last, count: last - first + 1, hasRecap, resumeEp, resumeVideoId };
}

// `${scheme}:${value}` -> map (null = looked up, not anime / no data).
const mapCache = new Map<string, Promise<FillerMap | null>>();

/** Filler map for a content id. Resolves to null for non-anime ids, ids with no
 *  MAL mapping, or when the proxy has nothing. Cached per id for the session,
 *  including those nulls, so a non-anime title is looked up once; a FAILED
 *  lookup (network, 5xx) is dropped so the next caller retries.
 *
 *  Deliberately NOT abortable: the promise is shared by every consumer of the
 *  title (detail page, player, a remount of either), so an AbortSignal from one
 *  of them would fail the lookup for all the others — the first mount's cleanup
 *  would hand the second mount a null. Callers ignore the result after unmount
 *  instead; the response is a couple of KB. */
export function fetchFillerMap(id: string | null | undefined): Promise<FillerMap | null> {
  const anime = animeIdOf(id);
  if (!anime) return Promise.resolve(null);
  // MAL numbers episodes ABSOLUTELY, and so do kitsu/mal/anilist/anidb ids
  // (`kitsu:244:65` is episode 65 of the show). Cinemeta's imdb ids number by
  // season (`tt0434665:3:8`), so the same map would flag the wrong episodes; the
  // skip-intro feature has the same asymmetry and resolves imdb per season via
  // AniList cours server-side. Until that mapping is shared, imdb is out.
  if (anime.scheme === 'imdb') return Promise.resolve(null);
  const key = `${anime.scheme}:${anime.value}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const mal = await resolveMalId(anime.scheme, anime.value);
    if (!mal) return null;
    const res = await fetch(`/skip-times?filler=1&mal=${mal}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { episodes?: Record<string, string> };
    const map: FillerMap = new Map();
    for (const [k, v] of Object.entries(data.episodes ?? {})) {
      const ep = Number.parseInt(k, 10);
      if (Number.isFinite(ep) && (v === 'filler' || v === 'recap')) map.set(ep, v);
    }
    return map;
  })().catch(() => {
    // A failed lookup must not be pinned for the session — drop it so the next
    // player mount can retry.
    mapCache.delete(key);
    return null;
  });
  mapCache.set(key, p);
  return p;
}

/** Wording for the run banner/prompt. */
export function describeRun(run: FillerRun): string {
  const what = run.hasRecap ? 'filler/recap' : 'filler';
  if (run.count === 1) return `Episode ${run.firstEp} is ${what}`;
  return `Episodes ${run.firstEp}–${run.lastEp} are ${what}`;
}
