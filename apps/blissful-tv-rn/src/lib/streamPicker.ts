import {
  fetchStoredSettings,
  fetchStoredState,
  fetchStreams,
  type MediaType,
  type StremioStream,
} from '@blissful/core';

// ── Addon URL list (ported from useAddonsManager.ts) ───────────────────────
const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
const DEFAULT_ADDON_URLS = [
  CINEMETA_URL,
  'https://torrentio.strem.fun/lite/manifest.json',
  'https://thepiratebay-plus.strem.fun/manifest.json',
  'https://opensubtitles-v3.strem.io/manifest.json',
];
const TORRENTIO_RE = /torrentio\.strem\.fun/i;
// Addons to skip: meta/subtitle addons that never serve /stream, AND the local
// stremio-server addon (127.0.0.1:11470 — there is no streaming server on TV, and
// fetchStreams rewrites it to host.docker.internal which hangs forever).
const NO_STREAM_RE = /(v3-cinemeta\.strem\.io|opensubtitles|v3-channels|publicdomainmovies|stremio-ratings|127\.0\.0\.1|localhost|host\.docker\.internal|:11470|:12470)/i;
// Per-addon fetch budget — a slow/dead addon is dropped after this so it can't
// block the others ("30s exclude" rule).
const ADDON_TIMEOUT_MS = 30_000;

// Cache the resolved addon-URL list so a stream/subtitle open doesn't re-fetch
// /state + /settings every time (that prelude — two storage round-trips — was the
// "torrents load slower than the desktop" lag; the desktop keeps its addon list
// in a provider). 5-min TTL, keyed by token.
const ADDON_URLS_TTL_MS = 5 * 60_000;
let addonUrlsCache: { key: string; urls: string[]; at: number } | null = null;

/** Build the user's addon transport-URL list: their stored addons (or guest
 *  defaults), with the Torrentio Real-Debrid addon injected when an RD key is
 *  set (stripping the non-RD Torrentio so torrents resolve to ready HTTP urls). */
export async function loadAddonUrls(token: string | null): Promise<string[]> {
  const key = token ?? 'guest';
  if (addonUrlsCache && addonUrlsCache.key === key && Date.now() - addonUrlsCache.at < ADDON_URLS_TTL_MS) {
    return addonUrlsCache.urls;
  }
  const [state, settings] = await Promise.all([
    fetchStoredState(token),
    fetchStoredSettings(token),
  ]);
  const rdKey = settings?.realDebridApiKey?.trim() || '';

  let sourceUrls: string[] = token ? state?.addons ?? [] : [];
  if (sourceUrls.length === 0) sourceUrls = [...DEFAULT_ADDON_URLS];

  if (token && rdKey) {
    sourceUrls = sourceUrls.filter((u) => !TORRENTIO_RE.test(u));
    sourceUrls.push(`https://torrentio.strem.fun/realdebrid=${rdKey}/manifest.json`);
  }
  // Cinemeta first (dedup), like the desktop.
  const urls = [CINEMETA_URL, ...sourceUrls.filter((u) => u !== CINEMETA_URL)];
  addonUrlsCache = { key, urls, at: Date.now() };
  return urls;
}

/** Drop the cached addon list — call when the user edits addons / the RD key so
 *  the next open rebuilds it. */
export function invalidateAddonUrlsCache(): void {
  addonUrlsCache = null;
  streamResultCache.clear();
}

/** transport URL → base (no trailing /manifest.json). */
function toBaseUrl(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
}

function addonNameFromUrl(transportUrl: string): string {
  if (/realdebrid=/i.test(transportUrl)) return 'Torrentio RD';
  if (TORRENTIO_RE.test(transportUrl)) return 'Torrentio';
  if (/thepiratebay/i.test(transportUrl)) return 'ThePirateBay+';
  try {
    return new URL(transportUrl).hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return 'Addon';
  }
}

// ── Stream description parser (ported from features/detail/utils.ts) ─────────
type ParsedDesc = {
  torrentName: string | null;
  seeders: string | null;
  size: string | null;
  site: string | null;
  rawMeta: string | null;
};

// Line separators: CR/LF + the Unicode LINE/PARAGRAPH separators that some
// addons emit. Written as \u escapes — literal U+2028/U+2029 are JS line
// terminators and would break the regex literal.

