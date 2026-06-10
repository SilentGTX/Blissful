// Addon list data path for the TV app — list (with manifest hydration),
// add-by-URL (validate via manifest), and remove. Ported 1:1 from the web app's
// layout/app-shell/hooks/useAddonsManager.ts + lib/storageApi.ts persist path.
//
// SOURCE OF TRUTH: the blissful-storage server's per-user `state.addons` (an
// array of transport URLs). Signed-in users read/write it; guests get the same
// local defaults the web app and lib/streamPicker.ts use. Manifests are NOT
// stored — only transport URLs — so we hydrate name/logo/types/description from
// each addon's /manifest.json on demand (5-min cached in core's fetchAddonManifest).
import {
  fetchAddonManifest,
  getStorageBaseUrl,
  normalizeAddonBaseUrl,
} from '@blissful/core';
import { kv } from './storage';
import type { HomeRowPrefs } from './homeRows';

// Mirror of lib/streamPicker.ts + useAddonsManager.ts default list (guest mode).
const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
const DEFAULT_ADDON_URLS = [
  CINEMETA_URL,
  'https://torrentio.strem.fun/lite/manifest.json',
  'https://thepiratebay-plus.strem.fun/manifest.json',
  'https://opensubtitles-v3.strem.io/manifest.json',
];
const TORRENTIO_RE = /torrentio\.strem\.fun/i;

// A hydrated addon row — what the screen renders. `manifest` is null until the
// /manifest.json fetch resolves (or stays null if the addon is unreachable).
export type AddonRow = {
  transportUrl: string;
  manifest: AddonManifestLite | null;
};

// The manifest fields the Addons screen reads. The Stremio manifest carries more
// (catalogs, behaviorHints, …) which we ignore. `logo`/`types` aren't in core's
// StremioAddonManifest type, so we read them defensively off the raw JSON.
export type AddonManifestLite = {
  id?: string;
  name?: string;
  description?: string;
  logo?: string;
  /** Top-level content types (movie / series / channel / tv / …). */
  types?: string[];
  /** Resource names (catalog / meta / stream / subtitles) — shown as chips when
   *  `types` is absent, so the user can tell a stream addon from a catalog one. */
  resources?: string[];
};

// ── State persistence (read-merge-write) ────────────────────────────────────
// The /state endpoint REPLACES the whole state document, so to avoid clobbering
// theme/profile/homeRowPrefs we read the current raw state, set only `addons`,
// and POST the merged object back (matching web saveStoredState semantics).

async function fetchRawState(token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${getStorageBaseUrl()}/state`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Storage /state failed (${res.status})`);
  const body = (await res.json()) as { state?: Record<string, unknown> | null };
  return body.state ?? {};
}

async function saveAddonUrls(token: string, urls: string[]): Promise<void> {
  const current = await fetchRawState(token);
  const next = { ...current, addons: urls };
  const res = await fetch(`${getStorageBaseUrl()}/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ state: next }),
  });
  if (!res.ok) throw new Error(`Storage /state save failed (${res.status})`);
}

// ── Home-row prefs (customize home) ──────────────────────────────────────────
// The { order, hidden } row lists live at /state.homeRowPrefs (same field the
// Windows app writes). We mirror them to the local kv store so they apply
// instantly on boot and so guests (no token) can still customize locally.

const HOME_PREFS_KEY = 'blissHomeRowPrefs';
const EMPTY_PREFS: HomeRowPrefs = { order: [], hidden: [] };

function coercePrefs(value: unknown): HomeRowPrefs | null {
  if (!value || typeof value !== 'object') return null;
  const { order, hidden } = value as { order?: unknown; hidden?: unknown };
  if (!Array.isArray(order) || !Array.isArray(hidden)) return null;
  return {
    order: order.filter((x): x is string => typeof x === 'string'),
    hidden: hidden.filter((x): x is string => typeof x === 'string'),
  };
}

/** The locally-cached prefs (synchronous) — used to seed the home screen before
 *  the authoritative /state copy lands. Defaults to empty (all rows, no hide). */
export function readCachedHomeRowPrefs(): HomeRowPrefs {
  try {
    const raw = kv.get(HOME_PREFS_KEY);
    if (raw) return coercePrefs(JSON.parse(raw)) ?? EMPTY_PREFS;
  } catch {
    /* corrupt cache — fall through */
  }
  return EMPTY_PREFS;
}

/** Authoritative prefs: /state.homeRowPrefs for signed-in users (mirrored to kv),
 *  the local cache for guests. Never throws. */
export async function fetchHomeRowPrefs(token: string | null): Promise<HomeRowPrefs> {
  if (!token) return readCachedHomeRowPrefs();
  try {
    const raw = await fetchRawState(token);
    const prefs = coercePrefs(raw.homeRowPrefs);
    if (prefs) {
      kv.set(HOME_PREFS_KEY, JSON.stringify(prefs));
      return prefs;
    }
  } catch {
    /* offline / not signed in — fall back to cache */
  }
  return readCachedHomeRowPrefs();
}

/** Persist prefs: always write the local cache (so the change applies immediately
 *  and guests keep it); read-merge-write /state.homeRowPrefs when signed in. */
export async function saveHomeRowPrefs(token: string | null, prefs: HomeRowPrefs): Promise<void> {
  kv.set(HOME_PREFS_KEY, JSON.stringify(prefs));
  if (!token) return;
  const current = await fetchRawState(token);
  const next = { ...current, homeRowPrefs: prefs };
  const res = await fetch(`${getStorageBaseUrl()}/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ state: next }),
  });
  if (!res.ok) throw new Error(`Storage /state save failed (${res.status})`);
}

