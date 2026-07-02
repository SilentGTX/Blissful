// Subtitle data layer for the TV player.
//
// Mirrors the web build's NativeMpvPlayer subtitle pipeline (combinedSubLanguages
// + variantsForLanguage + the addon iteration in the subtitle-fetch effect) but
// flattened into a single async loader so the player can `await loadSubtitles()`
// on demand instead of running a multi-effect machine.
//
// It queries the user's installed addons' Stremio `subtitles` resource via
// `@blissful/core`'s `fetchSubtitles` (which on native fetches addon hosts
// DIRECTLY — there is no CORS and no /addon-proxy on Android; the desktop build
// injects the proxy via configureCore()). The addon list reuses the exact same
// resolver streamPicker.ts uses, so subtitle addons and stream addons agree on
// which addons the user has installed.
//
// Normalization rules (ported 1:1 from the web pipeline):
//   - dedupe by subtitle URL (the web `uniq` Map keyed on sub.url);
//   - group rows by CANONICAL language label, so "eng" / "en" / "english" all
//     collapse into one language bucket;
//   - within a language, sort variants by the OpenSubtitles "good" rating (`g`)
//     descending so the best-rated sub is first (matches scoreSubtitleTrack);
//   - language buckets are ordered by first appearance across addons, with
//     English floated to the front (the player's default preselect target).

import {
  fetchSubtitles,
  getStorageBaseUrl,
  type MediaType,
  type StremioSubtitle,
} from '@blissful/core';
import { loadAddonUrls } from './streamPicker';

