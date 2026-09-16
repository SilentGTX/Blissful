// Anime filler detection for Anime Kitsu content (`kitsu:` ids).
//
// Source: MyAnimeList's per-episode "Filler" / "Recap" flags, read through
// Jikan — GET https://api.jikan.moe/v4/anime/<mal>/episodes?page=N (public,
// no auth, `Access-Control-Allow-Origin: *`, 100 episodes per page, 3 req/s).
// The Kitsu id becomes a MAL id through ani.zip (`resolveMalId`, the same
// lookup the AniSkip intro-skipper uses).
//
// Kitsu and MAL both number episodes absolutely within an entry (Bleach
// episode 64 is 64 on both), so a MAL episode number is looked up straight
// against the Kitsu video's `episode` field / id tail. Because a wrong
// mapping would badge the wrong episodes, `fillerEpisodesCompatible` compares
// MAL's episode count with the addon's list and the UI shows nothing on a
// mismatch — no data beats wrong data here.
//
// Results are cached in localStorage (a day for a hit, a few hours for a
// miss) and de-duplicated in flight, so re-opening a show doesn't re-page
// Jikan. Recaps count as skippable alongside filler: they are what the
// "skip the next N episodes" flow exists for.

import { resolveMalId } from './aniskip';
import { isKitsuId, KITSU_ID_PREFIX } from './animeKitsu';

export type FillerKind = 'filler' | 'recap';

export type FillerEpisodes = {
  malId: number;
  /** Highest episode number MAL lists for the entry (canon or not). */
  total: number;
  /** Episode number -> kind. Canon episodes are simply absent. */
  kinds: Readonly<Record<number, FillerKind>>;
};

/** A stretch of consecutive skippable (filler / recap) episodes. */
export type FillerRun = {
  first: number;
  last: number;
  count: number;
  /** First canon episode after the run, or null when the run reaches the
   *  end of what MAL lists (nothing known to skip to). */
  nextCanon: number | null;
};

export type FillerAck = { first: number; last: number };

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const PAGE_GAP_MS = 400;
const RATE_LIMIT_RETRY_MS = 1500;
const MAX_PAGES = 40;
const CACHE_PREFIX = 'bliss:animeFiller:';
const CACHE_HIT_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MISS_TTL_MS = 6 * 60 * 60 * 1000;
const ACK_PREFIX = 'bliss:fillerAck:';

/** The numeric Kitsu entry id of a show or episode id (`kitsu:244:3` -> "244"). */
export function kitsuEntryId(id: string | null | undefined): string | null {
  if (!isKitsuId(id) || !id) return null;
  const value = id.slice(KITSU_ID_PREFIX.length).split(':')[0]?.trim() ?? '';
  return /^\d+$/.test(value) ? value : null;
}

/** The episode number a Kitsu video refers to: the meta's `episode` when it
 *  has one, else the id's last segment (`kitsu:244:33` -> 33). */
export function episodeNumberOf(video: { id: string; episode?: number | null }): number | null {
  if (typeof video.episode === 'number' && Number.isFinite(video.episode) && video.episode > 0) {
    return video.episode;
  }
  const parts = video.id.split(':');
  if (parts.length < 3) return null;
  const tail = Number.parseInt(parts[parts.length - 1], 10);
  return Number.isFinite(tail) && tail > 0 ? tail : null;
}

export function fillerKindFor(
  map: FillerEpisodes | null | undefined,
  episode: number | null | undefined,
): FillerKind | null {
  if (!map || episode == null) return null;
  return map.kinds[episode] ?? null;
}

/** The run of consecutive skippable episodes starting AT `episode`, or null
 *  when that episode is canon (or unknown). */
export function fillerRunFrom(
  map: FillerEpisodes | null | undefined,
  episode: number | null | undefined,
): FillerRun | null {
  if (!map || episode == null || !map.kinds[episode]) return null;
  let last = episode;
  while (map.kinds[last + 1]) last += 1;
  const nextCanon = last + 1 <= map.total ? last + 1 : null;
  return { first: episode, last, count: last - episode + 1, nextCanon };
}

