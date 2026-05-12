export type ProgressEntry = {
  time: number; // seconds
  duration: number; // seconds
  updatedAt: number; // ms
};

const KEY = 'blissfulProgressV1';
const FLUSH_DELAY_MS = 3_000;
const PRUNE_COUNT = 50;

type ProgressMap = Record<string, ProgressEntry>;

function makeKey(params: { type: string; id: string; videoId?: string | null }): string {
  return `${params.type}::${params.id}::${params.videoId ?? ''}`;
}

// ---------- In-memory cache ----------
let cache: ProgressMap | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function ensureCache(): ProgressMap {
  if (cache !== null) return cache;
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    cache = {};
    return cache;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      cache = {};
      return cache;
    }
    cache = parsed as ProgressMap;
  } catch {
    cache = {};
  }
  return cache;
}

function pruneOldest(map: ProgressMap, count: number): void {
  const entries = Object.entries(map).sort((a, b) => (a[1].updatedAt ?? 0) - (b[1].updatedAt ?? 0));
  for (let i = 0; i < count && i < entries.length; i++) {
    delete map[entries[i][0]];
  }
}

function writeToStorage(map: ProgressMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch (err: unknown) {
    // Quota exceeded — prune oldest entries and retry
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      pruneOldest(map, PRUNE_COUNT);
      try {
        localStorage.setItem(KEY, JSON.stringify(map));
      } catch {
        // give up silently
      }
    }
  }
}

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty || cache === null) return;
  writeToStorage(cache);
  dirty = false;
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

// Flush on tab close / mobile background
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/** Immediately flush pending progress writes to localStorage. Call on player pause. */
export function flushNow(): void {
  flush();
}

// ---------- Public API ----------

export function getProgress(params: { type: string; id: string; videoId?: string | null }): ProgressEntry | null {
  const key = makeKey(params);
  return ensureCache()[key] ?? null;
}

export function getProgressPercent(params: { type: string; id: string; videoId?: string | null }): number {
  const entry = getProgress(params);
  if (!entry) return 0;
  if (!Number.isFinite(entry.time) || entry.time <= 0) return 0;

  // Some streams (live/HLS) may not report a stable duration.
  if (!Number.isFinite(entry.duration) || entry.duration <= 0) return 2;

  return Math.max(0, Math.min(100, (entry.time / entry.duration) * 100));
}

export function isWatched(params: { type: string; id: string; videoId?: string | null }): boolean {
  return getProgressPercent(params) >= 90;
}

export function setProgress(
  params: { type: string; id: string; videoId?: string | null },
  entry: Omit<ProgressEntry, 'updatedAt'>
): void {
  const key = makeKey(params);
  const map = ensureCache();

  const prev = map[key];
  const nextDuration =
    Number.isFinite(entry.duration) && entry.duration > 0 ? entry.duration : prev?.duration ?? 0;
  map[key] = {
    time: Number.isFinite(entry.time) && entry.time > 0 ? entry.time : prev?.time ?? 0,
    duration: nextDuration,
    updatedAt: Date.now(),
  };
  dirty = true;
  scheduleFlush();
}
