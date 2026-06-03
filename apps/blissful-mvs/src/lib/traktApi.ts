// Client-side Trakt.tv integration for Blissful.
//
// DESIGN (locked decisions — see project memory):
//
// 1. PROXY, never call api.trakt.tv from the browser directly. Trakt's API
//    does not reliably allow browser CORS, and Blissful's locked rule is
//    "same-origin proxy mandatory." This mirrors src/lib/storageBaseUrl.ts:
//      - Tauri (Android TV): `${PROXY_BASE}/trakt` -> the loopback Rust proxy.
//      - Browser / desktop:  '/trakt' (relative), proxied by the Vite dev
//        server (see vite.config.ts server.proxy '/trakt') to api.trakt.tv.
//    All fetches hit `${TRAKT_BASE}/<path>` where <path> is the bare Trakt
//    route (e.g. '/oauth/device/code').
//
//    NOTE for non-browser production builds: the Tauri proxy
//    (src-tauri/src/proxy.rs) and the Windows shell (apps/blissful-shell/
//    src/ui_server.rs) would EACH need a '/trakt' -> https://api.trakt.tv
//    route added (Rust — out of scope here, can't compile from this app).
//    The browser ?tv=1 test path works today via the Vite dev proxy.
//
// 2. Everything is gated on isTraktConfigured(). When the credentials in
//    traktConfig.ts are blank, every exported function no-ops / returns null
//    and NEVER throws — the feature is fully inert until configured.
//
// 3. TV-friendly OAuth: the device-code flow (no popup, no redirect).
//
// 4. Trakt headers on EVERY call + a 1 POST/sec throttle (Trakt's documented
//    POST rate limit). The shared post()/get() helpers enforce both.

import { PROXY_BASE } from './proxyBase';
import { isTauri } from './platform';
import {
  TRAKT_CLIENT_ID,
  TRAKT_CLIENT_SECRET,
  isTraktConfigured,
} from './traktConfig';

// --------------------------------------------------------------------------
// Base URL (proxied — see decision #1)
// --------------------------------------------------------------------------

/**
 * Same-origin-style base for Trakt. Tauri -> loopback Rust proxy; browser /
 * desktop -> relative '/trakt' proxied by Vite (dev) / the shell (prod).
 */
export const TRAKT_BASE = isTauri() ? `${PROXY_BASE}/trakt` : '/trakt';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** POST /oauth/device/code response. */
export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_url: string;
  /** Seconds between token polls. */
  interval: number;
  /** Seconds until the device_code expires. */
  expires_in: number;
};

/** A Trakt OAuth token set as Trakt returns it. */
export type TraktTokenResponse = {
  access_token: string;
  refresh_token: string;
  /** Seconds the access_token is valid for. */
  expires_in: number;
  /** Unix seconds the token was created. */
  created_at: number;
  token_type?: string;
  scope?: string;
};

/** What we persist to localStorage. */
export type StoredTraktToken = {
  access_token: string;
  refresh_token: string;
  /** Absolute expiry in ms (epoch). */
  expires_at: number;
};

/** Result of one device-token poll. */
export type DeviceTokenPoll =
  | { status: 'authorized'; token: StoredTraktToken }
  /** 400 — user hasn't entered the code yet; keep polling. */
  | { status: 'pending' }
  /** 404 — device_code not found / invalid. Stop. */
  | { status: 'invalid' }
  /** 409 — code already approved/used. Stop. */
  | { status: 'used' }
  /** 410 — device_code expired. Stop, restart the flow. */
  | { status: 'expired' }
  /** 418 — user denied the request. Stop. */
  | { status: 'denied' }
  /** 429 — polling too fast; back off (caller should widen its interval). */
  | { status: 'slow_down' }
  /** Network / unexpected error — caller may retry. */
  | { status: 'error'; message: string };

/** Minimal shape of GET /users/settings we care about (display name). */
export type TraktUser = {
  name: string | null;
  username: string | null;
};

/** Scrobble actions. */
export type ScrobbleAction = 'start' | 'pause' | 'stop';

