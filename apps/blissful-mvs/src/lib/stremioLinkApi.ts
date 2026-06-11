// Client for the blissful-storage /stremio/* endpoints. Backs the
// "Linked Accounts → Stremio" panel in Settings: link with the user's
// official Stremio credentials, then a server-side cron mirrors their
// Stremio library ↔ Blissful's library every 15 min (two-way, newest
// _mtime wins). See apps/blissful-storage/server.js for the sync impl.

import { STORAGE_URL } from './storageBaseUrl';

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
  const res = await fetch(`${STORAGE_URL}${path}`, {
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
      /* response wasn't JSON — keep the generic message */
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

// Browser-direct exchange of Stremio credentials → authKey. Used both by
// the popup (email/password fallback) and the Settings panel (after FB
// flow returns an fbLoginToken). Never goes through Blissful's server.
const STREMIO_API_LOGIN = 'https://api.strem.io/api/login';

export async function exchangeStremioCredentialsForAuthKey(args: {
  email: string;
  /** Plain password for email/password flow, or fbLoginToken when facebook=true. */
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

// Used by the /stremio-link popup after it logs the user into Stremio
// directly from the browser. Posts only the resulting authKey (+ email
// for display) to blissful-storage; the password never reaches us.
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

export async function syncStremioItem(
  token: string,
  id: string,
): Promise<StremioSyncResult> {
  return request<StremioSyncResult>('/stremio/sync-item', token, {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

// In-memory cooldown for the event-driven triggers (player open/close,
// home-page load). Module-level Map keyed by 'all' (full sync) or a
// libraryItem id (per-item sync). If the same key fired more recently
// than the cooldown, we skip — avoids hammering Stremio's API when the
// user rapidly opens/closes the player or bounces around the app.
const lastSyncAt = new Map<string, number>();

export function maybeRunSyncCooldown(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const last = lastSyncAt.get(key) ?? 0;
  if (now - last < cooldownMs) return false;
  lastSyncAt.set(key, now);
  return true;
}

// Session cache: has this user linked a Stremio account? null = unknown.
// The fire-and-forget triggers below gate on it so they never POST
// /stremio/sync(-item) for an unlinked user — those endpoints 400 with
// "Stremio account not linked", which otherwise surfaced as a console error
// on every home-page load. Resolved lazily via /stremio/status (which 200s
// with { linked }, never 400s) and kept fresh by setStremioLinked() from the
// Settings panel after a link / unlink / status refresh.
let stremioLinkedFlag: boolean | null = null;

/** Update the cached linked state. The Settings panel calls this whenever it
 *  learns the real status (initial load, link, unlink, manual sync). */
export function setStremioLinked(linked: boolean): void {
  stremioLinkedFlag = linked;
}

/** True only when the user has a linked Stremio account. Resolves the cache
 *  once per session via /stremio/status; on any failure returns false — treat
 *  unknown as "don't sync", the 15-min server cron heals linked users. */
export async function isStremioLinked(token: string): Promise<boolean> {
  if (stremioLinkedFlag !== null) return stremioLinkedFlag;
  try {
    const status = await fetchStremioLinkStatus(token);
    stremioLinkedFlag = status.linked;
    return status.linked;
  } catch {
    return false;
  }
}

// Fire-and-forget helpers — swallow errors so callers can wire these
// into useEffect mount/unmount without try/catch boilerplate. The
// 15-min cron heals anything that fails here. Both no-op for unlinked
// users (gated on stremioLinkedFlag) so they never hit the 400-on-not-linked.
export function triggerStremioItemSync(token: string | null, id: string | null): void {
  if (!token || !id) return;
  if (stremioLinkedFlag === false) return;
  if (!maybeRunSyncCooldown(`item:${id}`, 10_000)) return;
  void (async () => {
    if (!(await isStremioLinked(token))) return;
    await syncStremioItem(token, id);
  })().catch(() => { /* cron will heal */ });
}

export function triggerStremioFullSync(token: string | null): void {
  if (!token) return;
  if (stremioLinkedFlag === false) return;
  if (!maybeRunSyncCooldown('all', 60_000)) return;
  void (async () => {
    if (!(await isStremioLinked(token))) return;
    await syncStremioNow(token);
  })().catch(() => { /* cron will heal */ });
}
