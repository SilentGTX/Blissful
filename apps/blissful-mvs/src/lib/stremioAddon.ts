import type { MediaType } from '../types/media';

export type StremioAddonManifest = {
  id: string;
  name: string;
  version: string;
  catalogs?: Array<{
    type: MediaType;
    id: string;
    name: string;
    extraSupported?: string[];
    extra?: Array<{
      name: string;
    }>;
  }>;
};

export type StremioMetaPreview = {
  id: string;
  type: MediaType;
  name: string;
  poster?: string;
  posterShape?: 'poster' | 'landscape' | 'square';
  description?: string;
  releaseInfo?: string;
  year?: string | number;
  imdbRating?: string | number;
  genres?: string[];
};

export type StremioCatalogResponse = {
  metas: StremioMetaPreview[];
  hasMore?: boolean;
};

export type StremioMetaDetail = {
  meta: {
    id: string;
    type: MediaType;
    name: string;
    logo?: string;
    poster?: string;
    background?: string;
    description?: string;
    releaseInfo?: string;
    released?: string;
    year?: string | number;
    imdbRating?: string | number;
    runtime?: string;
    genres?: string[];
    genre?: string[];
    cast?: string[];
    imdb_id?: string;
    director?: string[];
    trailerStreams?: Array<{ title?: string; ytId?: string }>; // cinemeta
    videos?: Array<{
      id: string;
      title?: string;
      name?: string;
      season?: number;
      episode?: number;
      number?: number;
      released?: string;
      thumbnail?: string;
      overview?: string;
      description?: string;
    }>;
  };
};

export type StremioStream = {
  name?: string;
  title?: string;
  description?: string;
  infoHash?: string;
  fileIdx?: number;
  sources?: string[];
  url?: string;
  behaviorHints?: Record<string, unknown>;
};

export type StremioStreamsResponse = {
  streams: StremioStream[];
};

export type StremioSubtitle = {
  id?: string;
  url: string;
  lang?: string;
  /** OpenSubtitles "good" rating — higher = more downloads / better
   *  community rating. Stremio picks the highest-rated variant when
   *  multiple subs exist for the same language; we pass it through so
   *  the player can do the same selection. Note OpenSubtitles serves
   *  it as a numeric string, not a number. */
  g?: string | number;
};

export type StremioSubtitlesResponse = {
  subtitles: StremioSubtitle[];
};

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

type CacheEntry<T> = { value: T; expiresAt: number };
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const STALE_SWEEP_INTERVAL_MS = 60 * 1000;

const manifestCache = new Map<string, CacheEntry<StremioAddonManifest>>();
const catalogCache = new Map<string, CacheEntry<StremioCatalogResponse>>();
const metaCache = new Map<string, CacheEntry<StremioMetaDetail>>();
const streamsCache = new Map<string, CacheEntry<StremioStreamsResponse>>();
const subtitlesCache = new Map<string, CacheEntry<StremioSubtitlesResponse>>();

// All caches for stale sweep iteration
const allCaches: Map<string, CacheEntry<unknown>>[] = [
  manifestCache as Map<string, CacheEntry<unknown>>,
  catalogCache as Map<string, CacheEntry<unknown>>,
  metaCache as Map<string, CacheEntry<unknown>>,
  streamsCache as Map<string, CacheEntry<unknown>>,
  subtitlesCache as Map<string, CacheEntry<unknown>>,
];

// Periodic stale sweep: remove expired entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const cache of allCaches) {
    for (const [key, entry] of cache) {
      if (now > entry.expiresAt) cache.delete(key);
    }
  }
}, STALE_SWEEP_INTERVAL_MS);

function normalizeAddonBaseUrl(baseUrl: string): string {
  let next = baseUrl.trim();

  if (next.startsWith('stremio://')) {
    next = `http://${next.slice('stremio://'.length)}`;
  }

  if (next.startsWith('//')) {
    next = `https:${next}`;
  }

  if (!/^https?:\/\//i.test(next)) {
    next = `https://${next}`;
  }

  try {
    const parsed = new URL(next);
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1') {
      parsed.hostname = 'host.docker.internal';
      if (!parsed.port) {
        parsed.port = parsed.protocol === 'https:' ? '12470' : '11470';
      }
      next = parsed.toString();
    }
  } catch {
    // keep best-effort URL
  }

  return next.replace(/\/$/, '');
}

