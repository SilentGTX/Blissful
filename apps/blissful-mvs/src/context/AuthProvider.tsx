// Compatibility shim that exposes the project's historical
// `useAuth()` / `AuthProvider` API on top of the new Blissful JWT
// auth. Keeps existing consumers compiling while the underlying
// auth has been swapped over wholesale.
//
// Field mapping:
//   - `authKey`               → Blissful JWT token
//   - `user._id` / `user.id`  → Blissful user id
//   - `user.fullname` / `user.displayName`
//   - `user.email`, `user.avatar` — passed through
//   - `savedAccounts`         → empty (multi-account is gone)
//   - `login(email, password)` — new signature
//   - `register(...)`         — new
//   - `logout()`              — clears the JWT
//   - `switchAccount`, `removeAccount`, `setAuthKey`, `setUser`,
//     `setSavedAccounts`, `updateSavedAccountProfile` — no-op stubs
//     so legacy call sites don't crash. They'll be cleaned up as the
//     surrounding UI gets pruned.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { BlissfulAuthProvider, useBlissfulAuth } from './BlissfulAuthProvider';

// Mirror the old StremioApiUser shape just well enough to keep
// existing code paths working. `_id`/`id` and
// `fullname`/`displayName` are kept as aliases of each other.
// `username` is the new primary login identifier; `email` may be
// null on accounts created under the new flow (the field is kept
// for legacy accounts).
export type CompatUser = {
  _id: string;
  id: string;
  username: string | null;
  email: string | null;
  fullname: string;
  displayName: string;
  avatar: string | null;
};

export type AuthContextValue = {
  authKey: string | null;
  user: CompatUser | null;
  savedAccounts: never[];
  hydrating: boolean;
  /** `identifier` is the username or (for legacy accounts) the email. */
  login: (identifier: string, password: string) => Promise<{ token: string; user: CompatUser }>;
  register: (args: {
    username: string;
    password: string;
    displayName?: string;
  }) => Promise<void>;
  updateProfile: (updates: { username?: string; displayName?: string; avatar?: string | null }) => Promise<void>;
  logout: () => void;
  // ---- Legacy no-op stubs (kept so old callers compile / run). ----
  switchAccount: (authKeyToUse: string) => Promise<void>;
  removeAccount: (authKeyToRemove: string) => void;
  setAuthKey: (value: string | null) => void;
  setUser: (value: unknown) => void;
  setSavedAccounts: (value: never[]) => void;
  updateSavedAccountProfile: (authKey: string, profile: unknown) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

function AuthCompatBridge({ children }: { children: ReactNode }) {
  const blissful = useBlissfulAuth();

  const value = useMemo<AuthContextValue>(() => {
    const userDisplayFallback = (u: { displayName: string | null; username: string | null; email: string | null }) =>
      u.displayName || u.username || u.email || 'User';
    const user: CompatUser | null = blissful.user
      ? {
          _id: blissful.user.id,
          id: blissful.user.id,
          username: blissful.user.username,
          email: blissful.user.email,
          fullname: userDisplayFallback(blissful.user),
          displayName: userDisplayFallback(blissful.user),
          avatar: blissful.user.avatar,
        }
      : null;

    return {
      authKey: blissful.token,
      user,
      savedAccounts: [],
      hydrating: blissful.hydrating,
      login: async (identifier, password) => {
        const result = await blissful.login(identifier, password);
        const compatUser: CompatUser = {
          _id: result.user.id,
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          fullname: userDisplayFallback(result.user),
          displayName: userDisplayFallback(result.user),
          avatar: result.user.avatar,
        };
        return { token: result.token, user: compatUser };
      },
      register: async (args) => {
        await blissful.register(args);
      },
      updateProfile: blissful.updateProfile,
      logout: blissful.logout,
      // Legacy multi-account flow no longer exists — these stubs let
      // any stragglers compile without crashing at runtime.
      switchAccount: async () => {},
      removeAccount: () => {},
      setAuthKey: () => {},
      setUser: () => {},
      setSavedAccounts: () => {},
      updateSavedAccountProfile: () => {},
    };
  }, [blissful]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <BlissfulAuthProvider>
      <AuthCompatBridge>{children}</AuthCompatBridge>
    </BlissfulAuthProvider>
  );
}
