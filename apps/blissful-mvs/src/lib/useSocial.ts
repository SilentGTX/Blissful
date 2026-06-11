// User-search + presence-lookup hooks.

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthProvider';
import {
  lookupPresence,
  searchUsers,
  type PresenceRecord,
  type UserSearchResult,
} from './blissfulAuthApi';

// 12s so a friend starting/stopping a stream shows up quickly in the sidebar
// (the watcher now publishes activity changes immediately, so this poll is the
// only remaining latency). Small payload — just the friend IDs' presence.
const PRESENCE_POLL_MS = 12 * 1000;

/** Debounced people search across all Blissful users (excludes self). */
export function useUserSearch(query: string) {
  const { authKey } = useAuth();
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authKey || !query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchUsers(authKey, query)
        .then((list) => {
          if (cancelled) return;
          setResults(list);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [authKey, query]);

  return { results, loading };
}

/** Presence for a stable set of userIds. Polls every 12s so "online"
 *  toggles within a heartbeat. Returns a Map keyed by userId. */
export function usePresenceLookup(userIds: string[]): Map<string, PresenceRecord> {
  const { authKey } = useAuth();
  const [map, setMap] = useState<Map<string, PresenceRecord>>(new Map());
  // Stable key so the effect doesn't re-run on every render when the
  // array reference changes but the contents don't.
  const key = userIds.slice().sort().join(',');

  useEffect(() => {
    if (!authKey || userIds.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    const refresh = () => {
      lookupPresence(authKey, userIds)
        .then((records) => {
          if (cancelled) return;
          const next = new Map<string, PresenceRecord>();
          for (const r of records) next.set(r.userId, r);
          setMap(next);
        })
        .catch(() => {
          // ignore; stale map stays
        });
    };
    refresh();
    const id = window.setInterval(refresh, PRESENCE_POLL_MS);
    // Refresh the moment the user returns to the tab / focuses the window, so
    // presence is current when they go to send an invite (no waiting for the
    // next poll tick, no "refresh the page 50 times").
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authKey, key]);

  return map;
}
