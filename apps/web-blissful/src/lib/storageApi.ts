import type { HomeRowPrefs } from './homeRows';
import type { PlayerSettings } from './playerSettings';
import { STORAGE_URL } from './storageBaseUrl';

export type StoredProfile = {
  displayName?: string;
  avatar?: string;
};

export type BlissfulStorageState = {
  theme?: 'dark' | 'light';
  homeRowPrefs?: HomeRowPrefs;
  playerSettings?: PlayerSettings;
  addons?: string[];
  darkGradient?: string;
  lightGradient?: string;
  uiStyle?: 'classic' | 'netflix' | 'modern';
  profile?: StoredProfile;
};

// Per-key rejection cache. Once the storage server returns 401 for a
// given auth key (Stremio account that hasn't been registered with our
// blissful-storage backend), every subsequent call would also get 401
// — and each one logs a network error to DevTools that our caller's
// try/catch can't suppress. Tracking the rejected key locally lets us
// short-circuit those calls and keep the console clean. The set is
// cleared when the auth key changes (e.g., user logs into a different
// account), giving the new key a fresh chance.
const rejectedAuthKeys = new Set<string>();

export function clearStorageAuthRejection(authKey?: string): void {
  if (authKey) rejectedAuthKeys.delete(authKey);
  else rejectedAuthKeys.clear();
}

async function request<T>(
  path: string,
  authKey: string,
  options?: RequestInit
): Promise<T> {
  // Short-circuit when not authenticated, or when we've already seen a
  // 401 for this key. Either case is unrecoverable until the user logs
  // in (or logs in elsewhere); silently throwing keeps the console
  // clean — callers already treat throws as "fall back to localStorage".
  if (!authKey) {
    throw new Error('Storage API: no auth key (signed out)');
  }
  if (rejectedAuthKeys.has(authKey)) {
    throw new Error('Storage API: auth key not registered with storage backend');
  }
  const res = await fetch(`${STORAGE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${authKey}`,
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      rejectedAuthKeys.add(authKey);
    }
    throw new Error(`Storage API ${path} failed (${res.status})`);
  }

  return (await res.json()) as T;
}

export async function fetchStoredState(authKey: string): Promise<BlissfulStorageState | null> {
  try {
    const result = await request<{ state: BlissfulStorageState | null }>('/state', authKey);
    return result.state ?? null;
  } catch {
    return null;
  }
}

export async function saveStoredState(authKey: string, state: BlissfulStorageState): Promise<void> {
  await request('/state', authKey, {
    method: 'POST',
    body: JSON.stringify({ state }),
  });
}

export async function fetchStoredSettings(authKey: string): Promise<PlayerSettings | null> {
  try {
    const result = await request<{ playerSettings: PlayerSettings | null }>('/settings', authKey);
    return result.playerSettings ?? null;
  } catch {
    return null;
  }
}

export async function fetchHomeState(authKey: string): Promise<{
  homeRowPrefs: HomeRowPrefs | null;
  addons: string[] | null;
} | null> {
  try {
    const result = await request<{ homeRowPrefs: HomeRowPrefs | null; addons: string[] | null }>(
      '/home',
      authKey
    );
    return {
      homeRowPrefs: result.homeRowPrefs ?? null,
      addons: result.addons ?? null,
    };
  } catch {
    return null;
  }
}