// ── List ────────────────────────────────────────────────────────────────────

/** The user's installed transport-URL list (Cinemeta-first, deduped), reading
 *  the stored state for signed-in users and the guest defaults otherwise. Mirrors
 *  useAddonsManager's source-of-truth selection (minus the Torrentio-RD injection,
 *  which is a streaming concern handled in lib/streamPicker, not the Addons UI). */
export async function loadInstalledAddonUrls(token: string | null): Promise<string[]> {
  let sourceUrls: string[] = [];
  if (token) {
    try {
      const raw = await fetchRawState(token);
      const stored = raw.addons;
      if (Array.isArray(stored)) sourceUrls = stored.filter((u): u is string => typeof u === 'string');
    } catch {
      sourceUrls = [];
    }
  }
  if (sourceUrls.length === 0) sourceUrls = [...DEFAULT_ADDON_URLS];
  // Cinemeta first, deduped — same ordering the web app guarantees.
  return [CINEMETA_URL, ...sourceUrls.filter((u) => u !== CINEMETA_URL)];
}

/** transport URL → base (no trailing /manifest.json). */
function toBaseUrl(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
}

// Stremio manifest resources are either a bare string ("stream") or an object
// ({ name, types }). Flatten both to resource-name strings.
function resourceNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r === 'string') out.push(r);
    else if (r && typeof r === 'object' && typeof (r as { name?: unknown }).name === 'string') {
      out.push((r as { name: string }).name);
    }
  }
  return out;
}

/** Fetch + normalise one addon's manifest into the lite shape the UI reads.
 *  Returns null if the addon is unreachable (caller shows the URL as a fallback
 *  name and no chips). */
export async function hydrateManifest(transportUrl: string, signal?: AbortSignal): Promise<AddonManifestLite | null> {
  try {
    const raw = (await fetchAddonManifest(toBaseUrl(transportUrl), signal)) as Record<string, unknown>;
    const types = Array.isArray(raw.types) ? (raw.types as unknown[]).filter((t): t is string => typeof t === 'string') : undefined;
    return {
      id: typeof raw.id === 'string' ? raw.id : undefined,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      logo: typeof raw.logo === 'string' ? raw.logo : undefined,
      types,
      resources: resourceNames(raw.resources),
    };
  } catch {
    return null;
  }
}

// ── Add / remove ─────────────────────────────────────────────────────────────

/** Validate a user-typed addon URL by fetching its manifest, then persist it to
 *  the front of the installed list (deduped). Returns the validated row. Throws
 *  with a user-readable message on an invalid URL / unreachable manifest / not
 *  signed in. Mirrors the web flow (manifest-validate then persist `addons`). */
