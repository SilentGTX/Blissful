// Stubbed user-search + presence-lookup hooks.
// The desktop app does not have a live social backend, so these
// return empty results. The hooks keep their signatures so the
// Friends UI compiles.

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthProvider';
import {
  lookupPresence,
  searchUsers,
  type PresenceRecord,
  type UserSearchResult,
} from './blissfulAuthApi';

const PRESENCE_POLL_MS = 30 * 1000;

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

/** Presence for a stable set of userIds. Polls every 30s so "online"
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
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authKey, key]);

  return map;
}
