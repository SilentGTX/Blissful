// RN client for the blissful-storage /stremio/* endpoints. Backs the
// "Linked Accounts -> Stremio" panel in SettingsScreen. Ported 1:1 from
// apps/blissful-mvs/src/lib/stremioLinkApi.ts — the only difference is the
// base URL comes from @blissful/core's getStorageBaseUrl() (the RN app hits
// the real backend directly, no proxy/CORS) instead of the web app's
// same-origin STORAGE_URL.
//
// Linking flow (TV-friendly, no popup): the user types their Stremio
// email/password into D-pad TvTextField inputs; the credentials go
// browser-direct to api.strem.io/api/login via
// exchangeStremioCredentialsForAuthKey — the password NEVER reaches the
// Blissful backend. Only the resulting authKey is posted to /stremio/link-token.
// A server-side cron then mirrors the Stremio library <-> Blissful library
// every 15 min so progress + per-episode watched show up here.
import { getStorageBaseUrl } from '@blissful/core';

export type StremioLinkStatus = {
  linked: boolean;
  email: string | null;
  linkedAt: number | null;
  lastSyncAt: number | null;
  lastSyncError: string | null;
};

export type StremioLinkResult = {
  ok: true;
  stremioEmail: string;
  pulled: number;
  pushed: number;
};

export type StremioSyncResult = {
  ok: true;
  pulled: number;
  pushed: number;
};

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getStorageBaseUrl()}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Stremio API ${path} failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchStremioLinkStatus(token: string): Promise<StremioLinkStatus> {
  return request<StremioLinkStatus>('/stremio/status', token);
}

export async function unlinkStremioAccount(token: string): Promise<void> {
  await request<{ ok: true }>('/stremio/unlink', token, { method: 'POST' });
}

// Browser-direct exchange of Stremio credentials -> authKey. Never goes
// through Blissful's server.
const STREMIO_API_LOGIN = 'https://api.strem.io/api/login';

export async function exchangeStremioCredentialsForAuthKey(args: {
  email: string;
  password: string;
  facebook: boolean;
}): Promise<{ authKey: string; email: string }> {
  const res = await fetch(STREMIO_API_LOGIN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const json = (await res.json().catch(() => null)) as
    | { result?: { authKey?: string; user?: { email?: string } }; error?: { message?: string } }
    | null;
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message ?? `Stremio login failed (HTTP ${res.status})`);
  }
  const authKey = json?.result?.authKey;
  if (typeof authKey !== 'string' || !authKey) {
    throw new Error('Stremio did not return a session token.');
  }
  return { authKey, email: json?.result?.user?.email ?? args.email };
}

// Posts only the resulting authKey (+ email for display) to blissful-storage;
// the password never reaches us.
export async function linkStremioWithToken(
  token: string,
  args: { authKey: string; email: string },
): Promise<StremioLinkResult> {
  return request<StremioLinkResult>('/stremio/link-token', token, {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

export async function syncStremioNow(token: string): Promise<StremioSyncResult> {
  return request<StremioSyncResult>('/stremio/sync', token, { method: 'POST' });
}
