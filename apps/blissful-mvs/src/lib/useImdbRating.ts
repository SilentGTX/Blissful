import { useEffect, useState } from 'react';

// In-memory rating cache for the current session, keyed by IMDB ID.
// Successful lookups also write through to sessionStorage so a reload
// doesn't re-fire every request. `null` entries are a confirmed miss:
// kept in-memory but NOT persisted — a transient outage would otherwise
// stamp the user's session with a permanent null rating.
const ratingCache = new Map<string, number | null>();

/** Ratings are resolved AND cached server-side by the addon-proxy
 *  (`/imdb-rating`: Cinemeta `imdbRating` → TMDB `vote_average`, keyed by
 *  IMDB id, ~24h on the Mac/NAS). The client just asks once and layers its
 *  own in-memory + sessionStorage cache on top, so a grid of cards costs at
 *  most one tiny request per title — and zero on revisit. This replaced the
 *  old per-client chain (scrape www.imdb.com → Cinemeta → TMDB-with-user-key);
 *  moving it server-side also means the TMDB fallback works for everyone
 *  (proxy key), not just users who set their own key in Settings. */
async function fetchImdbRating(imdbId: string): Promise<number | null> {
  if (!/^tt\d{5,}$/.test(imdbId)) return null;

  if (ratingCache.has(imdbId)) {
    return ratingCache.get(imdbId) ?? null;
  }

  const storageKey = `bliss:imdb-rating:${imdbId}`;
  const stored = sessionStorage.getItem(storageKey);
  if (stored) {
    const parsed = Number.parseFloat(stored);
    if (Number.isFinite(parsed)) {
      ratingCache.set(imdbId, parsed);
      return parsed;
    }
  }

  try {
    const response = await fetch(`/imdb-rating?imdbId=${encodeURIComponent(imdbId)}`);
    if (response.ok) {
      const data = (await response.json()) as { rating?: number | null };
      const v = typeof data?.rating === 'number' ? data.rating : null;
      if (v !== null && Number.isFinite(v) && v > 0 && v <= 10) {
        ratingCache.set(imdbId, v);
        sessionStorage.setItem(storageKey, v.toString());
        return v;
      }
    }
  } catch {
    // network / upstream hiccup — fall through to a cached miss
  }

  // All sources missed — cache the miss in-memory only so a retry happens on
  // the next session reload (no sessionStorage write).
  ratingCache.set(imdbId, null);
  return null;
}

export function useImdbRating(imdbId: string | null | undefined, initialRating?: number | null): number | null {
  const [rating, setRating] = useState<number | null>(initialRating ?? null);

  useEffect(() => {
    setRating(initialRating ?? null);
  }, [imdbId, initialRating]);

  useEffect(() => {
    if (!imdbId) return;
    if (initialRating !== undefined && initialRating !== null) return;

    let cancelled = false;
    void fetchImdbRating(imdbId).then((next) => {
      if (!cancelled && next !== null) {
        setRating(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [imdbId, initialRating]);

  return rating;
}
