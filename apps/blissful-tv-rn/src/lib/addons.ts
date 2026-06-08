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
