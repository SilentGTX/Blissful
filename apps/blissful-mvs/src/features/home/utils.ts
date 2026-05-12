import type { LibraryItem } from '../../lib/stremioApi';
import { normalizeStremioImage } from '../../lib/stremioApi';
import type { MediaItem } from '../../types/media';

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function mapTransportUrl(url: string) {
  let next = url.trim();
  if (next.startsWith('stremio://')) {
    next = `http://${next.slice('stremio://'.length)}`;
  }

  try {
    const parsed = new URL(next);
    const isLocal =
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '::1';

    if (isLocal) {
      parsed.hostname = 'host.docker.internal';
      if (!parsed.port) {
        parsed.port = parsed.protocol === 'https:' ? '12470' : '11470';
      }
      return parsed.toString().replace(/\/$/, '');
    }
  } catch {
    // ignore
  }

  if (next.startsWith('http://')) {
    next = `https://${next.slice('http://'.length)}`;
  }
  return next;
}

export function parseRating(value?: string | number) {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

export function libraryProgressPercent(item: LibraryItem): number | null {
  const offset = typeof item.state?.timeOffset === 'number' ? item.state.timeOffset : null;
  const duration = typeof item.state?.duration === 'number' ? item.state.duration : null;
  if (offset === null || !Number.isFinite(offset) || offset <= 0) return null;
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return 2;
  return Math.min(100, Math.max(0, (offset / duration) * 100));
}

export function libraryItemToMediaItem(item: LibraryItem, lookup?: Map<string, MediaItem>): MediaItem {
  const meta = lookup?.get(item._id);
  const posterUrl = normalizeStremioImage(item.poster);
  return {
    id: item._id,
    type: item.type,
    title: item.name,
    posterUrl: posterUrl ?? meta?.posterUrl,
    year: meta?.year,
    rating: meta?.rating,
    genres: meta?.genres,
    runtime: meta?.runtime,
    blurb: meta?.blurb,
  };
}
