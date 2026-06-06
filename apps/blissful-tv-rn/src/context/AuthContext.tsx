import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  fetchCurrentBlissfulUser,
  loginBlissfulAccount,
  registerBlissfulAccount,
  type BlissfulUser,
} from '@blissful/core';
import { kv } from '../lib/storage';

const TOKEN_KEY = 'bliss:authToken';

type AuthState = {
  token: string | null;
  user: BlissfulUser | null;
  /** true until the persisted token is validated against /auth/me on launch */
  hydrating: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
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

  const logout = useCallback(() => {
    kv.remove(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ token, user, hydrating, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}
