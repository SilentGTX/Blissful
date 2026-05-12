import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  saveStoredState,
  type BlissfulStorageState,
  type StoredProfile,
} from '../lib/storageApi';
import {
  DEFAULT_PLAYER_SETTINGS,
  readStoredPlayerSettings,
  writeStoredPlayerSettings,
  type PlayerSettings,
} from '../lib/playerSettings';
import type { HomeRowPrefs } from '../lib/homeRows';
// HOME_PREFS_KEY removed (unused after provider refactor)
import { useStoredStateSync } from '../layout/app-shell/hooks/useStoredStateSync';
import { readStoredHomePrefs } from '../layout/app-shell/utils';

type StorageContextValue = {
  storageState: BlissfulStorageState | null;
  storageHydrated: boolean;
  storedAddonUrls: string[] | null;
  homeRowPrefs: HomeRowPrefs;
  setHomeRowPrefs: (prefs: HomeRowPrefs) => void;
  playerSettings: PlayerSettings;
  savePlayerSettings: (settings: PlayerSettings) => Promise<void>;
  persistStorageState: (partial: Partial<BlissfulStorageState>) => void;
  userProfile: StoredProfile;
  updateUserProfile: (profile: StoredProfile) => Promise<void>;
  /** Raw setters exposed for AppShell migration */
  setStorageState: React.Dispatch<React.SetStateAction<BlissfulStorageState | null>>;
  setStoredAddonUrls: React.Dispatch<React.SetStateAction<string[] | null>>;
};

export const StorageContext = createContext<StorageContextValue | null>(null);

export function useStorage(): StorageContextValue {
  const ctx = useContext(StorageContext);
  if (!ctx) throw new Error('useStorage must be used within a StorageProvider');
  return ctx;
}

type StorageProviderProps = {
  authKey: string | null;
  savedAccounts: Array<{ authKey: string; displayName?: string; avatar?: string }>;
  isDark: boolean;
  setIsDark: (v: boolean) => void;
  setUiStyle: (v: 'classic' | 'netflix') => void;
  setDarkGradientKey: (v: string) => void;
  setLightGradientKey: (v: string) => void;
  children: ReactNode;
};

export function StorageProvider({
  authKey,
  savedAccounts,
  isDark,
  setIsDark,
  setUiStyle,
  setDarkGradientKey,
  setLightGradientKey,
  children,
}: StorageProviderProps) {
  const [storageState, setStorageState] = useState<BlissfulStorageState | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [storedAddonUrls, setStoredAddonUrls] = useState<string[] | null>(null);
  const [homeRowPrefs, setHomeRowPrefs] = useState<HomeRowPrefs>(
    () => readStoredHomePrefs() ?? { order: [], hidden: [] }
  );
  const [playerSettings, setPlayerSettings] = useState<PlayerSettings>(
    () => readStoredPlayerSettings()
  );

  // Synchronously reset account-scoped state when authKey changes so that
  // effects (e.g. uiStyle persistence) that fire before useStoredStateSync
  // cannot leak the previous account's data into the new account's storage.
  const prevAuthKeyRef = useRef(authKey);
  if (prevAuthKeyRef.current !== authKey) {
    prevAuthKeyRef.current = authKey;
    setStorageState(null);
    setStoredAddonUrls(null);
    setStorageHydrated(false);
  }

  // Track hydration via ref so persistStorageState can read the latest value
  // without adding storageHydrated to its dependency array.
  const storageHydratedRef = useRef(storageHydrated);
  storageHydratedRef.current = storageHydrated;

  const persistStorageState = useCallback(
    (partial: Partial<BlissfulStorageState>) => {
      setStorageState((prev) => {
        return { ...(prev ?? {}), ...partial };
      });
      // Send only the partial to the server — the server merges fields
      // individually via buildMergedState. Sending the full merged state
      // would overwrite the new account with stale fields (like profile)
      // from the previous account during transitions.
      if (authKey && storageHydratedRef.current) {
        void saveStoredState(authKey, partial).catch(() => {});
      }
    },
    [authKey]
  );

  useStoredStateSync({
    authKey,
    setStorageHydrated,
    isDark,
    setIsDark,
    setUiStyle,
    setHomeRowPrefs,
    setStoredAddonUrls,
    setDarkGradientKey,
    setLightGradientKey,
    setStorageState,
    setPlayerSettings,
  });

  const savePlayerSettings = useCallback(
    async (settings: PlayerSettings) => {
      const next = { ...DEFAULT_PLAYER_SETTINGS, ...settings };
      setPlayerSettings(next);
      writeStoredPlayerSettings(next);
      persistStorageState({ playerSettings: next });
    },
    [persistStorageState]
  );

  const userProfile: StoredProfile = useMemo(() => {
    const fromState = storageState?.profile;
    if (fromState?.displayName || fromState?.avatar) return fromState;
    const saved = authKey ? savedAccounts.find((item) => item.authKey === authKey) : null;
    return {
      displayName: saved?.displayName,
      avatar: saved?.avatar,
    };
  }, [authKey, savedAccounts, storageState?.profile]);

  const updateUserProfile = useCallback(
    async (profile: StoredProfile) => {
      if (!authKey) return;
      const merged = {
        ...(storageState ?? {}),
        profile: {
          ...(storageState?.profile ?? {}),
          ...profile,
        },
      } as BlissfulStorageState;
      setStorageState(merged);
      await saveStoredState(authKey, merged);
    },
    [authKey, storageState]
  );

  const value = useMemo<StorageContextValue>(
    () => ({
      storageState,
      storageHydrated,
      storedAddonUrls,
      homeRowPrefs,
      setHomeRowPrefs,
      playerSettings,
      savePlayerSettings,
      persistStorageState,
      userProfile,
      updateUserProfile,
      setStorageState,
      setStoredAddonUrls,
    }),
    [
      storageState,
      storageHydrated,
      storedAddonUrls,
      homeRowPrefs,
      playerSettings,
      savePlayerSettings,
      persistStorageState,
      userProfile,
      updateUserProfile,
    ]
  );

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
}