export async function installAddon(
  token: string | null,
  rawUrl: string,
  existing: string[],
): Promise<AddonRow> {
  if (!token) throw new Error('Sign in to add addons.');
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error('Enter an addon URL.');

  // normalizeAddonBaseUrl handles stremio://, scheme-less, and //-prefixed input.
  const base = normalizeAddonBaseUrl(trimmed);
  const manifest = await hydrateManifest(base);
  if (!manifest) throw new Error("Couldn't load that addon's manifest. Check the URL.");

  const transportUrl = `${base}/manifest.json`;
  const next = [transportUrl, ...existing.filter((u) => u !== transportUrl)];
  await saveAddonUrls(token, next);
  return { transportUrl, manifest };
}

/** Remove an addon by transport URL and persist. No-op for guests (nothing to
 *  persist) — the caller updates local state regardless. */
export async function uninstallAddon(token: string | null, transportUrl: string, existing: string[]): Promise<void> {
  if (!token) return;
  const next = existing.filter((u) => u !== transportUrl);
  await saveAddonUrls(token, next);
}

// ── Discover: addon catalogs + their genre filter options ───────────────────
// A catalog the addon exposes, with the genre options it declares in the Stremio
// manifest (`catalog.extra` where name === 'genre'). core's lean StremioAddonManifest
// drops `extra.options`, so we read the raw /manifest.json here.
export type AddonCatalogInfo = { id: string; type: string; name: string; genres: string[] };

/** Fetch the addon's catalogs (id/type/name) + each catalog's manifest genre
 *  options — used by Discover to show the addon's catalogs + genre filters
 *  (Anime Kitsu's "Most Popular" etc. declare 61 genres; "Trending" declares none). */
export async function fetchAddonCatalogs(transportUrl: string, signal?: AbortSignal): Promise<AddonCatalogInfo[]> {
  try {
    const res = await fetch(`${toBaseUrl(transportUrl)}/manifest.json`, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return [];
    const man = (await res.json()) as {
      catalogs?: Array<{ id?: string; type?: string; name?: string; extra?: Array<{ name?: string; options?: unknown }> }>;
    };
    return (man.catalogs ?? [])
      .filter((c): c is { id: string; type: string; name?: string; extra?: Array<{ name?: string; options?: unknown }> } => Boolean(c.id && c.type))
      .map((c) => {
        const opts = c.extra?.find((e) => e.name === 'genre')?.options;
        return {
          id: c.id,
          type: c.type,
          name: c.name ?? c.id,
          genres: Array.isArray(opts) ? opts.filter((g): g is string => typeof g === 'string') : [],
        };
      });
  } catch {
    return [];
  }
}

export type AddonCatalogEntry = AddonCatalogInfo & { transportUrl: string };

let allCatalogsCache: { key: string; cats: AddonCatalogEntry[]; at: number } | null = null;
const ALL_CATALOGS_TTL_MS = 5 * 60_000;

/** Every installed addon's catalogs, each tagged with its transportUrl — for the
 *  Discover Type/Catalog selectors that browse all addons (Cinemeta movie/series,
 *  Anime Kitsu's anime catalogs, channels, …), like the Windows app. 5-min cache. */
export async function loadAllAddonCatalogs(token: string | null): Promise<AddonCatalogEntry[]> {
  const key = token ?? 'guest';
  if (allCatalogsCache && allCatalogsCache.key === key && Date.now() - allCatalogsCache.at < ALL_CATALOGS_TTL_MS) {
    return allCatalogsCache.cats;
  }
  let urls: string[] = [];
  try {
    urls = await loadInstalledAddonUrls(token);
  } catch {
    urls = [];
  }
  const lists = await Promise.all(
    urls.map((u) =>
      fetchAddonCatalogs(u)
        .then((cs) => cs.map((c) => ({ ...c, transportUrl: u })))
        .catch(() => [] as AddonCatalogEntry[]),
    ),
  );
  const flat = lists.flat();
  if (flat.length) allCatalogsCache = { key, cats: flat, at: Date.now() };
  return flat;
}

/** Display name: manifest name → Torrentio special-case → URL. Same logic as
 *  core's getAddonDisplayName, typed against our local AddonRow/AddonManifestLite
 *  (core's helper wants its own AddonDescriptor manifest shape). */
export function getAddonDisplayName(row: { transportUrl: string; manifest?: AddonManifestLite | null }): string {
  const manifestName = row.manifest?.name?.trim();
  if (manifestName) return manifestName;
  if (TORRENTIO_RE.test(row.transportUrl)) {
    return /realdebrid=/i.test(row.transportUrl) ? 'Torrentio RD' : 'Torrentio';
  }
  return row.transportUrl;
}
