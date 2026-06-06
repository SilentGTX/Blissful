import { fetchBlissfulLibrary, type LibraryItem } from '@blissful/core';

export type CwItem = {
  id: string;
  type: string;
  name: string;
  poster?: string;
  progress: number; // 0..100
};

function mtimeMs(item: LibraryItem): number {
  const t = item._mtime;
  if (typeof t === 'string') {
    const p = Date.parse(t);
    return Number.isFinite(p) ? p : 0;
  }
  return typeof t === 'number' ? t : 0;
}

// libraryProgressPercent (features/home/utils.ts) + the ms-vs-seconds heuristic.
export function progressPercent(item: LibraryItem): number | null {
  let offset = item.state?.timeOffset;
  let duration = item.state?.duration;
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset <= 0) return null;
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    if (duration >= 10000 || offset >= 10000) {
      offset /= 1000;
      duration /= 1000;
    }
    return Math.min(100, Math.max(0, (offset / duration) * 100));
  }
  return 2; // duration unknown -> 2% sentinel
}

// useContinueWatching pipeline: in-progress items, newest first.
export async function fetchContinueWatching(token: string): Promise<CwItem[]> {
  const items = await fetchBlissfulLibrary<LibraryItem>(token);
  // NOTE: match useContinueWatching exactly — it does NOT filter `removed`
  // (soft-removed items keep their progress and still appear in CW).
  return items
    .filter((it) => typeof it.state?.timeOffset === 'number')
    .filter((it) => {
      const o = it.state!.timeOffset as number;
      const d = it.state?.duration;
      return o > 0 || (o === 0 && d === 1); // progress, or the external-player marker
    })
    .sort((a, b) => mtimeMs(b) - mtimeMs(a))
    .slice(0, 14)
    .map((it) => ({
      id: it._id,
      type: it.type,
      name: it.name,
      poster: it.poster ?? undefined,
      progress: progressPercent(it) ?? 0,
    }));
}
