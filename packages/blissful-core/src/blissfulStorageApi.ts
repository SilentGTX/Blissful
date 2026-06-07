// Read-only access to the blissful-storage server's per-user state + settings —
// the source of truth for which addons a user has installed and their
// Real-Debrid key. Ported from apps/blissful-mvs/src/lib/storageApi.ts (the full
// desktop version also writes state/settings; the TV client only reads).
//
// Auth: `authorization: Bearer <token>` where token is the native JWT
// (useAuth().token on RN). Endpoints hang off getStorageBaseUrl()
// (https://blissful.budinoff.com/storage by default; direct on RN, no CORS).
import { getStorageBaseUrl } from './adapters';

// Only the fields the TV client consumes. The server returns more (theme,
// gradients, profile, homeRowPrefs, …) which we ignore.
export type BlissfulStoredState = {
  addons?: string[];
  playerSettings?: BlissfulStoredPlayerSettings;
};

export type BlissfulStoredPlayerSettings = {
  /** Real-Debrid API key; when set, a Torrentio RD addon is injected so torrent
   *  streams resolve to ready HTTP urls. Empty string / undefined = disabled. */
  realDebridApiKey?: string;
};

async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${getStorageBaseUrl()}${path}`, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`Storage ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

/** The user's stored UI/library state (we read `addons`). Returns null on any
 *  failure (signed out, 401, network) so callers fall back to defaults. */
export async function fetchStoredState(token: string | null): Promise<BlissfulStoredState | null> {
  if (!token) return null;
  try {
    const result = await getJson<{ state: BlissfulStoredState | null }>('/state', token);
    return result.state ?? null;
  } catch {
    return null;
  }
}

/** The user's player settings (we read `realDebridApiKey`). Null on any failure. */
export async function fetchStoredSettings(
  token: string | null,
): Promise<BlissfulStoredPlayerSettings | null> {
  if (!token) return null;
  try {
    const result = await getJson<{ playerSettings: BlissfulStoredPlayerSettings | null }>(
      '/settings',
      token,
    );
    return result.playerSettings ?? null;
  } catch {
    return null;
  }
}