// ── Language label table ─────────────────────────────────────────────────────
// Ported verbatim from apps/web-blissful/src/components/NativeMpvPlayer/
// subtitleHelpers.ts so a TV build resolves the same language codes to the same
// display names the desktop build does.
/** Map a raw `lang` (BCP-47 or ISO-639 alpha-2/3) to a display label. */
export function subtitleLangLabel(lang: string): string {
  const l = lang.trim().toLowerCase();
  if (!l) return 'Unknown';
  if (l === 'local') return 'Local';
  const map: Record<string, string> = {
    en: 'English', eng: 'English', english: 'English',
    es: 'Spanish', spa: 'Spanish', spanish: 'Spanish',
    fr: 'French', fra: 'French', fre: 'French', french: 'French',
    it: 'Italian', ita: 'Italian', italian: 'Italian',
    pt: 'Portuguese', por: 'Portuguese', portuguese: 'Portuguese',
    ptbr: 'Portuguese (BR)', 'pt-br': 'Portuguese (BR)',
    de: 'German', deu: 'German', ger: 'German', german: 'German',
    nl: 'Dutch', nld: 'Dutch', dut: 'Dutch', dutch: 'Dutch',
    ru: 'Russian', rus: 'Russian', russian: 'Russian',
    pl: 'Polish', pol: 'Polish', polish: 'Polish',
    tr: 'Turkish', tur: 'Turkish', turkish: 'Turkish',
    ar: 'Arabic', ara: 'Arabic', arabic: 'Arabic',
    hi: 'Hindi', hin: 'Hindi', hindi: 'Hindi',
    ja: 'Japanese', jpn: 'Japanese', japanese: 'Japanese',
    ko: 'Korean', kor: 'Korean', korean: 'Korean',
    zh: 'Chinese', zho: 'Chinese', chi: 'Chinese', chinese: 'Chinese',
    uk: 'Ukrainian', ukr: 'Ukrainian', ukrainian: 'Ukrainian',
    sq: 'Albanian', alb: 'Albanian', sqi: 'Albanian', albanian: 'Albanian',
    bg: 'Bulgarian', bul: 'Bulgarian', bulgarian: 'Bulgarian',
    cs: 'Czech', ces: 'Czech', cze: 'Czech', czech: 'Czech',
    da: 'Danish', dan: 'Danish', danish: 'Danish',
    fi: 'Finnish', fin: 'Finnish', finnish: 'Finnish',
    el: 'Greek', gre: 'Greek', ell: 'Greek', greek: 'Greek',
    he: 'Hebrew', heb: 'Hebrew', hebrew: 'Hebrew',
    hu: 'Hungarian', hun: 'Hungarian', hungarian: 'Hungarian',
    id: 'Indonesian', ind: 'Indonesian', indonesian: 'Indonesian',
    no: 'Norwegian', nor: 'Norwegian', nob: 'Norwegian', norwegian: 'Norwegian',
    ro: 'Romanian', ron: 'Romanian', rum: 'Romanian', romanian: 'Romanian',
    sv: 'Swedish', swe: 'Swedish', swedish: 'Swedish',
    th: 'Thai', tha: 'Thai', thai: 'Thai',
    vi: 'Vietnamese', vie: 'Vietnamese', vietnamese: 'Vietnamese',
    sr: 'Serbian', srp: 'Serbian', serbian: 'Serbian',
    hr: 'Croatian', hrv: 'Croatian', croatian: 'Croatian',
    sk: 'Slovak', slk: 'Slovak', slo: 'Slovak', slovak: 'Slovak',
    sl: 'Slovenian', slv: 'Slovenian', slovenian: 'Slovenian',
    et: 'Estonian', est: 'Estonian', estonian: 'Estonian',
    lv: 'Latvian', lav: 'Latvian', latvian: 'Latvian',
    lt: 'Lithuanian', lit: 'Lithuanian', lithuanian: 'Lithuanian',
    fa: 'Persian', per: 'Persian', fas: 'Persian', persian: 'Persian', farsi: 'Persian',
    ms: 'Malay', msa: 'Malay', may: 'Malay', malay: 'Malay',
    tl: 'Tagalog', tgl: 'Tagalog', fil: 'Filipino', filipino: 'Filipino', tagalog: 'Tagalog',
    bn: 'Bengali', ben: 'Bengali', bengali: 'Bengali',
    ta: 'Tamil', tam: 'Tamil', tamil: 'Tamil',
    te: 'Telugu', tel: 'Telugu', telugu: 'Telugu',
    ml: 'Malayalam', mal: 'Malayalam', malayalam: 'Malayalam',
  };
  if (map[l]) return map[l];
  // BCP-47 tags (embedded MKV tracks often carry the IETF tag, e.g.
  // "en-US"): fold region/script variants onto the base language so they
  // land in the same row as addon subs tagged "eng". Multi-part tags the
  // map knows explicitly (pt-br) matched above, before the strip.
  const primary = l.split(/[-_]/, 1)[0];
  if (primary !== l && map[primary]) return map[primary];
  return l.length <= 4 ? l.toUpperCase() : l.charAt(0).toUpperCase() + l.slice(1);
}

/** Subtitle LANGUAGE sort priority — ported from the WEB player's `langPriority`
 *  (subtitleUtils.ts): device-local subs first, then English, then everything
 *  else (the caller breaks ties alphabetically). Higher = earlier. */
export function langPriority(lang: string): number {
  const l = lang.trim().toLowerCase();
  if (l === 'local') return 2;
  if (subtitleLangLabel(l) === 'English') return 1;
  return 0;
}

// ── Public shapes ────────────────────────────────────────────────────────────
/** One addon-provided subtitle variant (a single downloadable .srt/.vtt). */
export type SubtitleTrack = {
  /** Stable key: `${addonName}::${sub.id ?? sub.url}` (unique across addons). */
  id: string;
  /** Raw language code as the addon reported it (e.g. `eng`, `pt-br`). */
  lang: string;
  /** Canonical display label of `lang` (e.g. `English`). */
  langName: string;
  /** Human label for the row — `<langName> - <addon name>`. */
  label: string;
  /** Direct subtitle file URL (.srt or .vtt). */
  url: string;
  /** Addon manifest name the sub came from (e.g. `OpenSubtitles v3`). */
  source: string;
  /** OpenSubtitles "good" rating, parsed to a number (0 when absent). */
  rating: number;
};

