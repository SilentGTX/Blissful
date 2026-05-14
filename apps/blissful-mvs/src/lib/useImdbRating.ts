import { useEffect, useState } from 'react';
import { readStoredPlayerSettings } from './playerSettings';

// In-memory rating cache for the current session. Keyed by IMDB ID.
// Successful lookups also write through to sessionStorage so a
// reload doesn't re-fire every request. `null` entries indicate a
// confirmed miss; we keep them in-memory but DON'T persist them
// — a transient IMDB outage or upstream-proxy hiccup would
// otherwise stamp the user's session with permanent null ratings.
const ratingCache = new Map<string, number | null>();

/** Try several known IMDB / Cinemeta JSON structures to recover the
 *  rating. IMDB's www site changes its DOM regularly but always
 *  embeds the rating in at least one of: JSON-LD `aggregateRating`,
 *  the Next.js `__NEXT_DATA__` blob's `ratingsSummary`, or a bare
 *  `"ratingValue": ...` somewhere in the page. Cinemeta's
 *  `meta.imdbRating` is a clean fallback when scraping is blocked. */
function parseRatingFromHtml(html: string): number | null {
  // 1. JSON-LD: `"aggregateRating": { ... "ratingValue": 8.5 }`.
  //    Matches both quoted ("8.5") and bare (8.5) numeric forms.
  const jsonLdMatch = html.match(
    /"aggregateRating"\s*:\s*\{[^}]*?"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/s,
  );
  if (jsonLdMatch) {
    const v = Number.parseFloat(jsonLdMatch[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 10) return v;
  }

  // 2. __NEXT_DATA__ ratingsSummary (IMDB's current Next.js shell):
  //    `"ratingsSummary":{"aggregateRating":8.5,"voteCount":1234}`
  const nextDataMatch = html.match(
    /"ratingsSummary"\s*:\s*\{[^}]*?"aggregateRating"\s*:\s*([0-9]+(?:\.[0-9]+)?)/s,
  );
  if (nextDataMatch) {
    const v = Number.parseFloat(nextDataMatch[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 10) return v;
  }

  // 3. Bare `"ratingValue": "8.5"` anywhere in the page (less
  //    specific — only used when the structured matches above
  //    failed). Useful for fallback embeds and OpenGraph fragments.
  const bareMatch = html.match(/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/);
  if (bareMatch) {
    const v = Number.parseFloat(bareMatch[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 10) return v;
  }

  return null;
}

/** Hit Cinemeta directly for the imdbRating field. Cinemeta is the
 *  same metadata source the home rows already use, so this gets us a
 *  rating for any title the rest of the app could render at all —
 *  without needing IMDB to be scrape-able through the upstream
 *  proxy. */
async function fetchRatingFromCinemeta(imdbId: string): Promise<number | null> {
  // Cinemeta exposes both movie/{id} and series/{id} endpoints;
  // we don't know the type ahead of time in this hook so we try
  // movie first, fall back to series. The first 404 is silent.
  const bases = [
    `https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`,
    `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`,
  ];
  for (const url of bases) {
    try {
      const response = await fetch(`/addon-proxy?url=${encodeURIComponent(url)}`);
      if (!response.ok) continue;
      const data = (await response.json()) as { meta?: { imdbRating?: string | number } };
      const raw = data?.meta?.imdbRating;
      if (raw == null || raw === '') continue;
      const v = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
      if (Number.isFinite(v) && v >= 0 && v <= 10) return v;
    } catch {
      // try next base
    }
  }
  return null;
}

/** Strategy C: TMDB v3 `find` endpoint. Looks up the IMDB ID and
 *  returns the matching movie or TV result's `vote_average` (0-10
 *  scale, same as IMDB). Useful for brand-new releases that IMDB
 *  hasn't crossed its vote threshold for — TMDB ships a rating as
 *  soon as a handful of reviews are in. Requires a free TMDB v3
 *  API key configured in `Settings → Advanced`; returns null if no
 *  key is set so the app stays functional out of the box. */
async function fetchRatingFromTmdb(imdbId: string): Promise<number | null> {
  const apiKey = readStoredPlayerSettings().tmdbApiKey.trim();
  if (!apiKey) return null;

  const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${encodeURIComponent(apiKey)}&external_source=imdb_id`;
  try {
    const response = await fetch(`/addon-proxy?url=${encodeURIComponent(url)}`);
    if (!response.ok) return null;
    const data = (await response.json()) as {
      movie_results?: Array<{ vote_average?: number }>;
      tv_results?: Array<{ vote_average?: number }>;
    };
    // TMDB returns the IMDB ID in whichever bucket matches — try
    // movies first, then TV. `vote_average` is already a 0-10 float.
    const candidates = [
      data.movie_results?.[0]?.vote_average,
      data.tv_results?.[0]?.vote_average,
    ];
    for (const v of candidates) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10) {
        return v;
      }
    }
    return null;
  } catch {
    return null;
  }
}

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

  // Strategy A: scrape www.imdb.com (m.imdb.com is deprecated and
  // 301s to www, which sometimes loses the JSON-LD block in the
  // upstream proxy's hop). Use the canonical www host directly.
  try {
    const url = `https://www.imdb.com/title/${imdbId}/`;
    const response = await fetch(`/addon-proxy?url=${encodeURIComponent(url)}`);
    if (response.ok) {
      const html = await response.text();
      const rating = parseRatingFromHtml(html);
      if (rating !== null) {
        ratingCache.set(imdbId, rating);
        sessionStorage.setItem(storageKey, rating.toString());
        return rating;
      }
    }
  } catch {
    // fall through to Cinemeta
  }

  // Strategy B: Cinemeta meta endpoint. Reliable, no scraping,
  // available for every title the home/discover rows can show.
  const fromCinemeta = await fetchRatingFromCinemeta(imdbId);
  if (fromCinemeta !== null) {
    ratingCache.set(imdbId, fromCinemeta);
    sessionStorage.setItem(storageKey, fromCinemeta.toString());
    return fromCinemeta;
  }

  // Strategy C: TMDB. Only fires if the user configured a TMDB API
  // key in Settings → Advanced. Closes the gap for new releases
  // that IMDB doesn't rate yet.
  const fromTmdb = await fetchRatingFromTmdb(imdbId);
  if (fromTmdb !== null) {
    ratingCache.set(imdbId, fromTmdb);
    sessionStorage.setItem(storageKey, fromTmdb.toString());
    return fromTmdb;
  }

  // All strategies missed — cache the miss in-memory only so a
  // retry happens on the next session reload (no sessionStorage
  // write).
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
