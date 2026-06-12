// Trakt device-code OAuth client for the RN TV app. Mirrors the subset of
// apps/blissful-mvs/src/lib/traktApi.ts that SettingsTraktPanel uses:
// requestDeviceCode -> pollDeviceToken (until authorized) -> token storage ->
// getTraktUser / disconnectTrakt.
//
// Everything is gated on isTraktConfigured() — with empty creds (the default)
// every call returns a no-op so the panel is fully inert. Trakt requests route
// through the blissful-storage backend's /trakt proxy (getStorageBaseUrl()),
// matching the web app's ${PROXY_BASE}/trakt routing; a /trakt backend route
// must exist for a real (configured) connection to work.
//
// DECISION: persist the Trakt token + cached user to MMKV (kv) rather than the
// web localStorage — the RN platform rule forbids touching localStorage
// directly. Same bliss* key prefix convention as the rest of the app.
import { getStorageBaseUrl } from '@blissful/core';
import { kv } from './storage';
import { TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET, isTraktConfigured } from './traktConfig';

const TOKEN_KEY = 'bliss:traktToken';
const USER_KEY = 'bliss:traktUser';

const TRAKT_BASE = `${getStorageBaseUrl()}/trakt`;

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
};

export type TraktUser = {
  username: string | null;
  name: string | null;
};

type StoredToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
};

export type PollStatus =
  | 'authorized'
  | 'pending'
  | 'slow_down'
  | 'expired'
  | 'denied'
  | 'used'
  | 'invalid'
  | 'error';

function readToken(): StoredToken | null {
  try {
    const raw = kv.get(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

function writeToken(token: StoredToken): void {
  try {
    kv.set(TOKEN_KEY, JSON.stringify(token));
  } catch {
    // best-effort
  }
}

export function isTraktConnected(): boolean {
  if (!isTraktConfigured()) return false;
  return readToken() !== null;
}

export function disconnectTrakt(): void {
  kv.remove(TOKEN_KEY);
  kv.remove(USER_KEY);
}

// Step 1: ask Trakt for a device code. Returns null on any failure (the panel
// surfaces a "check your API keys" error).
export async function requestDeviceCode(): Promise<DeviceCode | null> {
  if (!isTraktConfigured()) return null;
  try {
    const res = await fetch(`${TRAKT_BASE}/oauth/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: TRAKT_CLIENT_ID }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<DeviceCode>;
    if (!json.device_code || !json.user_code || !json.verification_url) return null;
    return {
      device_code: json.device_code,
      user_code: json.user_code,
      verification_url: json.verification_url,
      expires_in: json.expires_in ?? 600,
      interval: json.interval ?? 5,
    };
  } catch {
    return null;
  }
}

// Step 2/3: poll the device-code token endpoint once. The panel re-arms a
// timer per `interval` based on the returned status. On 'authorized' the token
// is persisted here so isTraktConnected() flips true immediately.
export async function pollDeviceToken(deviceCode: string): Promise<{ status: PollStatus }> {
  if (!isTraktConfigured()) return { status: 'invalid' };
  try {
    const res = await fetch(`${TRAKT_BASE}/oauth/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: deviceCode,
        client_id: TRAKT_CLIENT_ID,
        client_secret: TRAKT_CLIENT_SECRET,
      }),
    });
    if (res.status === 200) {
      const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (json.access_token && json.refresh_token) {
        writeToken({
          access_token: json.access_token,
          refresh_token: json.refresh_token,
          expires_at: Date.now() + (json.expires_in ?? 7776000) * 1000,
        });
        return { status: 'authorized' };
      }
      return { status: 'error' };
    }
    // Trakt's documented device-token status codes.
    switch (res.status) {
      case 400:
        return { status: 'pending' };
      case 404:
        return { status: 'invalid' };
      case 409:
        return { status: 'used' };
      case 410:
        return { status: 'expired' };
      case 418:
        return { status: 'denied' };
      case 429:
        return { status: 'slow_down' };
      default:
        return { status: 'error' };
    }
  } catch {
    return { status: 'error' };
  }
}

// The connected user's display label, cached in MMKV so the panel doesn't
// re-hit the network on every mount. Returns null when not connected.
export async function getTraktUser(): Promise<TraktUser | null> {
  if (!isTraktConnected()) return null;
  const cached = kv.get(USER_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as TraktUser;
    } catch {
      // fall through to refetch
    }
  }
  const token = readToken();
  if (!token) return null;
  try {
    const res = await fetch(`${TRAKT_BASE}/users/settings`, {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token.access_token}`,
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_CLIENT_ID,
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { user?: { username?: string; name?: string } };
    const user: TraktUser = {
      username: json.user?.username ?? null,
      name: json.user?.name ?? null,
    };
    try {
      kv.set(USER_KEY, JSON.stringify(user));
    } catch {
      // best-effort cache
    }
    return user;
  } catch {
    return null;
  }
}
