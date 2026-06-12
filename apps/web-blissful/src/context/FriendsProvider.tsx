// Friends graph for the signed-in Stremio account. Polls the
// blissful-storage backend on mount + every minute so incoming
// requests show up without a manual refresh. Guests (no authKey)
// see an empty state — friends are tied to a real account.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  acceptFriendRequest,
  fetchFriends,
  removeFriend,
  sendFriendRequest,
  setFriendNickname,
  type FriendRecord,
  type FriendsState,
} from '../lib/friendsApi';
import { useAuth } from './AuthProvider';

type FriendsContextValue = {
  friends: FriendRecord[];
  incoming: FriendRecord[];
  outgoing: FriendRecord[];
  loading: boolean;
  error: string | null;
  /** Force a refresh — call after sending/accepting so the UI updates
   *  without waiting for the next poll. */
  refresh: () => Promise<void>;
  sendRequest: (args: { toUserId: string; toDisplayName?: string }) => Promise<{ accepted?: boolean; already?: boolean }>;
  accept: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Per-viewer nickname override for an accepted friend. Pass null
   *  to clear. */
  setNickname: (id: string, nickname: string | null) => Promise<void>;
};

const FriendsContext = createContext<FriendsContextValue | null>(null);

export function useFriends(): FriendsContextValue {
  const ctx = useContext(FriendsContext);
  if (!ctx) throw new Error('useFriends must be used within FriendsProvider');
  return ctx;
}

const POLL_INTERVAL_MS = 60 * 1000;
const EMPTY_STATE: FriendsState = { friends: [], incoming: [], outgoing: [] };

export function FriendsProvider({ children }: { children: ReactNode }) {
  const { authKey, user } = useAuth();
  const [state, setState] = useState<FriendsState>(EMPTY_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable cancellation across overlapping refresh() calls — the most
  // recent fetch wins even if an earlier one resolves later.
  const fetchSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!authKey) {
      setState(EMPTY_STATE);
      setError(null);
      return;
    }
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const data = await fetchFriends(authKey);
      if (seq !== fetchSeqRef.current) return;
      setState(data);
      setError(null);
    } catch (err: unknown) {
      if (seq !== fetchSeqRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load friends';
      setError(message);
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [authKey]);

  useEffect(() => {
    refresh();
    if (!authKey) return;
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [authKey, refresh]);

  const sendRequest = useCallback(
    async (args: { toUserId: string; toDisplayName?: string }) => {
      if (!authKey) throw new Error('Sign in to add friends');
      const result = await sendFriendRequest(authKey, {
        ...args,
        fromDisplayName: user?.displayName || user?.username || user?.email || undefined,
      });
      await refresh();
      return { accepted: result.accepted, already: result.already };
    },
    [authKey, user, refresh]
  );

  const accept = useCallback(
    async (id: string) => {
      if (!authKey) return;
      await acceptFriendRequest(authKey, id);
      await refresh();
    },
    [authKey, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!authKey) return;
      await removeFriend(authKey, id);
      await refresh();
    },
    [authKey, refresh]
  );

  const setNickname = useCallback(
    async (id: string, nickname: string | null) => {
      if (!authKey) return;
      await setFriendNickname(authKey, id, nickname);
      await refresh();
    },
    [authKey, refresh]
  );

  const value = useMemo<FriendsContextValue>(
    () => ({
      friends: state.friends,
      incoming: state.incoming,
      outgoing: state.outgoing,
      loading,
      error,
      refresh,
      sendRequest,
      accept,
      remove,
      setNickname,
    }),
    [state, loading, error, refresh, sendRequest, accept, remove, setNickname]
  );

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}
