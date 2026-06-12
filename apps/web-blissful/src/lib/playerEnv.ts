// Tiny env / formatting helpers used by BlissfulPlayer + the rest of
// the player module graph. Lifted out of BlissfulPlayer.tsx so the
// dependency graph is one-directional (player components → lib,
// never lib → component).

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function safeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Can the browser decode HEVC (H.265) via MSE? Chrome on Mac/Windows
// returns false here; Safari (and some Edge builds with HW HEVC)
// return true. Result is cached because the codec set doesn't change
// during a session.
//
// Used to filter 4K options out of the quality picker — typical 4K
// HLS streams are encoded as HEVC and MSE refuses to attach a source
// buffer for them on unsupported browsers, which manifests as
// "constant buffering with no video" + `bufferAddCodecError`.
let hevcSupportCache: boolean | null = null;
export function canPlayHevc(): boolean {
  if (hevcSupportCache != null) return hevcSupportCache;
  try {
    const MS = (window as { MediaSource?: { isTypeSupported(t: string): boolean } }).MediaSource;
    if (!MS || typeof MS.isTypeSupported !== 'function') {
      hevcSupportCache = false;
      return false;
    }
    // Try the two common 4K HEVC codec strings (Main10 and Main).
    hevcSupportCache =
      MS.isTypeSupported('video/mp4; codecs="hvc1.2.4.L150.B0"')
      || MS.isTypeSupported('video/mp4; codecs="hvc1.1.6.L150.B0"')
      || MS.isTypeSupported('video/mp4; codecs="hev1.1.6.L150.B0"');
  } catch {
    hevcSupportCache = false;
  }
  return hevcSupportCache!;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ can report itself as Macintosh.
  const platform = (navigator as { platform?: string }).platform;
  const maxTouchPoints = (navigator as { maxTouchPoints?: number }).maxTouchPoints;
  if (platform === 'MacIntel' && typeof maxTouchPoints === 'number' && maxTouchPoints > 1) return true;
  return false;
}

export function parseTitleLines(title: string | null): {
  primary: string | null;
  secondary: string | null;
  meta: string | null;
} {
  if (!title) return { primary: null, secondary: null, meta: null };
  const lines = title
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    primary: lines[0] ?? null,
    secondary: lines[1] ?? null,
    meta: lines.slice(2).join(' · ') || null,
  };
}

export function shortenTitle(title: string | null): string | null {
  if (!title) return null;
  const line = title.split(/\r?\n/)[0] ?? '';
  const slashSplit = line.split(' / ')[0] ?? line;
  const dashSplit = slashSplit.split(' - ')[0] ?? slashSplit;
  const bracketSplit = dashSplit.split(' [')[0] ?? dashSplit;
  const cleaned = bracketSplit.replace(/[\[\(].*?[\]\)]/g, '').trim();
  return cleaned || title;
}

export function parseSeriesInfo(videoId: string | null): { season?: number; episode?: number } | undefined {
  if (!videoId) return undefined;
  const parts = videoId.split(':');
  if (parts.length < 3) return undefined;
  const season = Number.parseInt(parts[parts.length - 2], 10);
  const episode = Number.parseInt(parts[parts.length - 1], 10);
  const result: { season?: number; episode?: number } = {};
  if (Number.isFinite(season) && season > 0) result.season = season;
  if (Number.isFinite(episode) && episode > 0) result.episode = episode;
  return result.season || result.episode ? result : undefined;
}

// Lightweight client → server log sink. Each call also POSTs the line
// to `/player-log` so the addon-proxy can persist it for post-incident
// analysis (mid-playback HLS errors, MediaSource swaps, etc.). The
// console.info keeps DevTools usable while watching; the fetch is
// fire-and-forget with keepalive so a pagehide doesn't drop the tail.
export function playerLog(line: string): void {
  // eslint-disable-next-line no-console
  console.info(line);
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : '';
    fetch('/player-log', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: `[${ua}] ${line}`,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // navigator/fetch may be unavailable in some contexts — ignore
  }
}