export function parseStreamDescription(desc?: string | null): ParsedDesc {
  if (!desc) return { torrentName: null, seeders: null, size: null, site: null, rawMeta: null };

  let lines = desc.split('\n').map((s) => s.trim()).filter(Boolean);

  if (lines.length === 1) {
    const one = lines[0];
    const emojiIdxs: number[] = [];
    for (const m of one.matchAll(/(?:\u{1F464}\u{FE0F}?|\u{1F465}\u{FE0F}?|\u{1F4BE}\u{FE0F}?|\u{2699}\u{FE0F}?)/gu)) {
      if (typeof m.index === 'number') emojiIdxs.push(m.index);
    }
    const tokenIdx = one.search(/\b(seed(?:er|ers)?|size|site)\b\s*[:=]?\s*/i);
    const metaStart = [...emojiIdxs, tokenIdx].filter((i) => i > 0).sort((a, b) => a - b)[0];
    if (typeof metaStart === 'number' && metaStart > 0) {
      const namePart = one.slice(0, metaStart).trim();
      const metaPart = one.slice(metaStart).trim();
      if (namePart && metaPart) lines = [namePart, metaPart];
    }
  }

  const torrentName = lines[0] ?? null;
  const rawMeta = lines.length >= 2 ? lines.slice(1).join(' ').trim() : null;
  const hay = rawMeta ?? desc;

  const seeders = (() => {
    const m1 = hay.match(/(?:\u{1F464}\u{FE0F}?|\u{1F465}\u{FE0F}?)\s*(\d{1,7})/u);
    if (m1) return m1[1];
    const m2 = hay.match(/\bseed(?:er|ers)?\b\s*[:=]?\s*(\d{1,7})/i);
    return m2 ? m2[1] : null;
  })();

  const size = (() => {
    const norm = (raw: string): string => {
      const fixed = raw.trim().replace(',', '.');
      const m = fixed.match(/^(\d+(?:\.\d+)?)(?:\s*)?(TB|GB|MB|KB|TiB|GiB|MiB|KiB)$/i);
      if (!m) return fixed;
      return `${m[1]} ${m[2]}`;
    };
    const m1 = hay.match(/(?:\u{1F4BE}\u{FE0F}?)\s*(\d+(?:[.,]\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB))/iu);
    if (m1) return norm(m1[1]);
    const m2 = hay.match(/\bsize\b\s*[:=]?\s*(\d+(?:[.,]\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB))/i);
    if (m2) return norm(m2[1]);
    const m3 = hay.match(/\b(\d+(?:[.,]\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB))\b/i);
    return m3 ? norm(m3[1]) : null;
  })();

  const site = (() => {
    const m1 = hay.match(/(?:\u{2699}\u{FE0F}?)\s*([^\n]+)$/u);
    if (m1) return m1[1].trim();
    const m2 = hay.match(/\bsite\b\s*[:=]?\s*([^\n]+)/i);
    return m2 ? m2[1].trim() : null;
  })();

  return { torrentName, seeders, size, site, rawMeta };
}

function parseSizeBytes(value: string | null): number | null {
  if (!value) return null;
  const m = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(TB|GB|MB|GiB|MiB|TiB)$/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toUpperCase();
  const base = unit.endsWith('IB') ? 1024 : 1000;
  if (unit.startsWith('T')) return Math.round(n * base * base * base * base);
  if (unit.startsWith('G')) return Math.round(n * base * base * base);
  return Math.round(n * base * base);
}

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

// ── A picker row ───────────────────────────────────────────────────────────
export type ResolutionBucket = '4K' | '1080p' | '720p' | 'SD' | 'Other';
export const BUCKET_ORDER: ResolutionBucket[] = ['4K', '1080p', '720p', 'SD', 'Other'];

export type PickerStream = {
  key: string;
  addonName: string;
  leftLabel: string;
  title: string;
  metaSeeders: string | null;
  metaSize: string | null;
  metaProvider: string | null;
  url: string | null; // playable HTTP url, or null (infoHash-only → not playable)
  seeders: number | null;
  sizeBytes: number | null;
  isRd: boolean;
  bucket: ResolutionBucket;
};

const ICON_SEEDERS = '\u{1F464}'; // 👤
const ICON_SIZE = '\u{1F4BE}'; // 💾
const ICON_GEAR = '\u{2699}\u{FE0F}'; // ⚙️

// Resolution bucket (ported from StreamList.bucketOf): match against name+title.
function bucketOf(row: { leftLabel: string; title: string }): ResolutionBucket {
  const hay = `${row.leftLabel} ${row.title}`.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(hay)) return '4K';
  if (/\b(1440p|2k|1080p|fhd|full ?hd)\b/.test(hay)) return '1080p';
  if (/\b(720p|hd)\b/.test(hay)) return '720p';
  if (/\b(480p|360p|sd|dvd|cam|ts)\b/.test(hay)) return 'SD';
  return 'Other';
}