/** Player-supplied content identity for scrobble / sync. */
export type TraktContentRef = {
  /** Stremio content type. */
  type: string;
  /** Top-level id (imdb for movies, show imdb for series). */
  id: string;
  /** Player videoId: 'tt...' for movies, 'imdb:season:episode' for series. */
  videoId: string;
};

/** A Trakt scrobble/sync content payload built from a TraktContentRef. */
type TraktMediaPayload =
  | { movie: { ids: { imdb: string } } }
  | { show: { ids: { imdb: string } }; episode: { season: number; number: number } };

// --------------------------------------------------------------------------
// Token storage (localStorage key 'bliss:trakt')
// --------------------------------------------------------------------------

const TOKEN_STORAGE_KEY = 'bliss:trakt';

/** Refresh proactively when within this window of expiry (~1 day). */
const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

export function loadStoredToken(): StoredTraktToken | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTraktToken>;
    if (
      typeof parsed?.access_token === 'string' &&
      typeof parsed?.refresh_token === 'string' &&
      typeof parsed?.expires_at === 'number'
    ) {
      return {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_at: parsed.expires_at,
      };
    }
  } catch {
    /* corrupt entry — treat as not connected */
  }
  return null;
}

export function saveStoredToken(token: StoredTraktToken): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
  } catch {
    /* storage full / blocked — non-fatal */
  }
}

/** Persist a fresh Trakt token response, computing absolute expiry. */
export function persistTokenResponse(res: TraktTokenResponse): StoredTraktToken {
  const stored: StoredTraktToken = {
    access_token: res.access_token,
    refresh_token: res.refresh_token,
    // created_at is unix seconds; expires_in is seconds.
    expires_at: (res.created_at + res.expires_in) * 1000,
  };
  saveStoredToken(stored);
  return stored;
}

export function clearStoredToken(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

/** True when configured AND we hold a (possibly soon-to-refresh) token. */
export function isTraktConnected(): boolean {
  return isTraktConfigured() && loadStoredToken() !== null;
}

// --------------------------------------------------------------------------
// Shared low-level fetch helpers (headers + throttle + error swallowing)
// --------------------------------------------------------------------------

function baseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': TRAKT_CLIENT_ID,
  };
}

// Trakt limits POSTs to ~1/sec. Serialise POSTs through a promise chain and
// space them at least MIN_POST_GAP_MS apart so we never trip the 429 limiter.
const MIN_POST_GAP_MS = 1000;
let lastPostAt = 0;
let postChain: Promise<void> = Promise.resolve();

function throttlePost(): Promise<void> {
  // Append to the chain so concurrent callers serialise rather than racing.
  const wait = postChain.then(async () => {
    const now = Date.now();
    const gap = now - lastPostAt;
    if (gap < MIN_POST_GAP_MS) {
      await new Promise((r) => setTimeout(r, MIN_POST_GAP_MS - gap));
    }
    lastPostAt = Date.now();
  });
  // Swallow rejections on the chain itself so one failure doesn't poison the
  // next caller's wait.
  postChain = wait.catch(() => undefined);
  return wait;
}

/**
 * Low-level POST. Returns the parsed Response so OAuth callers can inspect
 * status codes (the device-token poll needs 400/404/409/410/418/429). Honours
 * the 1 POST/sec throttle. Never used when not configured (callers guard).
 *
 * @param auth optional bearer token to attach (authed endpoints).
 */
