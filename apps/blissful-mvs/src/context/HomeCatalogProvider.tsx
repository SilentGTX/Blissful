// Home page catalog feed + home-row settings, lifted out of AppShell.
// Previously these lived as inline state + a `useEffect` fetcher
// inside the 1,200-line AppShell, with `saveHomeRowPrefs` and
// `homeRowOptions` shipped to consumers through the deprecated
// AppContext facade.
//
// Splitting them off:
//   * lets HomePage subscribe to only the catalog (movies + series +
//     loading + manifest) without re-rendering on every modal open;
//   * gives HomeSettingsModal a stable, providerised `saveHomeRowPrefs`
//     instead of a closure rebuilt on every AppShell re-render;
//   * removes ~30 lines + 5 useState calls from AppShell.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { datastorePutCollection } from '../lib/stremioApi';
import {
  getHomeRowOptions,
  type HomeRowOption,
  type HomeRowPrefs,
} from '../lib/homeRows';
import { HOME_PREFS_KEY } from '../layout/app-shell/constants';
import { useHomeCatalog, type HomeCatalog } from '../layout/app-shell/hooks/useHomeCatalog';
import { useAddons } from './AddonsProvider';
import { useAuth } from './AuthProvider';
import { useStorage } from './StorageProvider';

type HomeCatalogContextValue = HomeCatalog & {
  homeRowOptions: HomeRowOption[];
  saveHomeRowPrefs: (prefs: HomeRowPrefs) => Promise<void>;
};

export const HomeCatalogContext = createContext<HomeCatalogContextValue | null>(null);

export function useHomeCatalogContext(): HomeCatalogContextValue {
  const ctx = useContext(HomeCatalogContext);
  if (!ctx) {
    throw new Error('useHomeCatalogContext must be used within a HomeCatalogProvider');
  }
  return ctx;
}

export function HomeCatalogProvider({ children }: { children: ReactNode }) {
  const catalog = useHomeCatalog();
  const { addons } = useAddons();
  const { authKey } = useAuth();
  const { setHomeRowPrefs, persistStorageState } = useStorage();

  const homeRowOptions = useMemo(() => getHomeRowOptions(addons), [addons]);

  const saveHomeRowPrefs = useCallback(
    async (prefs: HomeRowPrefs) => {
      setHomeRowPrefs(prefs);
      localStorage.setItem(HOME_PREFS_KEY, JSON.stringify(prefs));
      persistStorageState({ homeRowPrefs: prefs });
      if (!authKey) return;
      try {
        await datastorePutCollection<HomeRowPrefs>({
          authKey,
          collection: 'blissful_home',
          items: [{ _id: 'home', data: prefs }],
        });
      } catch (err: unknown) {
        // Some accounts have datastore sync disabled server-side — the
        // local-only save above is still valid, just don't propagate
        // the error to the toast queue.
        const message = err instanceof Error ? err.message : '';
        if (message.toLowerCase().includes('sync disabled')) return;
        throw err;
      }
    },
    [authKey, persistStorageState, setHomeRowPrefs],
  );

  const value = useMemo<HomeCatalogContextValue>(
    () => ({ ...catalog, homeRowOptions, saveHomeRowPrefs }),
    [catalog, homeRowOptions, saveHomeRowPrefs],
  );

  return <HomeCatalogContext.Provider value={value}>{children}</HomeCatalogContext.Provider>;
}
