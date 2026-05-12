import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useAddonsManager } from '../layout/app-shell/hooks/useAddonsManager';
import type { AddonDescriptor } from '../lib/stremioApi';
import type { BlissfulStorageState } from '../lib/storageApi';

type AddonsContextValue = {
  addons: AddonDescriptor[];
  addonsLoading: boolean;
  addonsError: string | null;
  setAddonsError: (value: string | null) => void;
  installAddon: (url: string) => Promise<void>;
  uninstallAddon: (url: string) => Promise<void>;
};

export const AddonsContext = createContext<AddonsContextValue | null>(null);

export function useAddons(): AddonsContextValue {
  const ctx = useContext(AddonsContext);
  if (!ctx) throw new Error('useAddons must be used within an AddonsProvider');
  return ctx;
}

type AddonsProviderProps = {
  authKey: string | null;
  storedAddonUrls: string[] | null;
  persistStorageState: (partial: Partial<BlissfulStorageState>) => void;
  children: ReactNode;
};

export function AddonsProvider({
  authKey,
  storedAddonUrls,
  persistStorageState,
  children,
}: AddonsProviderProps) {
  const {
    addons,
    addonsLoading,
    addonsError,
    setAddonsError,
    installAddon,
    uninstallAddon,
  } = useAddonsManager({ authKey, storedAddonUrls, persistStorageState });

  const value = useMemo<AddonsContextValue>(
    () => ({
      addons,
      addonsLoading,
      addonsError,
      setAddonsError,
      installAddon,
      uninstallAddon,
    }),
    [addons, addonsLoading, addonsError, setAddonsError, installAddon, uninstallAddon]
  );

  return <AddonsContext.Provider value={value}>{children}</AddonsContext.Provider>;
}
