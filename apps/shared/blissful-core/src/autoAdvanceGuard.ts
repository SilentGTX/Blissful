// "Are you still watching?" guard. Counts episodes the player auto-advanced in
// a row (Up Next countdown / end of file) so both players can stop chaining
// after N of them. The streak lives in sessionStorage: it has to survive the
// route change (and possible remount) between episodes but not a new tab or
// the next day. Any user action resets it.
//
// Shared by the web/desktop players (sessionStorage / localStorage defaults)
// and the Android TV player (injected in-memory / MMKV stores). The module
// must stay free of DOM types and import-time storage access: React Native has
// neither.

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type StorageHost = { sessionStorage?: StorageLike; localStorage?: StorageLike };

export type EpisodeTarget = { type: string; id: string; videoId: string };

export type ManualEpisode = { videoId: string; label: string | null };

export const STREAK_KEY = 'bliss:autoAdvanceStreak';
export const AUTO_START_KEY = 'bliss:lastStartWasAuto';
const MANUAL_EPISODE_PREFIX = 'bliss:lastManualEpisode:';

/** An auto-advance flag older than this is ignored: the navigation it was set
 *  for never landed (the detail-page autoplay route can take a while to
 *  resolve streams, hence the generous window). */
export const AUTO_START_TTL_MS = 5 * 60 * 1000;

function session(): StorageLike | null {
  try {
    return (globalThis as StorageHost).sessionStorage ?? null;
  } catch {
    return null;
  }
}

function local(): StorageLike | null {
  try {
    return (globalThis as StorageHost).localStorage ?? null;
  } catch {
    return null;
  }
}

export function readAutoAdvanceStreak(store: StorageLike | null = session()): number {
  if (!store) return 0;
  try {
    const n = Number.parseInt(store.getItem(STREAK_KEY) ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Count one auto-advance and flag `target` as an auto-started load (consumed
 *  once by `consumeStartKind`). Call right before the auto path navigates.
 *  Returns the new streak. */
export function markAutoAdvance(
  target: EpisodeTarget,
  store: StorageLike | null = session(),
  now: number = Date.now(),
): number {
  const streak = readAutoAdvanceStreak(store) + 1;
  if (!store) return streak;
  try {
    store.setItem(STREAK_KEY, String(streak));
    store.setItem(AUTO_START_KEY, JSON.stringify({ ...target, at: now }));
  } catch {
    // ignore
  }
  return streak;
}

export function resetAutoAdvance(store: StorageLike | null = session()): void {
  if (!store) return;
  try {
    store.removeItem(STREAK_KEY);
    store.removeItem(AUTO_START_KEY);
  } catch {
    // ignore
  }
}

/** True once the viewer has been auto-advanced `limit` episodes in a row.
 *  `limit` <= 0 means the guard is off. */
export function shouldAskStillWatching(streak: number, limit: number): boolean {
  return limit > 0 && streak >= limit;
}

/** Classify the episode load that just happened. 'auto' only when the flag the
 *  auto path set matches this exact episode and is fresh; the flag is always
 *  removed, so a later load of the same episode counts as a manual start. */
export function consumeStartKind(
  target: EpisodeTarget,
  store: StorageLike | null = session(),
  now: number = Date.now(),
): 'auto' | 'manual' {
  if (!store) return 'manual';
  try {
    const raw = store.getItem(AUTO_START_KEY);
    if (!raw) return 'manual';
    store.removeItem(AUTO_START_KEY);
    const flag = JSON.parse(raw) as Partial<EpisodeTarget> & { at?: number };
    const fresh = typeof flag.at === 'number' && now - flag.at >= 0 && now - flag.at <= AUTO_START_TTL_MS;
    return fresh
      && flag.type === target.type
      && flag.id === target.id
      && flag.videoId === target.videoId
      ? 'auto'
      : 'manual';
  } catch {
    return 'manual';
  }
}

function manualKey(type: string, id: string): string {
  return `${MANUAL_EPISODE_PREFIX}${type}:${id}`;
}

export function rememberManualEpisode(
  type: string,
  id: string,
  episode: ManualEpisode,
  store: StorageLike | null = local(),
): void {
  if (!store) return;
  try {
    store.setItem(manualKey(type, id), JSON.stringify(episode));
  } catch {
    // ignore
  }
}

export function lastManualEpisode(
  type: string,
  id: string,
  store: StorageLike | null = local(),
): ManualEpisode | null {
  if (!store) return null;
  try {
    const raw = store.getItem(manualKey(type, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManualEpisode>;
    if (typeof parsed.videoId !== 'string' || !parsed.videoId) return null;
    return {
      videoId: parsed.videoId,
      label: typeof parsed.label === 'string' && parsed.label ? parsed.label : null,
    };
  } catch {
    return null;
  }
}

/** "S1E3 · Title", "Episode 3 · Title", or null when nothing identifies it. */
export function episodeLabel(video: {
  title?: string | null;
  season?: number | null;
  episode?: number | null;
}): string | null {
  const hasEpisode = typeof video.episode === 'number' && video.episode > 0;
  const hasSeason = typeof video.season === 'number' && video.season > 0;
  let code: string | null = null;
  if (hasEpisode && hasSeason) code = `S${video.season}E${video.episode}`;
  else if (hasEpisode) code = `Episode ${video.episode}`;
  const title = video.title?.trim() || null;
  if (code && title) return `${code} · ${title}`;
  return code ?? title;
}

/** Auto-advanced episodes in a row before the player asks "Are you still
 *  watching?". 0 = never ask; missing / invalid = `fallback`. */
export function stillWatchingLimit(value: unknown, fallback = 2): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}