/** True for the first episode of a skippable run — the one card that should
 *  carry the "N filler episodes ahead" note (the rest just wear the badge). */
export function isFillerRunStart(
  map: FillerEpisodes | null | undefined,
  episode: number | null | undefined,
): boolean {
  if (!map || episode == null || !map.kinds[episode]) return false;
  return !map.kinds[episode - 1];
}

/** Does MAL's episode count plausibly describe the same entry as the addon's
 *  list? Lenient on purpose (an airing show can be a few episodes apart on
 *  the two sites); an unknown count (0) passes. */
export function fillerEpisodesCompatible(map: FillerEpisodes, episodeCount: number): boolean {
  if (!(episodeCount > 0) || !(map.total > 0)) return true;
  const tolerance = Math.max(10, Math.ceil(Math.max(map.total, episodeCount) * 0.15));
  return Math.abs(map.total - episodeCount) <= tolerance;
}

/** "The next 45 episodes are filler" / "The next episode is a recap". */
export function describeFillerRun(run: FillerRun, kind: FillerKind, position: 'this' | 'next'): string {
  const noun = kind === 'recap' && run.count === 1 ? 'a recap' : 'filler';
  if (run.count === 1) {
    return position === 'this' ? `This episode is ${noun}.` : `The next episode is ${noun}.`;
  }
  const range = `Episodes ${run.first}–${run.last}`;
  return position === 'this'
    ? `${range} are filler (${run.count} episodes).`
    : `The next ${run.count} episodes are filler (${range}).`;
}

// ---------------------------------------------------------------------------
// Jikan parsing

export type JikanEpisodeEntry = { episode: number; filler: boolean; recap: boolean };

/** Pull the episode flags out of one Jikan episodes page. Tolerates missing
 *  fields (older cached pages omit `recap`). */
export function parseJikanEpisodesPage(json: unknown): { entries: JikanEpisodeEntry[]; hasNext: boolean } {
  const root = (json ?? {}) as {
    pagination?: { has_next_page?: boolean };
    data?: Array<{ mal_id?: number; filler?: boolean; recap?: boolean }>;
  };
  const entries: JikanEpisodeEntry[] = [];
  for (const item of Array.isArray(root.data) ? root.data : []) {
    const episode = item?.mal_id;
    if (typeof episode !== 'number' || !Number.isFinite(episode) || episode <= 0) continue;
    entries.push({ episode, filler: item.filler === true, recap: item.recap === true });
  }
  return { entries, hasNext: root.pagination?.has_next_page === true };
}

export function buildFillerEpisodes(malId: number, entries: ReadonlyArray<JikanEpisodeEntry>): FillerEpisodes {
  const kinds: Record<number, FillerKind> = {};
  let total = 0;
  for (const e of entries) {
    if (e.episode > total) total = e.episode;
    if (e.filler) kinds[e.episode] = 'filler';
    else if (e.recap) kinds[e.episode] = 'recap';
  }
  return { malId, total, kinds };
}

// ---------------------------------------------------------------------------
// Cache (localStorage) — tiny: two integer arrays per show.

type CacheEntry = {
  v: 1;
  at: number;
  malId: number | null;
  total: number;
  filler: number[];
  recap: number[];
};

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readCachedFillerEpisodes(
  kitsuId: string,
  now = Date.now(),
): { data: FillerEpisodes | null; stale: boolean } | null {
  const store = storage('local');
  if (!store) return null;
  try {
    const raw = store.getItem(CACHE_PREFIX + kitsuId);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CacheEntry>;
    if (entry.v !== 1 || typeof entry.at !== 'number') return null;
    if (entry.malId == null) {
      return { data: null, stale: now - entry.at > CACHE_MISS_TTL_MS };
    }
    const kinds: Record<number, FillerKind> = {};
    for (const n of Array.isArray(entry.recap) ? entry.recap : []) kinds[n] = 'recap';
    for (const n of Array.isArray(entry.filler) ? entry.filler : []) kinds[n] = 'filler';
    return {
      data: { malId: entry.malId, total: typeof entry.total === 'number' ? entry.total : 0, kinds },
      stale: now - entry.at > CACHE_HIT_TTL_MS,
    };
  } catch {
    return null;
  }
}

