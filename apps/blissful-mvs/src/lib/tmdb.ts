// IMDb -> TMDB ID lookup. Uses the TMDB v3 /find endpoint with the
// user's API key (Settings -> Advanced -> TMDB API key). Routes through
// /addon-proxy so the renderer stays same-origin and CORS-free.
// Per-id cache + sessionStorage so we don't re-hit TMDB for the same
// title across navigations.

import { readStoredPlayerSettings } from './playerSettings';
import { proxyUrl } from './proxyBase';

const memoryCache = new Map<string, TmdbLookup>();

export type TmdbLookup = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
};

export async function fetchTmdbId(imdbId: string): Promise<TmdbLookup | null> {
  if (!/^tt\d{5,}$/.test(imdbId)) return null;
  if (memoryCache.has(imdbId)) return memoryCache.get(imdbId) ?? null;

  const storageKey = `bliss:tmdb-id:${imdbId}`;
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as TmdbLookup;
      memoryCache.set(imdbId, parsed);
      return parsed;
    }
  } catch {
    /* sessionStorage unavailable — ignore */
  }

  const apiKey = readStoredPlayerSettings().tmdbApiKey.trim();

  // Two lookup paths: if the user has set their own TMDB API key in
  // player settings, use it directly (routed through /addon-proxy so
  // we stay same-origin). Otherwise fall back to the server's
  // /tmdb-find endpoint, which has a default TMDB_API_KEY in env —
  // this is what makes fresh iOS sessions work without first having
  // to manually enter a key on the device.
  try {
    let result: TmdbLookup | null = null;
    if (apiKey) {
      const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${encodeURIComponent(apiKey)}&external_source=imdb_id`;
      const response = await fetch(proxyUrl(`/addon-proxy?url=${encodeURIComponent(url)}`));
      if (!response.ok) return null;
      const data = (await response.json()) as {
        movie_results?: Array<{ id?: number }>;
        tv_results?: Array<{ id?: number }>;
      };
      const movieId = data.movie_results?.[0]?.id;
      const tvId = data.tv_results?.[0]?.id;
      if (typeof movieId === 'number') {
        result = { tmdbId: movieId, mediaType: 'movie' };
      } else if (typeof tvId === 'number') {
        result = { tmdbId: tvId, mediaType: 'tv' };
      }
    } else {
      const response = await fetch(proxyUrl(`/tmdb-find?imdbId=${encodeURIComponent(imdbId)}`));
      if (!response.ok) return null;
      result = (await response.json()) as TmdbLookup | null;
      if (result && (typeof result.tmdbId !== 'number' || !result.mediaType)) {
        result = null;
      }
    }
    if (!result) return null;
    memoryCache.set(imdbId, result);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(result));
    } catch {
      /* ignore */
    }
    return result;
  } catch {
    return null;
  }
}
