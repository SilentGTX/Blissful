import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  fetchCurrentBlissfulUser,
  loginBlissfulAccount,
  registerBlissfulAccount,
  updateCurrentBlissfulUser,
  type BlissfulUser,
} from '@blissful/core';
import { kv } from '../lib/storage';
import { hydrateTvSettingsFromCloud } from '../lib/tvSettings';
import { readAccounts, upsertAccount, writeAccounts, type StoredAccount } from '../lib/accounts';

const TOKEN_KEY = 'bliss:authToken';

type AuthState = {
  token: string | null;
  user: BlissfulUser | null;
  /** Every signed-in profile on this device (multi-profile). The active one is `token`. */
  accounts: StoredAccount[];
  /** true until the persisted active token is validated against /auth/me on launch */
  hydrating: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  updateProfile: (updates: { displayName?: string; avatar?: string | null }) => Promise<void>;
  /** Instantly switch to another saved profile (no re-login). */
  switchAccount: (token: string) => void;
  /** Forget a saved profile; if it was active, fall back to another or sign out. */
  removeAccount: (token: string) => void;
  /** Sign out of the ACTIVE profile (removes it; falls back to another if any). */
  logout: () => void;
};

const AuthCtx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<StoredAccount[]>(() => readAccounts());
  const [token, setToken] = useState<string | null>(() => kv.get(TOKEN_KEY));
  // Optimistic: show the active account's CACHED profile immediately on boot so
  // the avatar/name render before /auth/me returns (and instantly on switch).
  const [user, setUser] = useState<BlissfulUser | null>(() => {
    const active = kv.get(TOKEN_KEY);
    return readAccounts().find((a) => a.token === active)?.user ?? null;
  });
  const [hydrating, setHydrating] = useState(true);

  // Latest active token for async callbacks — a slow /auth/me must not clobber a
  // newer switch (read this, not the captured `token`, inside .then handlers).
  const activeTokenRef = useRef(token);
  activeTokenRef.current = token;

  const persistAccounts = useCallback((next: StoredAccount[]) => {
    writeAccounts(next);
    setAccounts(next);
  }, []);

  // Validate the persisted active token on launch. On success, refresh + migrate
  // it into the accounts list (a pre-multi-profile single token seeds the list).
  // On rejection, drop it and fall back to another saved profile if present.
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
          persistAccounts(upsertAccount(readAccounts(), { token: stored, user: u }));
        } else {
          const remaining = readAccounts().filter((a) => a.token !== stored);
          persistAccounts(remaining);
          const next = remaining[remaining.length - 1];
          if (next) {
            kv.set(TOKEN_KEY, next.token);
            setToken(next.token);
            setUser(next.user);
          } else {
            kv.remove(TOKEN_KEY);
            setToken(null);
            setUser(null);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull the ACTIVE account's saved player/appearance settings (subtitle
  // colour/size, RD key, cache size, …) into local MMKV whenever the token
  // changes — launch, login, or a profile switch — so the player + Settings
  // read the right profile's values. Best-effort (writes MMKV; no-op on failure).
  useEffect(() => {
    if (!token) return;
    void hydrateTvSettingsFromCloud(token);
  }, [token]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await loginBlissfulAccount({ identifier, password });
      kv.set(TOKEN_KEY, res.token);
      persistAccounts(upsertAccount(readAccounts(), { token: res.token, user: res.user }));
      setToken(res.token);
      setUser(res.user);
    },
    [persistAccounts],
  );

  const register = useCallback(
    async (username: string, password: string, displayName?: string) => {
      const res = await registerBlissfulAccount({ username, password, displayName });
      kv.set(TOKEN_KEY, res.token);
      persistAccounts(upsertAccount(readAccounts(), { token: res.token, user: res.user }));
      setToken(res.token);
      setUser(res.user);
    },
    [persistAccounts],
  );

  const updateProfile = useCallback(
    async (updates: { displayName?: string; avatar?: string | null }) => {
      const tok = activeTokenRef.current;
      if (!tok) throw new Error('Not signed in');
      const updated = await updateCurrentBlissfulUser(tok, updates);
      setUser(updated);
      // Keep the switcher snapshot in step (new avatar shows on the chip too).
      persistAccounts(upsertAccount(readAccounts(), { token: tok, user: updated }));
    },
    [persistAccounts],
  );

  const removeAccount = useCallback(
    (tok: string) => {
      const remaining = readAccounts().filter((a) => a.token !== tok);
      persistAccounts(remaining);
      if (activeTokenRef.current === tok) {
        const next = remaining[remaining.length - 1];
        if (next) {
          kv.set(TOKEN_KEY, next.token);
          setToken(next.token);
          setUser(next.user);
        } else {
          kv.remove(TOKEN_KEY);
          setToken(null);
          setUser(null);
        }
      }
    },
    [persistAccounts],
  );

  const switchAccount = useCallback(
    (tok: string) => {
      if (tok === activeTokenRef.current) return;
      const acc = readAccounts().find((a) => a.token === tok);
      if (!acc) return;
      kv.set(TOKEN_KEY, tok);
      setToken(tok);
      setUser(acc.user); // instant — cached profile; revalidated in the background
      void fetchCurrentBlissfulUser(tok)
        .then((u) => {
          if (activeTokenRef.current !== tok) return; // switched again meanwhile
          if (u) {
            setUser(u);
            persistAccounts(upsertAccount(readAccounts(), { token: tok, user: u }));
          } else {
            removeAccount(tok); // token died — drop it + fall back
          }
        })
        .catch(() => {
          /* offline — keep showing the cached profile */
        });
    },
    [persistAccounts, removeAccount],
  );

  const logout = useCallback(() => {
    const tok = activeTokenRef.current;
    if (tok) removeAccount(tok);
    else {
      kv.remove(TOKEN_KEY);
      setToken(null);
      setUser(null);
    }
  }, [removeAccount]);

  return (
    <AuthCtx.Provider
      value={{ token, user, accounts, hydrating, login, register, updateProfile, switchAccount, removeAccount, logout }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
