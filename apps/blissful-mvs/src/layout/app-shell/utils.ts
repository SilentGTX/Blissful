import type { MediaItem, MediaType } from '../../types/media';
import type { HomeRowPrefs } from '../../lib/homeRows';
import type { LibraryItem } from '../../lib/stremioApi';
import {
  GRADIENT_OPTIONS,
  HOME_PREFS_KEY,
  SEARCH_HISTORY_KEY,
  SEARCH_HISTORY_LIMIT,
} from './constants';

export function getResumeSeconds(item: LibraryItem): number | null {
  const rawOffset = item.state?.timeOffset;
  if (typeof rawOffset !== 'number' || !Number.isFinite(rawOffset) || rawOffset <= 0) return null;

  const dur = item.state?.duration;
  const looksLikeMs =
    (typeof dur === 'number' && Number.isFinite(dur) && dur >= 10_000) || rawOffset >= 10_000;

  return looksLikeMs ? rawOffset / 1000 : rawOffset;
}

export function extractImdbId(value: string): string | null {
  const ttMatch = value.match(/tt\d{5,}/);
  return ttMatch ? ttMatch[0] : null;
}

export function normalizePossibleUrl(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (v.startsWith('stremio://')) {
    v = `https://${v.slice('stremio://'.length)}`;
  }
  try {
    return new URL(v).toString();
  } catch {
    return null;
  }
}

export function isLikelyManifestUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.endsWith('/manifest.json') || u.pathname.endsWith('manifest.json');
  } catch {
    return false;
  }
}

export function isPlayableUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.endsWith('.m3u8') ||
    lower.endsWith('.mpd') ||
    lower.endsWith('.mp4') ||
    lower.includes('.m3u8?') ||
    lower.includes('.mpd?') ||
    lower.includes('.mp4?')
  );
}

export function applyGradient(key: string, isDark: boolean) {
  const option = GRADIENT_OPTIONS.find((g) => g.key === key);
  if (!option) return;
  const gradient = isDark ? option.dark : option.light;
  document.documentElement.style.setProperty('--dynamic-bg', gradient);
}

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

export function readStoredSearchHistory(): string[] {
  const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function writeStoredSearchHistory(items: string[]): void {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(items.slice(0, SEARCH_HISTORY_LIMIT)));
}

export function readStoredHomePrefs(): HomeRowPrefs | null {
  const raw = localStorage.getItem(HOME_PREFS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as HomeRowPrefs;
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) return null;
    return parsed;
  } catch {
    return null;
  }
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

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  const platform = (navigator as any).platform as string | undefined;
  const maxTouchPoints = (navigator as any).maxTouchPoints as number | undefined;
  return platform === 'MacIntel' && typeof maxTouchPoints === 'number' && maxTouchPoints > 1;
}

export function openInVlc(url: string): void {
  const encoded = encodeURIComponent(url);
  try {
    window.location.href = `vlc-x-callback://x-callback-url/stream?url=${encoded}`;
    return;
  } catch {
    // ignore
  }
  try {
    window.location.href = `vlc://${url}`;
  } catch {
    // ignore
  }
}

export function parsePromptTitleLines(title: string): {
  primary: string;
  secondary: string | null;
  meta: string | null;
} {
  const lines = title
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const primary = lines[0] ?? title;
  const rest = lines.slice(1);

  const isMetaLine = (line: string): boolean => {
    return (
      /[👤👥💾⚙️]/u.test(line) ||
      /\bseed(?:er|ers)?\b/i.test(line) ||
      /\bsize\b/i.test(line) ||
      /\b\d+(?:[\.,]\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB)\b/i.test(line)
    );
  };

  const isFilenameLine = (line: string): boolean => {
    return /\.(mkv|mp4|m3u8)(\b|$)/i.test(line);
  };

  const secondary = rest.find(isFilenameLine) ?? (rest.length > 0 ? rest[0] : null);
  const meta = rest.find(isMetaLine) ?? null;

  return { primary, secondary, meta };
}

export function splitMetaLine(meta: string): {
  seeders: string | null;
  size: string | null;
  provider: string | null;
} {
  const seeders = meta.match(/👤\s*[^💾⚙️]+/u)?.[0]?.trim() ?? null;
  const size =
    meta.match(/💾\s*[^⚙️]+/u)?.[0]?.trim() ??
    (() => {
      const m = meta.match(/\b\d+(?:[\.,]\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB)\b/i);
      return m ? `💾 ${m[0].replace(',', '.').trim()}` : null;
    })();
  const provider = meta.match(/⚙️\s*(.*)$/u)?.[0]?.trim() ?? null;
  return { seeders, size, provider };
}
