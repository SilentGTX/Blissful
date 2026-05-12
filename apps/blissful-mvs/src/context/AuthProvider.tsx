import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getUser, type StremioApiUser } from '../lib/stremioApi';
import {
  getSavedAccounts,
  removeSavedAccount,
  upsertSavedAccount,
  type SavedAccount,
} from '../lib/savedAccounts';
import { useUserSession } from '../layout/app-shell/hooks/useUserSession';
import { notifyError, notifySuccess } from '../lib/toastQueues';

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

type AuthContextValue = {
  authKey: string | null;
  user: StremioApiUser | null;
  savedAccounts: SavedAccount[];
  login: (nextKey: string, nextUser: StremioApiUser) => void;
  logout: () => void;
  switchAccount: (authKeyToUse: string) => Promise<void>;
  removeAccount: (authKeyToRemove: string) => void;
  setAuthKey: (value: string | null) => void;
  setUser: (value: StremioApiUser | null) => void;
  setSavedAccounts: (value: SavedAccount[]) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  // ---- state --------------------------------------------------------------

  const [authKey, setAuthKey] = useState<string | null>(
    () => localStorage.getItem('stremioAuthKey'),
  );

  const [user, setUser] = useState<StremioApiUser | null>(() => {
    try {
      const raw = localStorage.getItem('stremioUser');
      if (!raw) return null;
      return JSON.parse(raw) as StremioApiUser;
    } catch {
      return null;
    }
  });

  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(
    () => getSavedAccounts(),
  );

  // ---- session hook (validates authKey on mount / change) -----------------

  useUserSession({ authKey, setAuthKey, setUser });

  // ---- callbacks ----------------------------------------------------------

  const login = useCallback(
    (nextKey: string, nextUser: StremioApiUser) => {
      localStorage.setItem('stremioAuthKey', nextKey);
      localStorage.setItem('stremioUser', JSON.stringify(nextUser));
      setAuthKey(nextKey);
      setUser(nextUser);
      upsertSavedAccount(nextKey, nextUser);
      setSavedAccounts(getSavedAccounts());
    },
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem('stremioAuthKey');
    localStorage.removeItem('stremioUser');
    setAuthKey(null);
    setUser(null);
    notifySuccess('Logged out', 'Your session was cleared successfully.');
  }, []);

  const switchAccount = useCallback(
    async (authKeyToUse: string) => {
      const next = savedAccounts.find((a) => a.authKey === authKeyToUse);
      if (!next) return;

      try {
        const freshUser = await getUser({ authKey: authKeyToUse });
        localStorage.setItem('stremioAuthKey', authKeyToUse);
        localStorage.setItem('stremioUser', JSON.stringify(freshUser));
        setAuthKey(authKeyToUse);
        setUser(freshUser);
        upsertSavedAccount(authKeyToUse, freshUser, {
          displayName: next.displayName,
          avatar: next.avatar,
        });
        setSavedAccounts(getSavedAccounts());

        if (freshUser._id !== next.userId) {
          notifyError(
            'Account mismatch',
            'Saved session data changed. Refreshed account info.',
          );
        } else {
          notifySuccess(
            'Account switched',
            `Now using ${freshUser.email ?? next.email}`,
          );
        }
      } catch {
        notifyError('Session expired', 'Please login again for this account.');
      }
    },
    [savedAccounts],
  );

  const removeAccount = useCallback(
    (authKeyToRemove: string) => {
      const removed = savedAccounts.find((a) => a.authKey === authKeyToRemove);
      removeSavedAccount(authKeyToRemove);
      const nextAccounts = getSavedAccounts();
      setSavedAccounts(nextAccounts);

      if (authKey === authKeyToRemove) {
        localStorage.removeItem('stremioAuthKey');
        localStorage.removeItem('stremioUser');
        setAuthKey(null);
        setUser(null);
      }

      if (removed) {
        notifySuccess(
          'Account removed',
          `${removed.email} was removed from quick switch.`,
        );
      }
    },
    [authKey, savedAccounts],
  );

  // ---- memo ---------------------------------------------------------------

  const value = useMemo<AuthContextValue>(
    () => ({
      authKey,
      user,
      savedAccounts,
      login,
      logout,
      switchAccount,
      removeAccount,
      setAuthKey,
      setUser,
      setSavedAccounts,
    }),
    [
      authKey,
      user,
      savedAccounts,
      login,
      logout,
      switchAccount,
      removeAccount,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
