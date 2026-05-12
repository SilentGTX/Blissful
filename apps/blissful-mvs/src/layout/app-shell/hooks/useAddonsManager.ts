import { useCallback, useEffect, useState } from 'react';
import {
  addonCollectionGet,
  addonCollectionSet,
  type AddonDescriptor,
} from '../../../lib/stremioApi';
import type { BlissfulStorageState } from '../../../lib/storageApi';

type UseAddonsManagerParams = {
  authKey: string | null;
  storedAddonUrls: string[] | null;
  persistStorageState: (partial: Partial<BlissfulStorageState>) => void;
};

export function useAddonsManager({ authKey, storedAddonUrls, persistStorageState }: UseAddonsManagerParams) {
  const [addons, setAddons] = useState<AddonDescriptor[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonsError, setAddonsError] = useState<string | null>(null);

  useEffect(() => {
    if (!authKey) {
      // Guest mode: provide default Torrentio addon so guests can browse and
      // play streams without logging in.  Prefer localStorage (written by
      // logged-in sessions) then fall back to the build-time env var.
      const guestUrls: string[] = [];
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

      setAddons(guestUrls.map((transportUrl) => ({ transportUrl })));
      setAddonsLoading(false);
      return;
    }

    let cancelled = false;
    setAddonsLoading(true);
    addonCollectionGet({ authKey })
      .then((items) => {
        if (cancelled) return;
        setAddons(items);
        persistStorageState({ addons: items.map((addon) => addon.transportUrl) });
      })
      .catch(() => {
        if (cancelled) return;
        if (storedAddonUrls?.length) {
          setAddons(storedAddonUrls.map((transportUrl) => ({ transportUrl })));
          return;
        }
        setAddons([]);
      })
      .finally(() => {
        if (cancelled) return;
        setAddonsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authKey, persistStorageState, storedAddonUrls]);

  const installAddon = useCallback(
    async (url: string) => {
      if (!authKey) return;
      try {
        const next = [{ transportUrl: url }, ...addons].filter(
          (addon, index, arr) => arr.findIndex((a) => a.transportUrl === addon.transportUrl) === index
        );
        setAddonsLoading(true);
        setAddonsError(null);
        await addonCollectionSet({ authKey, addons: next });
        setAddons(next);
        persistStorageState({ addons: next.map((addon) => addon.transportUrl) });
      } catch (err: unknown) {
        setAddonsError(err instanceof Error ? err.message : 'Failed to install addon');
        throw err;
      } finally {
        setAddonsLoading(false);
      }
    },
    [addons, authKey, persistStorageState]
  );

  const uninstallAddon = useCallback(
    async (url: string) => {
      if (!authKey) return;
      try {
        const next = addons.filter((addon) => addon.transportUrl !== url);
        setAddonsLoading(true);
        setAddonsError(null);
        await addonCollectionSet({ authKey, addons: next });
        setAddons(next);
        persistStorageState({ addons: next.map((addon) => addon.transportUrl) });
      } catch (err: unknown) {
        setAddonsError(err instanceof Error ? err.message : 'Failed to uninstall addon');
        throw err;
      } finally {
        setAddonsLoading(false);
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