/** A language bucket: every variant that maps to one canonical language. */
export type SubtitleLanguageGroup = {
  /** Canonical display label (e.g. `English`). */
  langName: string;
  /** Raw code of the first variant (kept so callers can re-label if needed). */
  lang: string;
  /** Variants for this language, best-rated first. */
  tracks: SubtitleTrack[];
};

export type LoadSubtitlesResult = {
  /** Flat, deduped, rating-sorted list of every subtitle variant. */
  tracks: SubtitleTrack[];
  /** The same variants grouped by canonical language, English floated first. */
  groups: SubtitleLanguageGroup[];
};

export type LoadSubtitlesParams = {
  /** Stremio media type — `movie` or `series` (loose string per core). */
  type: MediaType;
  /** Base content id — imdb id (movie) or `imdb:S:E` (series episode). */
  id: string;
  /** Per-episode video id when it differs from `id` (series); falls back to `id`. */
  videoId?: string | null;
  /** Auth token (drives which addons are loaded); null = guest defaults. */
  token?: string | null;
  signal?: AbortSignal;
  /** OpenSubtitles 8-byte file hash + size — hash-matched (perfectly synced) subs. */
  videoHash?: string;
  videoSize?: number;
};

// Subtitle/meta addons that DO serve /subtitles but never need the streaming
// server, and the local stremio-server addon which doesn't exist on TV. We do
// NOT exclude opensubtitles here (unlike streamPicker's NO_STREAM_RE) — it's the
// primary subtitle source — but we still drop the dead local-server addon.
const NO_SUBTITLE_RE = /(127\.0\.0\.1|localhost|host\.docker\.internal|:11470|:12470)/i;
// Per-addon budget so one slow/dead subtitle addon can't hang the open.
const ADDON_TIMEOUT_MS = 12_000;

/** transport URL → base (no trailing /manifest.json). */
function toBaseUrl(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
}

/** Friendly addon name from its transport URL (best-effort, for the `source`). */
function addonNameFromUrl(transportUrl: string): string {
  if (/opensubtitles/i.test(transportUrl)) return 'OpenSubtitles';
  try {
    return new URL(transportUrl).hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return 'Addon';
  }
}

/** Parse the OpenSubtitles "good" rating (`g`) — usually a numeric string,
 *  occasionally a number; unparseable → 0. Ported from the web fetch step. */
export function parseSubtitleRating(g: StremioSubtitle['g']): number {
  if (typeof g === 'number') return Number.isFinite(g) ? g : 0;
  if (typeof g === 'string') return Number.parseInt(g, 10) || 0;
  return 0;
}

/** Normalize one addon's raw Stremio subtitles into our `SubtitleTrack` shape.
 *  Skips entries without a URL. Pure — unit-tested. */
export function normalizeAddonSubtitles(
  subtitles: StremioSubtitle[],
  addonName: string,
): SubtitleTrack[] {
  const out: SubtitleTrack[] = [];
  for (const sub of subtitles) {
    if (!sub?.url) continue;
    const lang = (sub.lang ?? 'unknown').trim() || 'unknown';
    const langName = subtitleLangLabel(lang);
    out.push({
      id: `${addonName}::${sub.id ?? sub.url}`,
      lang,
      langName,
      label: `${langName} - ${addonName}`,
      url: sub.url,
      source: addonName,
      rating: parseSubtitleRating(sub.g),
    });
  }
  return out;
}

/** Dedupe a flat track list by URL (first occurrence wins — addons are queried
 *  in install order, so the user's preferred addon's variant survives). Pure. */
export function dedupeSubtitleTracks(tracks: SubtitleTrack[]): SubtitleTrack[] {
  const seen = new Set<string>();
  const out: SubtitleTrack[] = [];
  for (const t of tracks) {
    if (seen.has(t.url)) continue;
    seen.add(t.url);
    out.push(t);
  }
  return out;
}

/** Group deduped tracks by canonical language, sort each bucket best-rated
 *  first, and float English to the front. Pure — unit-tested. */
