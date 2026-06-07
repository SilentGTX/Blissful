import { useCallback, useEffect, useState } from 'react';
import type { AddonDescriptor } from '../../../lib/mediaTypes';
import { fetchAddonManifest, normalizeAddonBaseUrl } from '../../../lib/stremioAddon';
import type { BlissfulStorageState } from '../../../lib/storageApi';

type UseAddonsManagerParams = {
  authKey: string | null;
  storedAddonUrls: string[] | null;
  persistStorageState: (partial: Partial<BlissfulStorageState>) => void;
  realDebridApiKey?: string;
};

const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
// Bulgarian Subtitles addon — always merged into the subtitle results for
// EVERY user (guest + signed-in), like Cinemeta, so BG subs are available
// regardless of the user's saved addon list. Declares resources:["subtitles"],
// types:["movie","series"], idPrefixes:["tt"].
const BULGARIAN_SUBS_URL = 'https://bulgarian-subs-addon.onrender.com/manifest.json';

const DEFAULT_ADDON_URLS = [
  CINEMETA_URL,
  'https://torrentio.strem.fun/lite/manifest.json',
  'https://thepiratebay-plus.strem.fun/manifest.json',
  'https://opensubtitles-v3.strem.io/manifest.json',
  BULGARIAN_SUBS_URL,
];

/** Hydrate the in-memory addon list from blissful-storage (signed-in)
 *  or from local defaults (guest mode). Stremio's cloud `addonCollection`
 *  is no longer involved — Blissful is the source of truth for which
 *  addons a user has installed. */
const TORRENTIO_RE = /torrentio\.strem\.fun/i;

export function useAddonsManager({ authKey, storedAddonUrls, persistStorageState, realDebridApiKey }: UseAddonsManagerParams) {
  const [addons, setAddons] = useState<AddonDescriptor[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonsError, setAddonsError] = useState<string | null>(null);

  useEffect(() => {
    // Pick the source of truth for the URL list, then map to descriptors.
    // Order: storage state (authed users) → local guest fallback.
    let sourceUrls: string[];
    if (authKey) {
      sourceUrls = storedAddonUrls ?? [];
    } else {
      // Guests get Cinemeta + Torrentio + ThePirateBay+ by default.
      // If localStorage has cached URLs from a previous logged-in
      // session (written by useTorrentioCloneSync), use those instead.
      const cached: string[] = [];
      try {
        const raw = localStorage.getItem('blissfulTorrentioUrls');
        if (raw) {
          const parsed = JSON.parse(raw) as string[];
          if (Array.isArray(parsed) && parsed.length > 0) cached.push(...parsed);
        }
      } catch { /* ignore */ }
      // Always start with defaults, then merge any cached extras
      // (e.g. Torrentio RD URL from a previous logged-in session).
      const defaults = new Set(DEFAULT_ADDON_URLS);
      const extras = cached.filter((u) => !defaults.has(u));
      sourceUrls = [...DEFAULT_ADDON_URLS, ...extras];
    }

    // When the user has a Real-Debrid API key, inject the Torrentio RD
    // addon and remove any non-RD Torrentio URLs. This ensures all
    // torrent streams are resolved through Real-Debrid.
    if (authKey && realDebridApiKey) {
      const rdUrl = `https://torrentio.strem.fun/realdebrid=${realDebridApiKey}/manifest.json`;
      // Remove ALL existing Torrentio URLs (both RD and non-RD)
      sourceUrls = sourceUrls.filter((u) => !TORRENTIO_RE.test(u));
      // Add the RD URL
      sourceUrls.push(rdUrl);
    }

    // Always include Cinemeta first — DiscoverPage's redirect picks it
    // up as the default movie catalog source.
    let finalUrls = [CINEMETA_URL, ...sourceUrls.filter((u) => u !== CINEMETA_URL)];
    // Always merge in the Bulgarian Subtitles addon for EVERY user (guest +
    // signed-in, whose addons come from storedAddonUrls and wouldn't include
    // it otherwise), so BG subs are an always-on subtitle source. Append only
    // if not already present (user may have added it manually).
    if (!finalUrls.includes(BULGARIAN_SUBS_URL)) {
      finalUrls = [...finalUrls, BULGARIAN_SUBS_URL];
    }
    setAddons(finalUrls.map((transportUrl) => ({ transportUrl })));
    setAddonsLoading(false);
  }, [authKey, storedAddonUrls, realDebridApiKey]);

  // Hydrate any addons that don't carry a manifest. Without manifests
  // the Discover page can't enumerate Type / Catalog / Genre options
  // and shows an empty drawer on mobile.
  useEffect(() => {
    const targets = addons.filter((addon) => !addon.manifest && Boolean(addon.transportUrl));
    if (targets.length === 0) return;
    let cancelled = false;

    void Promise.all(
      targets.map(async (addon) => {
        try {
          const base = addon.transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
          const manifest = await fetchAddonManifest(base);
          return { transportUrl: addon.transportUrl, manifest };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const byUrl = new Map<string, NonNullable<typeof results[number]>['manifest']>();
      for (const r of results) {
        if (r) byUrl.set(normalizeAddonBaseUrl(r.transportUrl), r.manifest);
      }
      if (byUrl.size === 0) return;
      setAddons((prev) =>
        prev.map((addon) => {
          if (addon.manifest) return addon;
          const manifest = byUrl.get(normalizeAddonBaseUrl(addon.transportUrl));
          return manifest ? { ...addon, manifest } : addon;
        }),
      );
    });

    return () => { cancelled = true; };
  }, [addons]);

  const installAddon = useCallback(
    async (url: string) => {
      if (!authKey) return;
      try {
        const next = [{ transportUrl: url }, ...addons].filter(
          (addon, index, arr) => arr.findIndex((a) => a.transportUrl === addon.transportUrl) === index
        );
        setAddonsError(null);
        setAddons(next);
        persistStorageState({ addons: next.map((addon) => addon.transportUrl) });
      } catch (err: unknown) {
        setAddonsError(err instanceof Error ? err.message : 'Failed to install addon');
        throw err;
      }
    },
    [addons, authKey, persistStorageState]
  );

  const uninstallAddon = useCallback(
    async (url: string) => {
      if (!authKey) return;
      try {
        const next = addons.filter((addon) => addon.transportUrl !== url);
        setAddonsError(null);
        setAddons(next);
        persistStorageState({ addons: next.map((addon) => addon.transportUrl) });
      } catch (err: unknown) {
        setAddonsError(err instanceof Error ? err.message : 'Failed to uninstall addon');
        throw err;
      }
    },
    [addons, authKey, persistStorageState]
  );

  return {
    addons,
    setAddons,
    addonsLoading,
    addonsError,
    setAddonsError,
    installAddon,
    uninstallAddon,
  };
}
