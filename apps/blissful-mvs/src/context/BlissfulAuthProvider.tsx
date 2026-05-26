// Blissful auth context. Token persists to localStorage; on mount
// we validate against the server (`/auth/me`) and clear the local
// token if the server rejects it so the user lands on login.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchCurrentBlissfulUser,
  loginBlissfulAccount,
  registerBlissfulAccount,
  updateCurrentBlissfulUser,
  type BlissfulUser,
} from '../lib/blissfulAuthApi';

const TOKEN_STORAGE_KEY = 'bliss:authToken';

type BlissfulAuthContextValue = {
  token: string | null;
  user: BlissfulUser | null;
  /** Initial /auth/me hydration. True until the first round-trip
   *  completes (or determines we're not signed in). */
  hydrating: boolean;
  /** `identifier` is the username or (for legacy accounts) the email. */
  login: (identifier: string, password: string) => Promise<{ token: string; user: BlissfulUser }>;
  register: (args: {
    username: string;
    password: string;
    displayName?: string;
  }) => Promise<{ token: string; user: BlissfulUser }>;
  /** Patch the signed-in user's username, displayName, and/or avatar.
   *  Server-side writes are mirrored back into context so the UI sees
   *  the change immediately. No-ops when there's no token. Throws on
   *  validation / uniqueness errors (caller catches to show the
   *  message). */
  updateProfile: (updates: { username?: string; displayName?: string; avatar?: string | null }) => Promise<void>;
  logout: () => void;
};

const BlissfulAuthContext = createContext<BlissfulAuthContextValue | null>(null);

export function useBlissfulAuth(): BlissfulAuthContextValue {
  const ctx = useContext(BlissfulAuthContext);
  if (!ctx) throw new Error('useBlissfulAuth must be used within BlissfulAuthProvider');
  return ctx;
}

export function BlissfulAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [user, setUser] = useState<BlissfulUser | null>(null);
  const [hydrating, setHydrating] = useState<boolean>(() => Boolean(localStorage.getItem(TOKEN_STORAGE_KEY)));

  // Validate persisted token on mount. If the server rejects it (rotated
  // JWT secret, deleted user, expired), drop it locally.
  useEffect(() => {
    if (!token) {
      setHydrating(false);
      return;
    }
    let cancelled = false;
    fetchCurrentBlissfulUser(token).then((fetched) => {
      if (cancelled) return;
      if (fetched) {
        setUser(fetched);
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
      }
      setHydrating(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await loginBlissfulAccount({ identifier, password });
    localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
    setToken(result.token);
    setUser(result.user);
    return result;
  }, []);

  const register = useCallback(
    async (args: {
      username: string;
      password: string;
      displayName?: string;
    }) => {
      const result = await registerBlissfulAccount(args);
      localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
      setToken(result.token);
      setUser(result.user);
      return result;
    },
    []
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const updateProfile = useCallback(
    async (updates: { username?: string; displayName?: string; avatar?: string | null }) => {
      if (!token) return;
      const fresh = await updateCurrentBlissfulUser(token, updates);
      setUser(fresh);
    },
    [token]
  );

  const value = useMemo<BlissfulAuthContextValue>(
    () => ({ token, user, hydrating, login, register, updateProfile, logout }),
    [token, user, hydrating, login, register, updateProfile, logout]
  );

  return <BlissfulAuthContext.Provider value={value}>{children}</BlissfulAuthContext.Provider>;
}
