import { useEffect, useState } from 'react';
import { getStorageBaseUrl } from '@blissful/core';

// Resolve an IMDb rating, with the same server-side TMDB fallback the old app
// uses: when a title has no inline rating, hit GET /imdb-rating?imdbId=tt..
// (the backend maps Cinemeta imdbRating → TMDB vote_average + caches ~24h).
const IMDB_RE = /^tt\d{5,}$/;
const cache = new Map<string, number | null>();

function parseRating(value?: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// /imdb-rating sits at the backend root, a sibling of /storage.
function ratingBase(): string {
  return getStorageBaseUrl().replace(/\/storage\/?$/, '');
}

/** Returns the resolved rating (number) or null. Only fetches when there's no
 *  inline rating and the id is a valid imdb id. Deduped + in-memory cached. */
export function useImdbRating(imdbId: string | null, initialRating?: string | number | null): number | null {
  const seed = parseRating(initialRating);
  const [resolved, setResolved] = useState<number | null>(seed);

  useEffect(() => {
    if (seed != null) {
      setResolved(seed);
      return; // already have a rating — never fetch
    }
    if (!imdbId || !IMDB_RE.test(imdbId)) {
      setResolved(null);
      return;
    }
    if (cache.has(imdbId)) {
      setResolved(cache.get(imdbId) ?? null);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    fetch(`${ratingBase()}/imdb-rating?imdbId=${encodeURIComponent(imdbId)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { rating?: number | null } | null) => {
        const v = data && typeof data.rating === 'number' && Number.isFinite(data.rating) && data.rating > 0 && data.rating <= 10 ? data.rating : null;
        cache.set(imdbId, v);
        if (!cancelled) setResolved(v);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [imdbId, seed]);

  return resolved ?? seed;
}
