import type { LibraryItem } from '../../lib/mediaTypes';
import { formatTimecode } from '../../lib/progress';

export function formatTimeMs(ms: number): string {
  return formatTimecode(Math.max(0, ms / 1000));
}

export function parseEpisodeLabel(videoId?: string | null): string | null {
  if (!videoId) return null;
  if (videoId.startsWith('kitsu:')) {
    const parts = videoId.split(':').filter(Boolean);
    const last = parts[parts.length - 1];
    const ep = Number.parseInt(String(last ?? ''), 10);
    if (Number.isFinite(ep)) return `E${ep}`;
    return null;
  }
  const parts = videoId.split(':').filter(Boolean);
  const tail = parts.slice(-2);
  const asNums = tail.map((p) => Number.parseInt(p, 10));
  if (asNums.length === 2 && asNums.every((n) => Number.isFinite(n))) {
    return `S${asNums[0]}E${asNums[1]}`;
  }
  return null;
}

export function getContinueSubtitle(item: LibraryItem): {
  text: string;
  isExternal?: boolean;
  epLabel?: string | null;
  /** When set, this row's current state came from a Stremio sync (not
   *  from local Blissful playback). The renderer shows a small badge. */
  source?: 'stremio' | 'web' | 'app' | null;
} {
  const timeOffsetMs = Math.max(0, item.state?.timeOffset ?? 0);
  const durationMs = item.state?.duration ?? 0;

  // Check if this is an external player item (00:00 progress marker)
  const isExternalPlayer = timeOffsetMs === 0 && durationMs === 1;

  const videoId = (item.state as any)?.videoId ?? (item.state as any)?.video_id;
  const epLabel = item.type === 'series' ? parseEpisodeLabel(typeof videoId === 'string' ? videoId : null) : null;
  const rawSource = (item as Record<string, unknown>)._blissProgressSource;
  const source: 'stremio' | 'web' | 'app' | null =
    rawSource === 'stremio' ? 'stremio'
    : rawSource === 'web' ? 'web'
    : rawSource === 'app' ? 'app'
    : null;

  if (isExternalPlayer) {
    return { epLabel, text: 'External progress', isExternal: true, source };
  }

  if (item.type === 'series') {
    const t = timeOffsetMs > 0 ? formatTimeMs(timeOffsetMs) : null;
    if (epLabel && t) return { epLabel, text: t, source };
    if (epLabel) return { epLabel, text: 'In progress', source };
    return { text: t ?? 'In progress', source };
  }
  return { text: formatTimeMs(timeOffsetMs), source };
}

export const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v6H4a1 1 0 0 1-1-1v-10.5Z',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  discover:
    'M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Zm3.5-13.5-2.2 6.8a1 1 0 0 1-.6.6l-6.8 2.2 2.2-6.8a1 1 0 0 1 .6-.6l6.8-2.2Z',
  library:
    'M6.5 5.5h10a2 2 0 0 1 2 2v12.25a.75.75 0 0 1-1.12.65L12 17.25 6.62 20.4a.75.75 0 0 1-1.12-.65V7.5a2 2 0 0 1 2-2Z',
  addons: 'M4 7.5h16M4 12h16M4 16.5h16M7.5 4v16',
  settings:
    'M12 2.25a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Zm0 4.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0v-7.5a.75.75 0 0 1 .75-.75Zm6-4.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Zm0 4.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0v-7.5a.75.75 0 0 1 .75-.75Zm-12 0a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0v-7.5a.75.75 0 0 1 .75-.75Zm6 9a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Z',
  logout: 'M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2m-6-5h10m0 0-3-3m3 3-3 3',
  continue: 'M12 8v5l3 2M21 12a9 9 0 1 1-9-9',
  watchParty:
    'M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a6 6 0 0 1 12 0H3Zm10 0a8 8 0 0 1 .7-3.2A6 6 0 0 1 21 20h-8Z',
};
