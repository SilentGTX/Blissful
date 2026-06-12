import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import { updateCurrentBlissfulUser } from '../lib/blissfulAuthApi';
import {
  applyStreamingServerCacheSize,
  DEFAULT_PLAYER_SETTINGS,
  readStoredPlayerSettings,
  writeStoredPlayerSettings,
  type PlayerSettings,
} from '../lib/playerSettings';
import type { HomeRowPrefs } from '../lib/homeRows';
import type { UiStyle } from '../layout/app-shell/types';
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
  setUiStyle: (v: UiStyle) => void;
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
      // Forward a streaming-server cache-size change to the running
      // service via its `/settings` POST so the bump takes effect now,
      // not on next launch. Compared against `playerSettings` rather
      // than read from `next` blindly so we don't hit the endpoint on
      // every settings save — only when the value actually changes.
      if (next.streamingServerCacheSizeBytes !== playerSettings.streamingServerCacheSizeBytes) {
        void applyStreamingServerCacheSize(next.streamingServerCacheSizeBytes);
      }
      setPlayerSettings(next);
      writeStoredPlayerSettings(next);
      persistStorageState({ playerSettings: next });
    },
    [persistStorageState, playerSettings.streamingServerCacheSizeBytes]
  );

  // Apply the user's chosen accent color as the global `--bliss-accent`
  // CSS variable. Every UI element using `var(--bliss-accent)` (progress
  // bar fill, selected tab indicator, focus rings, loading spinner,
  // logo strokes, …) picks the new color up at runtime — no rebuild
  // needed. We also derive `--bliss-accent-glow` (the original was
  // teal × 55% alpha) so glow shadows stay matched to the hue.
  useEffect(() => {
    const accent = playerSettings.accentColor ?? '#95a2ff';
    const hex = /^#([0-9a-f]{6})$/i.test(accent) ? accent : '#95a2ff';
    const cleaned = hex.replace('#', '');
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    const root = document.documentElement;
    root.style.setProperty('--bliss-accent', hex);
    root.style.setProperty('--bliss-accent-glow', `rgba(${r}, ${g}, ${b}, 0.55)`);
  }, [playerSettings.accentColor]);

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
      // Mirror to the auth user doc so `users.displayName` /
      // `users.avatar` are the canonical source going forward — this
      // is what /auth/me returns, what JWT consumers read, and what
      // the migration prompt will see on subsequent logins. We keep
      // writing to account_state.profile too so anything still reading
      // the old shape doesn't break in the same deploy.
      const updates: { displayName?: string; avatar?: string | null } = {};
      if (typeof profile.displayName === 'string') updates.displayName = profile.displayName;
      if (typeof profile.avatar === 'string') updates.avatar = profile.avatar;
      if (Object.keys(updates).length > 0) {
        await updateCurrentBlissfulUser(authKey, updates).catch((err: unknown) => {
          console.warn('[auth] profile mirror to /auth/me failed:', err);
        });
      }
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