async function rawPost(
  path: string,
  body: unknown,
  auth?: string | null,
): Promise<Response> {
  await throttlePost();
  const headers = baseHeaders();
  if (auth) headers.Authorization = `Bearer ${auth}`;
  return fetch(`${TRAKT_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * High-level authed POST that parses JSON and swallows errors. Returns the
 * parsed body on 2xx, or null on any non-2xx / network / parse failure so
 * callers (scrobble, sync) never crash playback.
 */
async function post<T>(
  path: string,
  body: unknown,
  auth?: string | null,
): Promise<T | null> {
  if (!isTraktConfigured()) return null;
  try {
    const res = await rawPost(path, body, auth);
    if (!res.ok) return null;
    // Some endpoints (204) have no body.
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    return null;
  }
}

/**
 * High-level authed GET that parses JSON and swallows errors. Returns null on
 * any failure.
 */
async function get<T>(path: string, auth?: string | null): Promise<T | null> {
  if (!isTraktConfigured()) return null;
  try {
    const headers = baseHeaders();
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const res = await fetch(`${TRAKT_BASE}${path}`, { method: 'GET', headers });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Device OAuth flow (decision #3)
// --------------------------------------------------------------------------

/**
 * Step 1: ask Trakt for a device code. Returns null when not configured or on
 * any error (caller shows a generic failure).
 */
export async function requestDeviceCode(): Promise<DeviceCode | null> {
  if (!isTraktConfigured()) return null;
  try {
    const res = await rawPost('/oauth/device/code', {
      client_id: TRAKT_CLIENT_ID,
    });
    if (!res.ok) return null;
    return (await res.json()) as DeviceCode;
  } catch {
    return null;
  }
}

/**
 * Step 2: poll once for the token. Map Trakt's documented poll HTTP codes to
 * a typed status the caller's poll loop can switch on:
 *   200 -> authorized   400 -> pending      404 -> invalid
 *   409 -> used         410 -> expired      418 -> denied      429 -> slow_down
 *
 * On 'authorized' the token is already persisted to localStorage.
 */
export async function pollDeviceToken(deviceCode: string): Promise<DeviceTokenPoll> {
  if (!isTraktConfigured()) return { status: 'invalid' };
  try {
    const res = await rawPost('/oauth/device/token', {
      code: deviceCode,
      client_id: TRAKT_CLIENT_ID,
      client_secret: TRAKT_CLIENT_SECRET,
    });
    if (res.ok) {
      const json = (await res.json()) as TraktTokenResponse;
      return { status: 'authorized', token: persistTokenResponse(json) };
    }
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
        return { status: 'error', message: `Unexpected status ${res.status}` };
    }
  } catch (err: unknown) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }
}

// --------------------------------------------------------------------------
// Token refresh + valid-token accessor (decision #5)
// --------------------------------------------------------------------------

/**
 * Exchange the refresh_token for a new token set. Persists on success.
 * Returns null on failure (caller may then disconnect / re-link).
 */
export async function refreshAccessToken(): Promise<StoredTraktToken | null> {
  if (!isTraktConfigured()) return null;
  const stored = loadStoredToken();
  if (!stored) return null;
  try {
    const res = await rawPost('/oauth/token', {
      refresh_token: stored.refresh_token,
      client_id: TRAKT_CLIENT_ID,
      client_secret: TRAKT_CLIENT_SECRET,
      grant_type: 'refresh_token',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TraktTokenResponse;
    return persistTokenResponse(json);
  } catch {
    return null;
  }
}

/**
 * Return a usable access token, refreshing proactively when within
 * REFRESH_WINDOW_MS of expiry. Returns null when not configured, not
 * connected, or the refresh failed.
 */
export async function getValidAccessToken(): Promise<string | null> {
  if (!isTraktConfigured()) return null;
  const stored = loadStoredToken();
  if (!stored) return null;
  if (stored.expires_at - Date.now() > REFRESH_WINDOW_MS) {
    return stored.access_token;
  }
  const refreshed = await refreshAccessToken();
  return refreshed?.access_token ?? stored.access_token;
}

/** Disconnect: drop the stored token. (Trakt has no server-side revoke for
 * device tokens that we need here; clearing locally is sufficient.) */
export function disconnectTrakt(): void {
  clearStoredToken();
}

// --------------------------------------------------------------------------
// Connected user (for the Settings panel display name)
// --------------------------------------------------------------------------

/** Raw GET /users/settings shape (only the bits we read). */
type TraktSettingsResponse = {
  user?: {
    name?: string | null;
    username?: string | null;
  };
};

/**
 * GET /users/settings — used by the Settings panel to show who's connected.
 * Returns null when not configured / not connected / on error.
 */
export async function getTraktUser(): Promise<TraktUser | null> {
  if (!isTraktConfigured()) return null;
  const token = await getValidAccessToken();
  if (!token) return null;
  const data = await get<TraktSettingsResponse>('/users/settings', token);
  if (!data) return null;
  return {
    name: data.user?.name ?? null,
    username: data.user?.username ?? null,
  };
}

// --------------------------------------------------------------------------
// Content payload helper (decision #6)
// --------------------------------------------------------------------------

/**
 * Build a Trakt media payload from the player's content identity.
 *   - movie  -> { movie: { ids: { imdb } } }
 *   - series -> { show: { ids: { imdb } }, episode: { season, number } }
 * The series videoId is 'imdb:season:episode' (parts[0]=imdb,
 * parts[1]=season, parts[2]=episode). Returns null for non-imdb ids or
 * malformed videoIds so callers skip the scrobble rather than send garbage.
 */
export function buildMediaPayload(ref: TraktContentRef): TraktMediaPayload | null {
  const { type, id, videoId } = ref;
  if (type === 'movie') {
    const imdb = id || videoId;
    if (!imdb.startsWith('tt')) return null;
    return { movie: { ids: { imdb } } };
  }
  // Treat anything non-movie with an episode-shaped videoId as a series.
  const parts = videoId.split(':');
  if (parts.length < 3) return null;
  const imdb = parts[0];
  const season = Number(parts[1]);
  const number = Number(parts[2]);
  if (!imdb.startsWith('tt') || !Number.isFinite(season) || !Number.isFinite(number)) {
    return null;
  }
  return { show: { ids: { imdb } }, episode: { season, number } };
}

// --------------------------------------------------------------------------
// Scrobble (decision #6)
// --------------------------------------------------------------------------

/**
 * POST /scrobble/{start,pause,stop} with { progress, ...content }.
 * progress is 0-100. /scrobble/stop with progress >= 80 marks watched on
 * Trakt's side automatically. No-op (returns null) when not configured, not
 * connected, or the content ref can't be resolved to imdb ids. Never throws.
 */
export async function scrobble(
  action: ScrobbleAction,
  content: TraktContentRef & { progress: number },
): Promise<unknown | null> {
  if (!isTraktConfigured()) return null;
  const token = await getValidAccessToken();
  if (!token) return null;
  const media = buildMediaPayload(content);
  if (!media) return null;
  const progress = Math.max(0, Math.min(100, content.progress));
  return post(`/scrobble/${action}`, { progress, ...media }, token);
}

// --------------------------------------------------------------------------
// Watchlist sync (decision #6)
// --------------------------------------------------------------------------

/** Wrap a media payload into the { movies } / { shows } sync envelope. */
function watchlistEnvelope(media: TraktMediaPayload): Record<string, unknown> {
  if ('movie' in media) return { movies: [media.movie] };
  return { shows: [media.show] };
}

/**
 * POST /sync/watchlist — add a movie/show to the user's Trakt watchlist.
 * No-op/null when not configured/connected or the ref can't be resolved.
 */
export async function addToWatchlist(ref: TraktContentRef): Promise<unknown | null> {
  if (!isTraktConfigured()) return null;
  const token = await getValidAccessToken();
  if (!token) return null;
  const media = buildMediaPayload(ref);
  if (!media) return null;
  return post('/sync/watchlist', watchlistEnvelope(media), token);
}

/**
 * POST /sync/watchlist/remove — remove a movie/show from the watchlist.
 * No-op/null when not configured/connected or the ref can't be resolved.
 */
export async function removeFromWatchlist(ref: TraktContentRef): Promise<unknown | null> {
  if (!isTraktConfigured()) return null;
  const token = await getValidAccessToken();
  if (!token) return null;
  const media = buildMediaPayload(ref);
  if (!media) return null;
  return post('/sync/watchlist/remove', watchlistEnvelope(media), token);
}