export function groupSubtitlesByLanguage(tracks: SubtitleTrack[]): SubtitleLanguageGroup[] {
  const byCanon = new Map<string, SubtitleLanguageGroup>();
  for (const t of tracks) {
    const existing = byCanon.get(t.langName);
    if (existing) {
      existing.tracks.push(t);
    } else {
      byCanon.set(t.langName, { langName: t.langName, lang: t.lang, tracks: [t] });
    }
  }
  const groups = [...byCanon.values()];
  for (const g of groups) {
    // Best-rated first; tie-break by addon source for a stable order.
    g.tracks.sort((a, b) => b.rating - a.rating || a.source.localeCompare(b.source));
  }
  // Float English to the front; otherwise preserve first-appearance order.
  groups.sort((a, b) => {
    const ae = a.langName === 'English' ? 0 : 1;
    const be = b.langName === 'English' ? 0 : 1;
    return ae - be;
  });
  return groups;
}

/** Flatten subtitle variants for the in-player flat list that SettingsDrawer
 *  groups into language rows. Keeps languages in FIRST-APPEARANCE order (NO
 *  preferred-language float — matches the desktop native player's language
 *  list), but orders the variants WITHIN each language best-rated first so the
 *  per-language drill-down shows the best sub on top (the desktop player's
 *  `variantsForLanguage` ordering). Pure. */
export function orderSubtitlesForPlayer(tracks: SubtitleTrack[]): SubtitleTrack[] {
  const order: string[] = [];
  const byCanon = new Map<string, SubtitleTrack[]>();
  for (const t of tracks) {
    const list = byCanon.get(t.langName);
    if (list) list.push(t);
    else {
      byCanon.set(t.langName, [t]);
      order.push(t.langName);
    }
  }
  return order.flatMap((c) =>
    byCanon.get(c)!.slice().sort((a, b) => b.rating - a.rating || a.source.localeCompare(b.source)),
  );
}

/** Query every installed addon's `subtitles` resource for this content,
 *  normalize + dedupe + group the results. Addons are queried in parallel with a
 *  per-addon timeout so a slow/dead one can't block the open. Resolves with the
 *  full flat list + the grouped view. Never throws on a single addon's failure;
 *  returns empty lists if nothing is found. */
export async function loadSubtitles(params: LoadSubtitlesParams): Promise<LoadSubtitlesResult> {
  const { type, id, videoId, token = null, signal } = params;
  const baseId = (videoId && videoId.trim()) || id;

  const allUrls = await loadAddonUrls(token);
  const transportUrls = allUrls.filter((u) => !NO_SUBTITLE_RE.test(u));

  const merged: SubtitleTrack[] = [];
  await Promise.allSettled([
    // Built-in OpenSubtitles (proxy /opensubs) — available to EVERY account with
    // NO installed addon (OpenSubtitles isn't a default addon). Mirrors the
    // web/desktop player; without this a fresh TV account only sees embedded subs.
    // Deduped by URL below, so a user who ALSO installed OpenSubtitles won't see
    // doubles. Listed first so it's the reliable external source.
    fetchProxyOpenSubs({ type, id: baseId, videoHash: params.videoHash, videoSize: params.videoSize, signal })
      .then((subs) => { merged.push(...subs); }),
    ...transportUrls.map(async (transportUrl) => {
      // Per-addon timeout, chained to the caller's signal.
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ADDON_TIMEOUT_MS);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort);
      try {
        const resp = await fetchSubtitles({
          type,
          id: baseId,
          baseUrl: toBaseUrl(transportUrl),
          signal: ctrl.signal,
          videoHash: params.videoHash,
          videoSize: params.videoSize,
        });
        if (signal?.aborted) return;
        merged.push(...normalizeAddonSubtitles(resp.subtitles ?? [], addonNameFromUrl(transportUrl)));
      } catch {
        /* drop this addon (timeout / 404 / network) */
      } finally {
        clearTimeout(t);
        signal?.removeEventListener('abort', onAbort);
      }
    }),
  ]);

  const tracks = dedupeSubtitleTracks(merged);
  return { tracks, groups: groupSubtitlesByLanguage(tracks) };
}

