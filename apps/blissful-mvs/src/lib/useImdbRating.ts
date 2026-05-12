import { useEffect, useState } from 'react';

const ratingCache = new Map<string, number | null>();

function parseRatingFromHtml(html: string): number | null {
  const aggregateMatch = html.match(/"aggregateRating"\s*:\s*\{[^}]*"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/s);
  const fallbackMatch = html.match(/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/);
  const raw = aggregateMatch?.[1] ?? fallbackMatch?.[1];
  if (!raw) return null;

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0 || value > 10) return null;
  return value;
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

  try {
    const url = `https://m.imdb.com/title/${imdbId}/`;
    const response = await fetch(`/addon-proxy?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      ratingCache.set(imdbId, null);
      return null;
    }

    const html = await response.text();
    const rating = parseRatingFromHtml(html);
    ratingCache.set(imdbId, rating);
    if (rating !== null) {
      sessionStorage.setItem(storageKey, rating.toString());
    }
    return rating;
  } catch {
    ratingCache.set(imdbId, null);
    return null;
  }
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
