// Tracks watch-party rooms that a friend has just opened for me via
// the invite flow, so the friend's row in the sidebar can offer
// "Join party" instead of "Request party" until that room closes.
//
// State source of truth is the user-socket push stream:
//   - `party:invite-accepted` -> store `{ [hostUserId]: room }`
//   - `party:room-closed`     -> drop the matching entry by code
//
// We mirror the map into sessionStorage so a page refresh keeps the
// pending Join target visible during the session. The server is the
// authority — anything stale clears the moment the next close event
// arrives or the user logs out.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';
import { useUserSocketEvent } from './UserSocketProvider';

export type ActiveParty = {
  code: string;
  type: 'movie' | 'series';
  imdbId: string;
  videoId: string | null;
  hostUserId: string;
  hostDisplayName: string;
  at: number;
};

type Map_ = Record<string, ActiveParty>; // hostUserId -> party

type ContextValue = {
  byHost: Map_;
  getByHost: (hostUserId: string) => ActiveParty | null;
  clearByCode: (code: string) => void;
};

const ActivePartiesContext = createContext<ContextValue | null>(null);

const STORAGE_KEY = 'bliss:activeParties';

function readCache(): Map_ {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Map_) : {};
  } catch {
    return {};
  }
}

function writeCache(value: Map_): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

export function ActivePartiesProvider({ children }: { children: ReactNode }) {
  const { authKey } = useAuth();
  const [byHost, setByHost] = useState<Map_>(() => readCache());

  // Persist mirror on every change.
  useEffect(() => {
    writeCache(byHost);
  }, [byHost]);

  // Drop everything on sign-out — these rooms belong to the previous
  // account and we don't want them leaking into a new session.
  useEffect(() => {
    if (!authKey) {
      setByHost({});
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, [authKey]);

  useUserSocketEvent('party:invite-accepted', (msg) => {
    setByHost((prev) => ({
      ...prev,
      [msg.host.userId]: {
        code: msg.code,
        type: msg.type,
        imdbId: msg.imdbId,
        videoId: msg.videoId,
        hostUserId: msg.host.userId,
        hostDisplayName: msg.host.displayName,
        at: msg.at,
      },
    }));
  });

  useUserSocketEvent('party:room-closed', (msg) => {
    setByHost((prev) => {
      const found = Object.entries(prev).find(([, v]) => v.code === msg.code);
      if (!found) return prev;
      const next = { ...prev };
      delete next[found[0]];
      return next;
    });
  });

  const clearByCode = useCallback((code: string) => {
    setByHost((prev) => {
      const found = Object.entries(prev).find(([, v]) => v.code === code);
      if (!found) return prev;
      const next = { ...prev };
      delete next[found[0]];
      return next;
    });
  }, []);

  const getByHost = useCallback(
    (hostUserId: string) => byHost[hostUserId] ?? null,
    [byHost]
  );

  const value = useMemo<ContextValue>(
    () => ({ byHost, getByHost, clearByCode }),
    [byHost, getByHost, clearByCode]
  );

  return (
    <ActivePartiesContext.Provider value={value}>
      {children}
    </ActivePartiesContext.Provider>
  );
}

export function useActiveParties(): ContextValue {
  const ctx = useContext(ActivePartiesContext);
  if (!ctx) throw new Error('useActiveParties must be used within ActivePartiesProvider');
  return ctx;
}

/** Convenience: returns the open party hosted by this friend, or null. */
export function useActivePartyWith(hostUserId: string | null | undefined): ActiveParty | null {
  const { byHost } = useActiveParties();
  if (!hostUserId) return null;
  return byHost[hostUserId] ?? null;
}
