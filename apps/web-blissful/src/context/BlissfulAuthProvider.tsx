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
import {
  readAccounts,
  refreshAccountUser,
  removeAccount,
  upsertAccount,
  writeAccounts,
  type StoredAccount,
} from '../lib/accounts';

const TOKEN_STORAGE_KEY = 'bliss:authToken';

type BlissfulAuthContextValue = {
  token: string | null;
  user: BlissfulUser | null;
  /** Every profile signed in on this device, for the avatar switcher. The
   *  active one is whichever matches `token`. Mirrors the TV app. */
  accounts: StoredAccount[];
  /** Make a saved profile active. Everything downstream is token-keyed
   *  (library, Continue Watching, settings, friends, presence), so swapping the
   *  token re-fetches that profile's world — no reload needed. */
  switchAccount: (userId: string) => void;
  /** Forget a saved profile on this device. Signing out the ACTIVE one falls
   *  back to another saved profile if there is one, else logs out. */
  signOutAccount: (userId: string) => void;
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
  const [accounts, setAccounts] = useState<StoredAccount[]>(() => readAccounts());

  /** Remember (or refresh) a profile in the switcher after a successful auth. */
  const rememberAccount = useCallback((acc: StoredAccount) => {
    setAccounts((prev) => {
      const next = upsertAccount(prev, acc);
      writeAccounts(next);
      return next;
    });
  }, []);

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
        // Keep the switcher's cached snapshot current, and adopt a profile that
        // signed in before this feature existed so it isn't missing from the list.
        setAccounts((prev) => {
          const next = upsertAccount(prev, { token, user: fetched });
          writeAccounts(next);
          return next;
        });
      } else {
        // Server rejected this token (rotated secret, deleted user, expiry).
        // Drop it from the switcher too, then fall back to another saved
        // profile rather than dumping a multi-profile device at the login wall.
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        const remaining = removeAccount(readAccounts(), user?.id ?? '').filter((a) => a.token !== token);
        writeAccounts(remaining);
        setAccounts(remaining);
        const fallback = remaining[0] ?? null;
        if (fallback) {
          localStorage.setItem(TOKEN_STORAGE_KEY, fallback.token);
          setToken(fallback.token);
          setUser(fallback.user);
        } else {
          setToken(null);
          setUser(null);
        }
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
    rememberAccount(result);
    return result;
  }, [rememberAccount]);

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
      rememberAccount(result);
      return result;
    },
    [rememberAccount]
  );

  const switchAccount = useCallback(
    (userId: string) => {
      const target = accounts.find((a) => a.user.id === userId);
      if (!target || target.token === token) return;
      localStorage.setItem(TOKEN_STORAGE_KEY, target.token);
      // Show the cached snapshot immediately; the /auth/me effect re-validates
      // and refreshes it. Everything token-keyed downstream re-fetches.
      setUser(target.user);
      setToken(target.token);
    },
    [accounts, token]
  );

  const signOutAccount = useCallback(
    (userId: string) => {
      const target = accounts.find((a) => a.user.id === userId);
      const next = removeAccount(accounts, userId);
      writeAccounts(next);
      setAccounts(next);
      if (target && target.token !== token) return; // a background profile — nothing else to do
      // Signed out the ACTIVE profile: hand over to another saved one if there
      // is one, so a shared device doesn't drop to the login wall needlessly.
      const fallback = next[0] ?? null;
      if (fallback) {
        localStorage.setItem(TOKEN_STORAGE_KEY, fallback.token);
        setToken(fallback.token);
        setUser(fallback.user);
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
      }
    },
    [accounts, token]
  );

  /** Sign out of the ACTIVE profile. Matches the TV app: the profile is
   *  FORGOTTEN (its token is dropped), not just deactivated — otherwise "sign
   *  out" would leave a live one-click session behind on a shared device. */
  const logout = useCallback(() => {
    if (!user) {
      // Signed out mid-hydration — no id to match on, so just drop the token
      // rather than letting the fallback logic adopt someone else's profile.
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setToken(null);
      return;
    }
    signOutAccount(user.id);
  }, [signOutAccount, user]);

  const updateProfile = useCallback(
    async (updates: { username?: string; displayName?: string; avatar?: string | null }) => {
      if (!token) return;
      const fresh = await updateCurrentBlissfulUser(token, updates);
      setUser(fresh);
      // Keep the switcher row in step with a rename / new avatar.
      setAccounts((prev) => {
        const next = refreshAccountUser(prev, fresh);
        if (next !== prev) writeAccounts(next);
        return next;
      });
    },
    [token]
  );

  const value = useMemo<BlissfulAuthContextValue>(
    () => ({
      token, user, hydrating, accounts, switchAccount, signOutAccount,
      login, register, updateProfile, logout,
    }),
    [token, user, hydrating, accounts, switchAccount, signOutAccount, login, register, updateProfile, logout]
  );

  return <BlissfulAuthContext.Provider value={value}>{children}</BlissfulAuthContext.Provider>;
}