export function writeCachedFillerEpisodes(kitsuId: string, data: FillerEpisodes | null, now = Date.now()): void {
  const store = storage('local');
  if (!store) return;
  const entry: CacheEntry = data
    ? {
        v: 1,
        at: now,
        malId: data.malId,
        total: data.total,
        filler: Object.entries(data.kinds).filter(([, k]) => k === 'filler').map(([n]) => Number(n)),
        recap: Object.entries(data.kinds).filter(([, k]) => k === 'recap').map(([n]) => Number(n)),
      }
    : { v: 1, at: now, malId: null, total: 0, filler: [], recap: [] };
  try {
    store.setItem(CACHE_PREFIX + kitsuId, JSON.stringify(entry));
  } catch {
    // Quota / private mode — the in-memory result still serves this session.
  }
}

// ---------------------------------------------------------------------------
// Fetch

const inflight = new Map<string, Promise<FillerEpisodes | null>>();

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

async function fetchJikanPage(malId: number, page: number, signal?: AbortSignal): Promise<unknown> {
  const url = `${JIKAN_BASE}/anime/${malId}/episodes?page=${page}`;
  let res = await fetch(url, { signal });
  if (res.status === 429) {
    await sleep(RATE_LIMIT_RETRY_MS, signal);
    res = await fetch(url, { signal });
  }
  if (!res.ok) throw new Error(`jikan ${res.status}`);
  return res.json();
}

/** Resolve the filler map for a Kitsu entry: Kitsu -> MAL (ani.zip), then
 *  every Jikan episodes page. Null when the entry has no MAL mapping or the
 *  lookup fails part-way (a partial list would badge later episodes as canon).
 *  Writes the cache on both outcomes; concurrent callers share one request. */
export function fetchFillerEpisodes(kitsuId: string, signal?: AbortSignal): Promise<FillerEpisodes | null> {
  const existing = inflight.get(kitsuId);
  if (existing) return existing;
  const task = (async (): Promise<FillerEpisodes | null> => {
    const malId = await resolveMalId('kitsu', kitsuId, signal);
    if (!malId) {
      writeCachedFillerEpisodes(kitsuId, null);
      return null;
    }
    const entries: JikanEpisodeEntry[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const parsed = parseJikanEpisodesPage(await fetchJikanPage(malId, page, signal));
      entries.push(...parsed.entries);
      if (!parsed.hasNext) break;
      await sleep(PAGE_GAP_MS, signal);
    }
    const data = buildFillerEpisodes(malId, entries);
    writeCachedFillerEpisodes(kitsuId, data);
    return data;
  })();
  // A failure leaves the cache alone (a stale hit keeps serving) and is not
  // memoised, so the next mount retries.
  const tracked = task.finally(() => {
    inflight.delete(kitsuId);
  });
  inflight.set(kitsuId, tracked);
  return tracked;
}

// ---------------------------------------------------------------------------
// "Watch anyway" acknowledgements — per show, per tab. Once the viewer has
// chosen to watch a filler run, the rest of that run plays without asking
// again (badges stay). Session-scoped so a fresh visit asks once more.

export function isFillerAcknowledged(acks: ReadonlyArray<FillerAck>, episode: number): boolean {
  return acks.some((a) => episode >= a.first && episode <= a.last);
}

export function readFillerAcks(metaId: string | null | undefined): FillerAck[] {
  const store = storage('session');
  if (!store || !metaId) return [];
  try {
    const raw = store.getItem(ACK_PREFIX + metaId);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is FillerAck =>
        !!a && typeof a === 'object'
        && typeof (a as FillerAck).first === 'number'
        && typeof (a as FillerAck).last === 'number',
    );
  } catch {
    return [];
  }
}

export function acknowledgeFillerRun(metaId: string | null | undefined, run: FillerAck): FillerAck[] {
  const next = [...readFillerAcks(metaId).filter((a) => !(a.first === run.first && a.last === run.last)), { first: run.first, last: run.last }];
  const store = storage('session');
  if (store && metaId) {
    try {
      store.setItem(ACK_PREFIX + metaId, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}