// Playable-first, then RD, then seeders/(sizeGB+1), then title. Quality is NOT
// penalised — 4K wins on merit; the player engine is responsible for decoding it
// (ExoPlayer hardware-decodes 4K on real Android TVs; the x86 EMULATOR has no 4K
// decoder so 4K renders black there, but that's an emulator artifact, not a
// reason to avoid 4K).
const score = (r: PickerStream) => (r.seeders ?? 0) / ((r.sizeBytes ?? 0) / 1_073_741_824 + 1);
export function rankStreams(rows: PickerStream[]): PickerStream[] {
  return rows.slice().sort((a, b) => {
    const ap = a.url ? 1 : 0;
    const bp = b.url ? 1 : 0;
    if (ap !== bp) return bp - ap;
    if (a.isRd !== b.isRd) return a.isRd ? -1 : 1;
    const sd = score(b) - score(a);
    if (sd !== 0) return sd;
    return a.title.localeCompare(b.title);
  });
}

function toRows(transportUrl: string, streams: StremioStream[]): PickerStream[] {
  const addonName = addonNameFromUrl(transportUrl);
  const isRd = addonName === 'Torrentio RD' || /realdebrid=/i.test(transportUrl);
  return streams.map((s, i) => {
    const parsed = parseStreamDescription(s.description ?? s.title ?? null);
    const title = parsed.torrentName ?? s.title ?? s.name ?? 'Stream';
    const seeders = parsed.seeders ? Number.parseInt(parsed.seeders, 10) : null;
    const leftLabel = s.name ?? addonName;
    return {
      key: `${addonName}-${i}-${s.infoHash ?? s.url ?? title}`,
      addonName,
      leftLabel,
      title,
      metaSeeders: parsed.seeders ? `${ICON_SEEDERS} ${parsed.seeders}` : null,
      metaSize: parsed.size ? `${ICON_SIZE} ${parsed.size}` : null,
      metaProvider: parsed.site ? `${ICON_GEAR} ${parsed.site}` : null,
      url: isHttpUrl(s.url) ? s.url : null,
      seeders: Number.isFinite(seeders as number) ? (seeders as number) : null,
      sizeBytes: parseSizeBytes(parsed.size),
      isRd,
      bucket: bucketOf({ leftLabel, title }),
    };
  });
}

// Per-title stream-result cache (mirrors the desktop's 5-min addon cache) so
// re-opening the same title — e.g. Back to Detail then Watch again — is instant
// instead of re-querying every addon. Keyed by token+type+id.
const STREAM_RESULT_TTL_MS = 5 * 60_000;
const streamResultCache = new Map<string, { rows: PickerStream[]; at: number }>();

/** Fetch streams across the user's torrent addons PROGRESSIVELY: `onRows` is
 *  called with the merged+ranked rows each time an addon responds, so results
 *  appear as they arrive and a slow/dead addon (dropped after ADDON_TIMEOUT_MS)
 *  can't block the rest. `id` = imdb id (movie) or imdb:S:E (series episode).
 *  Resolves with the final ranked rows. */
export async function loadStreams(
  token: string | null,
  type: MediaType,
  id: string,
  opts: { signal?: AbortSignal; onRows?: (rows: PickerStream[]) => void } = {},
): Promise<PickerStream[]> {
  const cacheKey = `${token ?? 'guest'}|${type}|${id}`;
  const cached = streamResultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < STREAM_RESULT_TTL_MS) {
    opts.onRows?.(cached.rows);
    return cached.rows;
  }

  const allUrls = await loadAddonUrls(token);
  const transportUrls = allUrls.filter((u) => !NO_STREAM_RE.test(u));

  const merged: PickerStream[] = [];
  await Promise.allSettled(
    transportUrls.map(async (transportUrl) => {
      // Per-addon timeout: abort this addon after the budget so it can't hang
      // the picker. Chained to the caller's signal.
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ADDON_TIMEOUT_MS);
      const onAbort = () => ctrl.abort();
      opts.signal?.addEventListener('abort', onAbort);
      try {
        const res = await fetchStreams({ type, id, baseUrl: toBaseUrl(transportUrl), signal: ctrl.signal });
        if (opts.signal?.aborted) return;
        merged.push(...toRows(transportUrl, res.streams));
        opts.onRows?.(rankStreams(merged));
      } catch {
        /* drop this addon (timeout / 404 / network) */
      } finally {
        clearTimeout(t);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }),
  );

  const final = rankStreams(merged);
  // Only cache a non-empty result so a transient all-addons-failed open doesn't
  // pin "no streams" for 5 minutes.
  if (final.length > 0) streamResultCache.set(cacheKey, { rows: final, at: Date.now() });
  return final;
}
