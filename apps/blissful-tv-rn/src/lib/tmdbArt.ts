// Per-title 16:9 backdrop from TMDB, for the home row tiles.
//
// KEYLESS-FOR-ALL path (preferred): the backend's server-keyed `/tmdb-find` returns
// the backdrop — we read `backdrop` (full url) or `backdrop_path` (path). The TMDB
// /find call the backend already makes contains `backdrop_path`; the backend just
// needs to include it in the response (one field). Until it does, we transparently
// fall back to the ACCOUNT tmdb key (Settings) so it still works for key-holders.
// Once the backend returns a backdrop, every user gets it with no app change.
import { fetchStoredSettings, getStorageBaseUrl } from '@blissful/core';
import { readTvSettings } from './tvSettings';

const IMDB_RE = /^tt\d{5,}$/;
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
let keyPromise: Promise<string | null> | null = null;
// null = unprobed, true/false = whether the backend /tmdb-find returns a backdrop.
// Once known false we stop hitting the backend for art (account-key path only).
let backendHasBackdrop: boolean | null = null;

function backendBase(): string {
  return getStorageBaseUrl().replace(/\/storage\/?$/, '');
}

function backdropFrom(d: unknown): string | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as { backdrop?: unknown; backdrop_path?: unknown };
  if (typeof o.backdrop === 'string' && o.backdrop) return o.backdrop;
  if (typeof o.backdrop_path === 'string' && o.backdrop_path) return `https://image.tmdb.org/t/p/w780${o.backdrop_path}`;
  return null;
}

async function getKey(token: string | null): Promise<string | null> {
  const local = readTvSettings().tmdbApiKey?.trim();
  if (local) return local;
  if (!token) return null;
  if (!keyPromise) {
    keyPromise = fetchStoredSettings(token)
      .then((s) => ((s as { tmdbApiKey?: string } | null)?.tmdbApiKey ?? '').trim() || null)
      .catch(() => null);
  }
  return keyPromise;
}

/** TMDB 16:9 backdrop url for an imdb id (cached). Tries the keyless backend first,
 *  then the account key. null when neither yields one. */
export async function fetchTmdbBackdrop(imdbId: string, token: string | null): Promise<string | null> {
  if (!IMDB_RE.test(imdbId)) return null;
  const hit = cache.get(imdbId);
  if (hit !== undefined) return hit;
  const existing = inflight.get(imdbId);
  if (existing) return existing;
  const p = (async () => {
    // 1) Server-keyed backend (keyless for the user). Skip once we've learned it
    //    doesn't carry a backdrop, to avoid a wasted request per tile.
    if (backendHasBackdrop !== false) {
      try {
        const d = await fetch(`${backendBase()}/tmdb-find?imdbId=${encodeURIComponent(imdbId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const url = backdropFrom(d);
        if (url) {
          backendHasBackdrop = true;
          cache.set(imdbId, url);
          return url;
        }
        // Got a valid response with no backdrop field → backend doesn't provide it.
        if (d && typeof d === 'object') backendHasBackdrop = false;
      } catch {
        /* network — leave capability unknown, fall through */
      }
    }
    // 2) Fallback: account TMDB key, direct /find.
    const key = await getKey(token);
    if (!key) {
      cache.set(imdbId, null);
      return null;
    }
    try {
      const r = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${encodeURIComponent(key)}&external_source=imdb_id`).then((x) => x.json());
      const path: string | null =
        r?.movie_results?.[0]?.backdrop_path ?? r?.tv_results?.[0]?.backdrop_path ?? null;
      const url = path ? `https://image.tmdb.org/t/p/w780${path}` : null;
      cache.set(imdbId, url);
      return url;
    } catch {
      cache.set(imdbId, null);
      return null;
    }
  })();
  inflight.set(imdbId, p);
  const res = await p;
  inflight.delete(imdbId);
  return res;
}
