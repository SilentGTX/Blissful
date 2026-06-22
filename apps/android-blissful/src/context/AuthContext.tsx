import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  fetchCurrentBlissfulUser,
  loginBlissfulAccount,
  registerBlissfulAccount,
  updateCurrentBlissfulUser,
  type BlissfulUser,
} from '@blissful/core';
import { kv } from '../lib/storage';
import { hydrateTvSettingsFromCloud } from '../lib/tvSettings';

const TOKEN_KEY = 'bliss:authToken';

type AuthState = {
  token: string | null;
  user: BlissfulUser | null;
  /** true until the persisted token is validated against /auth/me on launch */
  hydrating: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  updateProfile: (updates: { displayName?: string; avatar?: string | null }) => Promise<void>;
  logout: () => void;
};

const AuthCtx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => kv.get(TOKEN_KEY));
  const [user, setUser] = useState<BlissfulUser | null>(null);
  const [hydrating, setHydrating] = useState(true);

  // Validate the persisted token on launch; clear it locally if rejected.
  useEffect(() => {
    let cancelled = false;
    const stored = kv.get(TOKEN_KEY);
    if (!stored) {
      setHydrating(false);
      return;
    }
    fetchCurrentBlissfulUser(stored)
      .then((u) => {
        if (cancelled) return;
        if (u) {
          setUser(u);
          setToken(stored);
        } else {
          kv.remove(TOKEN_KEY);
          setToken(null);
        }
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pull the account's saved player/appearance settings (subtitle colour/size,
  // RD key, cache size, …) into the local MMKV as soon as we have a token — on
  // launch with a persisted token, or right after login. The player + Settings
  // read the local store synchronously, and hydration was previously triggered
  // ONLY by opening the Settings screen, so styling saved on web/desktop never
  // reached the TV player unless the user happened to visit Settings first.
  // Best-effort (writes MMKV; no-op on failure).
  useEffect(() => {
    if (!token) return;
    void hydrateTvSettingsFromCloud(token);
  }, [token]);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await loginBlissfulAccount({ identifier, password });
    kv.set(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (username: string, password: string, displayName?: string) => {
    const res = await registerBlissfulAccount({ username, password, displayName });
    kv.set(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const updateProfile = useCallback(
    async (updates: { displayName?: string; avatar?: string | null }) => {
      if (!token) throw new Error('Not signed in');
      const updated = await updateCurrentBlissfulUser(token, updates);
      setUser(updated);
    },
    [token],
  );

  const logout = useCallback(() => {
    kv.remove(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ token, user, hydrating, login, register, updateProfile, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}
