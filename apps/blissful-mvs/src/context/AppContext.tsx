import { createContext, useContext } from 'react';
import type { AddonDescriptor, LibraryItem, StremioApiUser } from '../lib/stremioApi';
import type { MediaItem } from '../types/media';
import type { StremioAddonManifest } from '../lib/stremioAddon';
import type { HomeRowOption, HomeRowPrefs } from '../lib/homeRows';
import type { PlayerSettings } from '../lib/playerSettings';
import type { SavedAccount } from '../lib/savedAccounts';
import type { StoredProfile } from '../lib/storageApi';

export type AppContextValue = {
  uiStyle: 'classic' | 'netflix';
  setUiStyle: (value: 'classic' | 'netflix') => void;
  isDark: boolean;
  setIsDark: (value: boolean) => void;
  darkGradientKey: string;
  setDarkGradientKey: (value: string) => void;
  lightGradientKey: string;
  setLightGradientKey: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
  movieItems: MediaItem[];
  seriesItems: MediaItem[];
  loading: boolean;
  error: string | null;
  manifest: StremioAddonManifest | null;
  authKey: string | null;
  user: StremioApiUser | null;
  userProfile: StoredProfile;
  updateUserProfile: (profile: StoredProfile) => Promise<void>;
  continueWatching: LibraryItem[];
  addons: AddonDescriptor[];
  addonsQuery: string;
  setAddonsQuery: (value: string) => void;
  addonsLoading: boolean;
  addonsError: string | null;
  homeRowOptions: HomeRowOption[];
  homeRowPrefs: HomeRowPrefs;
  setHomeRowPrefs: (prefs: HomeRowPrefs) => void;
  saveHomeRowPrefs: (prefs: HomeRowPrefs) => Promise<void>;
  playerSettings: PlayerSettings;
  savePlayerSettings: (settings: PlayerSettings) => Promise<void>;
  homeEditMode: boolean;
  setHomeEditMode: (value: boolean) => void;
  openLogin: () => void;
  openAccount: () => void;
  openAddAddon: () => void;
  installAddon: (url: string) => Promise<void>;
  uninstallAddon: (url: string) => Promise<void>;
  savedAccounts: SavedAccount[];
  switchAccount: (authKey: string) => Promise<void>;
  removeAccount: (authKey: string) => void;
  updateSavedAccountProfile: (authKey: string, profile: StoredProfile) => void;
};

export const AppContext = createContext<AppContextValue | null>(null);

/**
 * @deprecated Prefer the focused hooks: `useAuth()`, `useUI()`, `useStorage()`, `useAddons()`.
 * This facade will be removed once all consumers are migrated.
 */
export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('AppContext is not available');
  }
  return ctx;
}
