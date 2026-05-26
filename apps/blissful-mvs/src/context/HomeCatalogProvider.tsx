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
import {
  getHomeRowOptions,
  type HomeRowOption,
  type HomeRowPrefs,
} from '../lib/homeRows';
import { HOME_PREFS_KEY } from '../layout/app-shell/constants';
import { useHomeCatalog, type HomeCatalog } from '../layout/app-shell/hooks/useHomeCatalog';
import { useAddons } from './AddonsProvider';
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
  const { setHomeRowPrefs, persistStorageState } = useStorage();

  const homeRowOptions = useMemo(() => getHomeRowOptions(addons), [addons]);

  const saveHomeRowPrefs = useCallback(
    async (prefs: HomeRowPrefs) => {
      setHomeRowPrefs(prefs);
      localStorage.setItem(HOME_PREFS_KEY, JSON.stringify(prefs));
      // `persistStorageState` writes to blissful-storage's account_state
      // collection (authed via JWT); that's the canonical home for the
      // user's home-row prefs now.
      persistStorageState({ homeRowPrefs: prefs });
    },
    [persistStorageState, setHomeRowPrefs],
  );

  const value = useMemo<HomeCatalogContextValue>(
    () => ({ ...catalog, homeRowOptions, saveHomeRowPrefs }),
    [catalog, homeRowOptions, saveHomeRowPrefs],
  );

  return <HomeCatalogContext.Provider value={value}>{children}</HomeCatalogContext.Provider>;
}
