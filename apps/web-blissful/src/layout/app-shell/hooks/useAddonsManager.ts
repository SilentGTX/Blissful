import { useCallback, useEffect, useState } from 'react';
import type { AddonDescriptor } from '../../../lib/mediaTypes';
import { fetchAddonManifest, normalizeAddonBaseUrl, stripTorrentioDebrid } from '../../../lib/stremioAddon';
import type { BlissfulStorageState } from '../../../lib/storageApi';

type UseAddonsManagerParams = {
  authKey: string | null;
  storedAddonUrls: string[] | null;
  persistStorageState: (partial: Partial<BlissfulStorageState>) => void;
  realDebridApiKey?: string;
};

const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
const TORRENTIO_RE = /torrentio\.strem\.fun/i;

/** Hydrate the in-memory addon list from blissful-storage (signed-in)
 *  or from local defaults (guest mode). Stremio's cloud `addonCollection`
 *  is no longer involved — Blissful is the source of truth for which
 *  addons a user has installed. */
export function useAddonsManager({ authKey, storedAddonUrls, persistStorageState, realDebridApiKey }: UseAddonsManagerParams) {
  const [addons, setAddons] = useState<AddonDescriptor[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonsError, setAddonsError] = useState<string | null>(null);

  useEffect(() => {
    // Pick the source of truth for the URL list, then map to descriptors.
    // Order: storage state (authed users) → local guest fallback.
    const guestUrls: string[] = [];
    if (!authKey) {
      try {
        const raw = localStorage.getItem('blissfulTorrentioUrls');
        if (raw) {
          const parsed = JSON.parse(raw) as string[];
          if (Array.isArray(parsed)) guestUrls.push(...parsed);
        }
      } catch { /* ignore */ }
      if (guestUrls.length === 0) {
        const envUrl = import.meta.env.VITE_DEFAULT_TORRENTIO_URL as string | undefined;
        if (envUrl) guestUrls.push(envUrl);
      }
    }

    let sourceUrls = authKey
      ? (storedAddonUrls ?? [])
      : guestUrls;

    if (authKey && realDebridApiKey) {
      const rdUrl = `https://torrentio.strem.fun/realdebrid=${realDebridApiKey}/manifest.json`;
      sourceUrls = sourceUrls.filter((u) => !TORRENTIO_RE.test(u));
      sourceUrls.push(rdUrl);
    } else {
      // No RD key in effect (guest, or a profile without its own key): strip any
      // debrid token that leaked into a Torrentio URL — typically carried in by
      // the cross-profile clone-sync — so Real-Debrid stays governed solely by
      // THIS profile's own key (the branch above). Dedupe in case stripping
      // collapses a keyed + plain Torrentio into the same URL.
      sourceUrls = Array.from(new Set(sourceUrls.map(stripTorrentioDebrid)));
    }

    // Always include Cinemeta first — DiscoverPage's redirect picks it
    // up as the default movie catalog source.
    const finalUrls = [CINEMETA_URL, ...sourceUrls.filter((u) => u !== CINEMETA_URL)];
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