/** Addon-proxy origin (the storage base, minus the `/storage` suffix). The probe
 *  + subtitle-extract endpoints live on the proxy, NOT the storage service. */
function proxyBaseUrl(): string {
  try {
    return getStorageBaseUrl().replace(/\/storage\/?$/i, '');
  } catch {
    return '';
  }
}

/** Fetch the BUILT-IN OpenSubtitles source via the addon-proxy's cached
 *  `/opensubs` endpoint — the SAME source the web/desktop player uses. This is
 *  why external subs work WITHOUT an OpenSubtitles addon installed: OpenSubtitles
 *  is NOT a default addon, so on TV (which only queries installed addons) a fresh
 *  account would otherwise see ONLY embedded subs. The proxy caches + retries
 *  past the flaky community instance's 504s. Hash-matched when a videoHash is
 *  supplied. Best-effort with a per-call timeout: returns [] on any failure. */
async function fetchProxyOpenSubs(params: {
  type: MediaType;
  id: string;
  videoHash?: string;
  videoSize?: number;
  signal?: AbortSignal;
}): Promise<SubtitleTrack[]> {
  const proxy = proxyBaseUrl();
  if (!proxy) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ADDON_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  params.signal?.addEventListener('abort', onAbort);
  try {
    const qs = new URLSearchParams({ type: String(params.type), id: params.id });
    if (params.videoHash) {
      qs.set('videoHash', params.videoHash);
      qs.set('videoSize', String(params.videoSize ?? 0));
    }
    const res = await fetch(`${proxy}/opensubs?${qs.toString()}`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { subtitles?: Array<{ id?: string; lang?: string; url?: string }> };
    const out: SubtitleTrack[] = [];
    for (const sub of data.subtitles ?? []) {
      if (!sub?.url) continue;
      const lang = (sub.lang ?? 'unknown').trim() || 'unknown';
      const langName = subtitleLangLabel(lang);
      out.push({
        id: `OpenSubtitles::${sub.id ?? sub.url}`,
        lang,
        langName,
        label: `${langName} - OpenSubtitles`,
        url: sub.url,
        source: 'OpenSubtitles',
        rating: 0,
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}

/** Probe the PLAYING stream URL for EMBEDDED text subtitle tracks via the
 *  addon-proxy's ffprobe endpoint and return them as STYLEABLE `SubtitleTrack`s.
 *  Their `url` points at `/extract-subtitle.vtt`, which the player fetches +
 *  parses (`fetchSubtitleCues`) and renders through the styled `SubtitleOverlay`
 *  — so embedded subs honour the saved colour / size / outline, unlike
 *  expo-video's native embedded rendering, which has NO styling hook. Mirrors the
 *  web BlissfulPlayer embedded-subtitle probe. Best-effort: returns [] on any
 *  failure (the caller keeps the native tracks as a fallback). Bitmap subs (PGS,
 *  VobSub) are dropped by the server's `textBased` flag — no client-side OCR. */
export async function probeEmbeddedSubtitles(streamUrl: string, signal?: AbortSignal): Promise<SubtitleTrack[]> {
  if (!/^https?:\/\//i.test(streamUrl)) return [];
  const proxy = proxyBaseUrl();
  if (!proxy) return [];
  try {
    const resp = await fetch(`${proxy}/probe-streams?url=${encodeURIComponent(streamUrl)}`, { signal });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      subtitles?: Array<{ index: number; language?: string; title?: string | null; textBased?: boolean }>;
    };
    const out: SubtitleTrack[] = [];
    for (const s of data.subtitles ?? []) {
      if (!s.textBased) continue;
      const lang = (s.language || 'und').toLowerCase();
      const langName = subtitleLangLabel(lang);
      out.push({
        id: `embedded::${s.index}`,
        lang,
        langName,
        label: s.title ? `${langName} - ${s.title}` : `${langName} - Built-in`,
        url: `${proxy}/extract-subtitle.vtt?url=${encodeURIComponent(streamUrl)}&track=${s.index}`,
        source: 'Built-in',
        rating: 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}