const resolveAddonFetchUrl = (targetUrl: string) => `/addon-proxy?url=${encodeURIComponent(targetUrl)}`;

function getCacheKey(baseUrl: string, parts: Array<string>) {
  return [baseUrl.replace(/\/$/, ''), ...parts].join('|');
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  // Evict oldest entries if cache exceeds max size (Map preserves insertion order)
  if (cache.size > MAX_CACHE_ENTRIES) {
    const excess = cache.size - MAX_CACHE_ENTRIES;
    const keys = cache.keys();
    for (let i = 0; i < excess; i++) {
      const oldest = keys.next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
}

export async function fetchAddonManifest(
  baseUrl: string = CINEMETA_BASE,
  signal?: AbortSignal,
): Promise<StremioAddonManifest> {
  const normalizedBase = normalizeAddonBaseUrl(baseUrl);
  const key = getCacheKey(normalizedBase, ['manifest']);
  const cached = getCached(manifestCache, key);
  if (cached) return cached;

  const res = await fetch(resolveAddonFetchUrl(`${normalizedBase}/manifest.json`), { signal });
  if (!res.ok) {
    throw new Error(`Failed to load addon manifest (${res.status})`);
  }

  const manifest = (await res.json()) as StremioAddonManifest;
  setCached(manifestCache, key, manifest);
  return manifest;
}

export async function fetchCatalog(params: {
  type: MediaType;
  id: string;
  baseUrl?: string;
  extra?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}): Promise<StremioCatalogResponse> {
  const baseUrl = normalizeAddonBaseUrl(params.baseUrl ?? CINEMETA_BASE);

  // Stremio addon protocol encodes catalog "extra" in the URL path:
  // /catalog/:type/:id/<extra>.json  (e.g. /catalog/movie/top/search=batman&skip=50.json)
  // Many Stremio services (including cinemeta) won't honor query-string extras.
  const extraEntries = Object.entries(params.extra ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, String(value)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const extraSegment = extraEntries
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  const url =
    extraSegment.length > 0
      ? `${baseUrl}/catalog/${params.type}/${params.id}/${extraSegment}.json`
      : `${baseUrl}/catalog/${params.type}/${params.id}.json`;

  const cacheKey = getCacheKey(baseUrl, ['catalog', params.type, params.id, extraSegment]);
  const cached = getCached(catalogCache, cacheKey);
  if (cached) return cached;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
    signal: params.signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to load catalog ${params.type}/${params.id} (${res.status})`);
  }

  const catalog = (await res.json()) as StremioCatalogResponse;
  setCached(catalogCache, cacheKey, catalog);
  return catalog;
}

export async function fetchMeta(params: {
  type: MediaType;
  id: string;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<StremioMetaDetail> {
  const baseUrl = normalizeAddonBaseUrl(params.baseUrl ?? CINEMETA_BASE);

  const cacheKey = getCacheKey(baseUrl, ['meta', params.type, params.id]);
  const cached = getCached(metaCache, cacheKey);
  if (cached) return cached;

  const targetUrl = `${baseUrl}/meta/${params.type}/${params.id}.json`;
  const res = await fetch(resolveAddonFetchUrl(targetUrl), {
    headers: {
      Accept: 'application/json',
    },
    signal: params.signal,
  });
  if (!res.ok) {
    if (res.status === 403 || res.status === 404 || res.status === 410 || res.status === 502) {
      return { meta: { id: params.id, type: params.type, name: '' } };
    }
    throw new Error(`Failed to load meta ${params.type}/${params.id} (${res.status})`);
  }

  const meta = (await res.json()) as StremioMetaDetail;
  setCached(metaCache, cacheKey, meta);
  return meta;
}

export async function fetchStreams(params: {
  type: MediaType;
  id: string;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<StremioStreamsResponse> {
  const baseUrl = normalizeAddonBaseUrl(params.baseUrl ?? CINEMETA_BASE);
  const cacheKey = getCacheKey(baseUrl, ['stream', params.type, params.id]);
  const cached = getCached(streamsCache, cacheKey);
  if (cached) return cached;

  const targetUrl = `${baseUrl}/stream/${params.type}/${encodeURIComponent(params.id)}.json`;
  const res = await fetch(resolveAddonFetchUrl(targetUrl), {
    headers: {
      Accept: 'application/json',
    },
    signal: params.signal,
  });
  if (!res.ok) {
    if (res.status === 403 || res.status === 404 || res.status === 410) {
      return { streams: [] };
    }
    throw new Error(`Failed to load streams ${params.type}/${params.id} (${res.status})`);
  }
  const streams = (await res.json()) as StremioStreamsResponse;
  setCached(streamsCache, cacheKey, streams);
  return streams;
}

export async function fetchSubtitles(params: {
  type: MediaType;
  id: string;
  baseUrl?: string;
  signal?: AbortSignal;
  /** OpenSubtitles 8-byte file hash (hex). When supplied, hash-aware
   *  addons return PERFECTLY synced subs (hash-matched to this exact
   *  file). Without it, addons fall back to language-only matching
   *  which is what causes the "subtitles off by 10 seconds" problem. */
  videoHash?: string;
  /** File size in bytes — paired with videoHash. */
  videoSize?: number;
}): Promise<StremioSubtitlesResponse> {
  const baseUrl = normalizeAddonBaseUrl(params.baseUrl ?? CINEMETA_BASE);
  // Stremio addon protocol: /subtitles/<type>/<id>/<extra>.json where
  // <extra> is `key=value&key=value`. Each value URL-encoded, the
  // `&` and `=` between pairs left raw.
  const extras: string[] = [];
  if (params.videoHash) extras.push(`videoHash=${encodeURIComponent(params.videoHash)}`);
  if (params.videoSize != null) extras.push(`videoSize=${encodeURIComponent(String(params.videoSize))}`);
  const extra = extras.join('&');
  const cacheKey = getCacheKey(baseUrl, ['subtitles', params.type, params.id, extra]);
  const cached = getCached(subtitlesCache, cacheKey);
  if (cached) return cached;

  const idSegment = encodeURIComponent(params.id);
  const targetUrl = extra
    ? `${baseUrl}/subtitles/${params.type}/${idSegment}/${extra}.json`
    : `${baseUrl}/subtitles/${params.type}/${idSegment}.json`;
  const res = await fetch(resolveAddonFetchUrl(targetUrl), {
    headers: {
      Accept: 'application/json',
    },
    signal: params.signal,
  });
  if (!res.ok) {
    if (res.status === 403 || res.status === 404 || res.status === 410 || res.status === 500 || res.status === 502) {
      return { subtitles: [] };
    }
    throw new Error(`Failed to load subtitles ${params.type}/${params.id} (${res.status})`);
  }
  const subtitles = (await res.json()) as StremioSubtitlesResponse;
  setCached(subtitlesCache, cacheKey, subtitles);
  return subtitles;
}

/** Compute the OpenSubtitles hash (8-byte hex) for a streaming URL via
 *  the local stremio-service `/opensubHash` endpoint. Goes through
 *  /addon-proxy so it's same-origin from the renderer's perspective.
 *  Returns null on any error — caller falls back to hashless subs. */
export async function fetchOpenSubHash(
  streamUrl: string,
  signal?: AbortSignal,
): Promise<{ hash: string; size: number } | null> {
  try {
    const target = `http://127.0.0.1:11470/opensubHash?videoUrl=${encodeURIComponent(streamUrl)}`;
    const res = await fetch(resolveAddonFetchUrl(target), { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: { hash?: string; size?: number } };
    const hash = data.result?.hash;
    const size = data.result?.size;
    if (typeof hash !== 'string' || typeof size !== 'number') return null;
    return { hash, size };
  } catch {
    return null;
  }
}
