import { useEffect } from 'react';
import type { HomeRowPrefs } from '../../../lib/homeRows';
import {
  DEFAULT_PLAYER_SETTINGS,
  readStoredPlayerSettings,
  writeStoredPlayerSettings,
  type PlayerSettings,
} from '../../../lib/playerSettings';
import { fetchStoredState, saveStoredState, type BlissfulStorageState } from '../../../lib/storageApi';
import { isElectronDesktopApp } from '../../../lib/platform';
import type { UiStyle } from '../types';
import { applyGradient } from '../utils';
import { HOME_PREFS_KEY } from '../constants';

type UseStoredStateSyncParams = {
  authKey: string | null;
  setStorageHydrated: (value: boolean) => void;
  isDark: boolean;
  setIsDark: (value: boolean) => void;
  setUiStyle: (value: UiStyle) => void;
  setHomeRowPrefs: (value: HomeRowPrefs) => void;
  setStoredAddonUrls: (value: string[] | null) => void;
  setDarkGradientKey: (value: string) => void;
  setLightGradientKey: (value: string) => void;
  setStorageState: (value: BlissfulStorageState | null) => void;
  setPlayerSettings: (value: PlayerSettings) => void;
};

export function useStoredStateSync({
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
}: UseStoredStateSyncParams) {
  useEffect(() => {
    if (!authKey) {
      setStorageHydrated(false);
      setStorageState(null);
      setStoredAddonUrls(null);
      return;
    }

    // Reset account-scoped state immediately when auth changes so previous
    // account profile data does not leak into the next account UI.
    setStorageState(null);
    setStoredAddonUrls(null);
    setStorageHydrated(false);

    let cancelled = false;

    fetchStoredState(authKey).then((state) => {
      if (cancelled) return;

      const local = { ...DEFAULT_PLAYER_SETTINGS, ...readStoredPlayerSettings() };
      const isDefault = JSON.stringify(local) === JSON.stringify(DEFAULT_PLAYER_SETTINGS);

      console.log('[storage-sync] fetched state:', state);

      if (!state) {
        console.warn('[storage-sync] state is null — nothing to apply');
        setStorageState(null);
        // No server state yet. Avoid overwriting a user's account from Electron defaults.
        if (!isElectronDesktopApp() && !isDefault) {
          void saveStoredState(authKey, { playerSettings: local }).catch(() => {
            // ignore
          });
        }
        return;
      }

      setStorageState(state);
      if (state.theme) {
        setIsDark(state.theme === 'dark');
      }
      if (state.uiStyle) {
        setUiStyle(state.uiStyle === 'netflix' ? 'netflix' : 'classic');
        localStorage.setItem('uiStyle', state.uiStyle);
      }
      if (state.homeRowPrefs) {
        setHomeRowPrefs(state.homeRowPrefs);
        localStorage.setItem(HOME_PREFS_KEY, JSON.stringify(state.homeRowPrefs));
      }

      if (state.playerSettings) {
        const normalizedRemote = { ...DEFAULT_PLAYER_SETTINGS, ...state.playerSettings };
        const merged = { ...readStoredPlayerSettings(), ...normalizedRemote };
        console.log('[storage-sync] applying playerSettings — remote:', state.playerSettings, 'merged:', merged);
        setPlayerSettings(merged);
        writeStoredPlayerSettings(merged);

        // Ensure account state always contains a full PlayerSettings payload.
        if (JSON.stringify(state.playerSettings) !== JSON.stringify(normalizedRemote)) {
          void saveStoredState(authKey, { ...state, playerSettings: normalizedRemote }).catch(() => {
            // ignore
          });
        }
      } else {
        // If the user customized settings while logged out (localStorage only),
        // bootstrap the server state on first sync so other devices (and Electron)
        // can pick it up.
        if (!isElectronDesktopApp() && !isDefault) {
          void saveStoredState(authKey, { ...state, playerSettings: local }).catch(() => {
            // ignore
          });
        }
      }
      if (Array.isArray(state.addons)) {
        setStoredAddonUrls(state.addons);
      }
      if (state.darkGradient) {
        setDarkGradientKey(state.darkGradient);
        localStorage.setItem('darkGradientKey', state.darkGradient);
        if (isDark) applyGradient(state.darkGradient, true);
      }
      if (state.lightGradient) {
        setLightGradientKey(state.lightGradient);
        localStorage.setItem('lightGradientKey', state.lightGradient);
        if (!isDark) applyGradient(state.lightGradient, false);
      }
      setStorageHydrated(true);
    }).catch(() => {
      if (cancelled) return;
      setStorageHydrated(true);
    }).finally(() => {
      if (cancelled) return;
      setStorageHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [
    authKey,
    isDark,
    setDarkGradientKey,
    setHomeRowPrefs,
    setIsDark,
    setLightGradientKey,
    setStorageState,
    setStoredAddonUrls,
    setUiStyle,
    setPlayerSettings,
    setStorageHydrated,
  ]);
}
