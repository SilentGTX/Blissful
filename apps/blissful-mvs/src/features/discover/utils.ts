import type { MediaItem, MediaType } from '../../types/media';

export function normalizePoster(url?: string) {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

export function parseRating(value?: string | number) {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parseYear(meta: { year?: string | number; releaseInfo?: string }) {
  const y = meta.year ?? meta.releaseInfo;
  if (y === undefined) return undefined;
  const n = typeof y === 'number' ? y : Number.parseInt(String(y), 10);
  return Number.isFinite(n) ? n : undefined;
}

export function formatDate(value?: string) {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function metaToItem(meta: {
  id: string;
  type: MediaType;
  name: string;
  poster?: string;
  description?: string;
  imdbRating?: string | number;
  genres?: string[];
  year?: string | number;
  releaseInfo?: string;
}): MediaItem {
  return {
    id: meta.id,
    type: meta.type,
    title: meta.name,
    year: parseYear(meta),
    rating: parseRating(meta.imdbRating),
    genres: meta.genres,
    posterUrl: normalizePoster(meta.poster),
    blurb: meta.description,
  };
}
