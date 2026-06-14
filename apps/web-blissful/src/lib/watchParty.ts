// Watch Party — types, protocol, REST client, and helper utilities
// for the synchronized "watch together" sessions backed by
// blissful-storage's WebSocket endpoint. See
// `apps/shared/blissful-storage/server.js` for the server side.
//
// Stream URL is intentionally NOT part of the room. Each client
// resolves their own stream (their addons, their RD account) and we
// sync purely on currentTime + play/pause/seek + episode changes. That
// way a host with 4K Real-Debrid links and a guest on free Videasy
// streams can share the same timeline; quality may differ but
// playback stays in lock-step.

import { STORAGE_URL, STORAGE_WS_URL } from './storageBaseUrl';
import { isNativeShell } from './desktop';

// ---------- Constants ----------------------------------------------------

/** Server's room code alphabet — used by the code input to filter
 *  keystrokes so we don't show characters the server would never
 *  generate (0/o, 1/l/i are excluded for legibility). */
export const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** "xxx-yyy" — 3 + dash + 3. */
export const ROOM_CODE_LENGTH = 7;

const ROOM_CODE_PATTERN = /^[a-hjkmnpqrstuvwxyz23456789]{3}-[a-hjkmnpqrstuvwxyz23456789]{3}$/;

// ---------- Wire types ---------------------------------------------------

export type WatchPartyParticipant = {
  userId: string;
  displayName: string;
  joinedAt: number;
  isHost: boolean;
};

/** Watch-party v2 (docs/WATCH-PARTY-V2.md): a platform-neutral identity for
 *  WHAT is playing, so a desktop (mpv) and a web (`<video>`) guest can resolve
 *  the SAME file instead of each picking its own. `null` = the host hasn't
 *  resolved one yet, or the content is unshareable (a web Vidking embed). */
export type WatchPartySource =
  | { kind: 'torrent'; infoHash: string; fileIdx: number | null; trackers?: string[] }
  | { kind: 'rd'; rdUrl: string; infoHash?: string | null }
  | { kind: 'vidking'; tmdbId: number; mediaType: 'movie' | 'tv'; season?: number; episode?: number }
  | { kind: 'relay'; url: string }
  | null;

export type WatchPartyRoomSnapshot = {
  code: string;
  hostUserId: string;
  type: 'movie' | 'series';
  imdbId: string;
  videoId: string | null;
  /** Host's exact playback URL when it has fallen back to a Real-Debrid stream
   *  (a `/transcode.m3u8?url=…` URL). null when the host is on Vidking (guests
   *  then resolve their own source). Lets a guest load the SAME RD torrent as
   *  the host instead of independently resolving a possibly-different one.
   *  Web-player concept; the desktop's mpv player ignores it. */
  streamUrl?: string | null;
  /** Host's selected subtitle language (canonical label) or null = off, so a
   *  late joiner matches the host's subtitle. */
  subtitleLang?: string | null;
  /** v2: platform-neutral content identity so guests resolve the SAME file
   *  (supersedes `streamUrl` across platforms). See WatchPartySource. */
  source?: WatchPartySource;
  hasPassword: boolean;
  participants: WatchPartyParticipant[];
  lastTick: { currentTime: number; isPlaying: boolean; at: number } | null;
  /** Chat history for the room — seeded into local state on join so
   *  refreshes / late joiners see prior messages. Capped server-side. */
  chat?: WatchPartyChatMessage[];
  /** Reactions per message: { [messageKey]: { [emoji]: userIds[] } }. */
  reactions?: Record<string, Record<string, string[]>>;
};

export type WatchPartyChatMessage = {
  from: { userId: string; displayName: string };
  text: string;
  at: number;
};

// Client -> Server
export type WatchPartyClientMessage =
  | {
      t: 'join';
      code: string;
      displayName: string;
      /** Either `token` (Blissful JWT) OR `guestId` (guest path) is
       *  required — never both, server prefers `token` when both are
       *  sent. */
      token?: string;
      guestId?: string;
      password?: string;
    }
  | { t: 'host:tick'; currentTime: number; isPlaying: boolean }
  | { t: 'host:episode'; videoId: string | null }
  /** Host announces its current Real-Debrid fallback URL (or null when back on
   *  Vidking) so guests can load the same torrent. Web-player concept. */
  | { t: 'host:stream'; streamUrl: string | null }
  /** Host announces its selected subtitle language (canonical label, e.g.
   *  "English") or null for off, so guests match the same subtitle. */
  | { t: 'host:subs'; lang: string | null }
  /** v2: host announces the platform-neutral content identity so guests load
   *  the SAME file across platforms (supersedes `host:stream`). */
  | { t: 'host:source'; source: WatchPartySource }
  /** Layer B: a guest asks the (desktop) host to relay its exact stream. Server
   *  stamps `from` and routes to the host only. Acceptance is just the host
   *  announcing a `relay` source (host:source) — guests swap to it. */
  | { t: 'party:request-host-stream' }
  /** Layer B: the host declines a specific guest's request; server routes the
   *  rejection to that guest so it keeps its own fallback. */
  | { t: 'party:decline-host-stream'; targetUserId: string }
  | { t: 'host:transfer'; targetUserId: string }
  /** Anyone in the room can broadcast a discrete play/pause/seek —
   *  the server stamps `from` on the relay so clients can attribute
   *  the action in the UI. */
  | { t: 'event'; kind: 'play' | 'pause' | 'seek'; currentTime: number }
  /** Readiness for the "buffer until everybody loads" gate: a member reports
   *  it's buffering (true) or ready (false). The server gates play until no one
   *  is buffering. */
  | { t: 'buffering'; waiting: boolean }
  /** Lightweight "I'm typing in chat" ping; server relays it with
   *  `from` to other participants. Send debounced (~3s). */
  | { t: 'typing' }
  | { t: 'chat'; text: string }
  | { t: 'chat:react'; messageKey: string; emoji: string; kind: 'add' | 'remove' }
  | { t: 'leave' };

// Server -> Client
export type WatchPartyServerMessage =
  | ({ t: 'room'; self: { userId: string; displayName: string } } & WatchPartyRoomSnapshot)
  | { t: 'presence'; kind: 'joined' | 'left'; userId: string; displayName: string }
  | { t: 'presence'; kind: 'host-changed'; userId: string; displayName: string; hostUserId: string }
  | { t: 'tick'; currentTime: number; isPlaying: boolean; sentAt: number }
  | {
      t: 'event';
      kind: 'play' | 'pause' | 'seek';
      currentTime: number;
      sentAt: number;
      from: { userId: string; displayName: string };
    }
  | { t: 'episode'; videoId: string | null }
  /** Relay of the host's Real-Debrid fallback URL (or null) — guests load it. */
  | { t: 'stream'; streamUrl: string | null }
  /** Relay of the host's subtitle language (or null = off) — guests match it. */
  | { t: 'subs'; lang: string | null }
  /** v2 relay of the host's content identity — guests resolve the same file. */
  | { t: 'source'; source: WatchPartySource }
  /** Layer B: delivered to the HOST — a guest wants the host's stream relayed. */
  | { t: 'party:host-stream-request'; from: { userId: string; displayName: string } }
  /** Layer B: delivered to the requesting GUEST — the host declined the request. */
  | { t: 'party:host-stream-declined' }
  /** The "buffer until everybody loads" gate: true = at least one member is
   *  still buffering, so everyone should hold; false = all ready, resume. */
  | { t: 'gate'; waiting: boolean }
  | { t: 'typing'; from: { userId: string; displayName: string } }
  | ({ t: 'chat' } & WatchPartyChatMessage)
  | {
      t: 'reaction';
      messageKey: string;
      emoji: string;
      kind: 'add' | 'remove';
      from: { userId: string; displayName: string };
    }
  | { t: 'error'; code: string; message: string };

// ---------- Player URL builder (meta-enriched) ---------------------------
//
// When the user joins a room (via the sidebar modal or the in-player
// Join tab) we navigate to /player with `url=vidking:placeholder` so
// PlayerPage can resolve a fresh stream for *this* account. The URL
// also needs poster / background / logo / metaTitle params so the
// AppShell-level buffering screen and the player UI surface the
// title's branding instead of falling back to a "Buffering" text
// circle. This helper fetches Cinemeta meta and writes those into
// the URL — same pattern DetailPage uses on regular play.

import { fetchMeta } from './stremioAddon';
import { normalizeStremioImage } from './mediaTypes';
import type { MediaType } from '../types/media';

export type WatchPartyRoomTarget = {
  code: string;
  type: 'movie' | 'series';
  imdbId: string;
  videoId?: string | null;
  /** Host's RD fallback URL, when the room already has one — the web player
   *  joins straight onto it instead of vidking:placeholder. */
  streamUrl?: string | null;
};

export async function buildRoomPlayerUrl(room: WatchPartyRoomTarget): Promise<string> {
  const params = new URLSearchParams();
  params.set('type', room.type);
  params.set('id', room.imdbId);

  if (isNativeShell()) {
    // Desktop: look up the last stream we played for this content.
    // If found, play it directly. If not, route to the detail page so
    // the user picks a torrent — the room code carries through.
    const { getLastStreamSelection } = await import('./streamHistory');
    const stored = getLastStreamSelection({
      authKey: null,
      type: room.type,
      id: room.imdbId,
      videoId: room.videoId ?? null,
    });

    if (!stored?.url) {
      // No stored stream — send to detail page to pick a torrent.
      // The room code passes through so after picking, the player
      // joins the party automatically.
      const qs = new URLSearchParams();
      if (room.videoId) qs.set('videoId', room.videoId);
      qs.set('autoplay', '1');
      qs.set('room', room.code);
      return `/detail/${encodeURIComponent(room.type)}/${encodeURIComponent(room.imdbId)}?${qs.toString()}`;
    }

    if (room.videoId) params.set('videoId', room.videoId);
    params.set('url', stored.url);
    if (stored.title) params.set('title', stored.title);
  } else {
    // Web: fetch the room's LIVE state so we join straight onto the host's
    // current stream + episode — the cached ActiveParty data the caller has
    // may be stale, and crucially it lacks streamUrl. Without this, a guest
    // joining an RD party first loads vidking:placeholder, tries Vidking, and
    // flashes "Vidking unavailable" before the WS sync swaps it. Best-effort.
    let streamUrl = room.streamUrl ?? null;
    let videoId = room.videoId ?? null;
    try {
      const live = await getWatchPartyRoom(room.code);
      if (live) {
        streamUrl = live.streamUrl ?? streamUrl;
        videoId = live.videoId ?? videoId;
      }
    } catch { /* keep the passed-in values */ }
    if (videoId) params.set('videoId', videoId);
    // If the host is already on an RD fallback, join straight onto that exact
    // stream (rdsel=1 skips the guest's own Vidking resolution); otherwise use
    // the placeholder so the guest resolves the same Vidking source the host
    // has.
    if (streamUrl) {
      params.set('url', streamUrl);
      params.set('rdsel', '1');
    } else {
      params.set('url', 'vidking:placeholder');
    }
  }
  params.set('room', room.code);

  // Cinemeta lookup is best-effort: a flaky network shouldn't block
  // the user from joining the party. On failure we just navigate
  // without the meta params (player loads its own meta async).
  try {
    const result = await fetchMeta({ type: room.type as MediaType, id: room.imdbId });
    const meta = result?.meta;
    if (meta) {
      const poster = normalizeStremioImage(meta.poster ?? null);
      const background = normalizeStremioImage(meta.background ?? null) ?? poster;
      if (poster) params.set('poster', poster);
      if (background) params.set('background', background);
      if (meta.name) params.set('metaTitle', meta.name);
      const logo = (meta as { logo?: string | null }).logo;
      if (logo) params.set('logo', logo);
    }
  } catch {
    // best-effort
  }
  return `/player?${params.toString()}`;
}

// ---------- URL builders -------------------------------------------------

export function watchPartyWsUrl(): string {
  if (isNativeShell()) {
    // Desktop: use the direct WebSocket URL — the shell's HTTP proxy
    // does not handle WebSocket upgrade requests.
    return `${STORAGE_WS_URL}/ws/room`;
  }
  // Web: STORAGE_URL is http(s); convert to ws(s) and append the WS path.
  // The Traefik route at /storage forwards both HTTP and WS upgrades.
  const base = STORAGE_URL.replace(/^http/, 'ws');
  return `${base}/ws/room`;
}

// ---------- Code input helpers -------------------------------------------

/** Normalize raw user input into the canonical `xxx-yyy` shape:
 *  - lowercase
 *  - drop any character not in the alphabet
 *  - cap to 6 alpha-num chars
 *  - auto-insert a dash after the 3rd char
 *
 *  Returns a string of length 0..7. */
export function formatRoomCodeInput(raw: string): string {
  const lower = raw.toLowerCase();
  let cleaned = '';
  for (const ch of lower) {
    if (ROOM_CODE_ALPHABET.includes(ch)) {
      cleaned += ch;
      if (cleaned.length >= 6) break;
    }
  }
  if (cleaned.length <= 3) return cleaned;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

// ---------- Guest identity (localStorage) --------------------------------
//
// Watch parties accept users without a Stremio login. We give those
// "guests" a stable random id (per device) so the server can track
// their participant slot across reconnects, plus a chosen display
// name so they show up as something nicer than "Guest" in the
// participant list and chat.
//
// Stremio-authed users with a Blissful displayName don't need any of
// this — their identity is already well-defined.

const GUEST_ID_STORAGE_KEY = 'bliss:watchParty:guestId';
const GUEST_NAME_STORAGE_KEY = 'bliss:watchParty:guestName';

function generateGuestId(): string {
  // 18 random alpha-num chars from a CSPRNG — long enough to be globally unique
  // in practice, short enough to read in server logs. crypto avoids the weak,
  // predictable Math.random sequence (a guess lets you collide a participant slot).
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint32Array(18);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < 18; i++) out += chars[buf[i] % chars.length];
  return out;
}

export function getOrCreateGuestUserId(): string {
  try {
    const cached = localStorage.getItem(GUEST_ID_STORAGE_KEY);
    if (cached && cached.length >= 8) return cached;
  } catch {
    // localStorage disabled — fall through to generating an ephemeral id.
  }
  const fresh = generateGuestId();
  try {
    localStorage.setItem(GUEST_ID_STORAGE_KEY, fresh);
  } catch {
    // Best-effort persistence; ephemeral id still works for this tab.
  }
  return fresh;
}

export function getStoredGuestName(): string | null {
  try {
    const raw = localStorage.getItem(GUEST_NAME_STORAGE_KEY);
    const trimmed = raw?.trim() ?? '';
    return trimmed || null;
  } catch {
    return null;
  }
}

export function setStoredGuestName(name: string): void {
  try {
    localStorage.setItem(GUEST_NAME_STORAGE_KEY, name.trim().slice(0, 64));
  } catch {
    // ignore
  }
}

// ---------- Password sessionStorage helpers ------------------------------
//
// Passwords are not persisted — they live in sessionStorage so the
// player can pick them up after the Join modal navigates, then they
// die with the tab. URL params would be visible in browser history.

const PASSWORD_STORAGE_KEY = 'bliss:watchParty:passwords';

type PasswordCache = Record<string, string>;

function readPasswordCache(): PasswordCache {
  try {
    const raw = sessionStorage.getItem(PASSWORD_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PasswordCache) : {};
  } catch {
    return {};
  }
}

function writePasswordCache(cache: PasswordCache): void {
  try {
    sessionStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage quota / disabled — best-effort only.
  }
}

export function stashWatchPartyPassword(code: string, password: string): void {
  const cache = readPasswordCache();
  cache[code] = password;
  writePasswordCache(cache);
}

export function getWatchPartyPassword(code: string): string | null {
  return readPasswordCache()[code] ?? null;
}

export function clearWatchPartyPassword(code: string): void {
  const cache = readPasswordCache();
  if (cache[code] != null) {
    delete cache[code];
    writePasswordCache(cache);
  }
}

// ---------- REST client --------------------------------------------------

/** Create a new watch-party room as the host. Returns the room code.
 *  Pass `authToken` for signed-in hosts (Blissful JWT) or `guestId`
 *  for unauthenticated guests. */
export async function createWatchPartyRoom(opts: {
  authToken?: string | null;
  guestId?: string | null;
  type: 'movie' | 'series';
  imdbId: string;
  videoId?: string | null;
  password?: string | null;
}): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.authToken) headers['authorization'] = `Bearer ${opts.authToken}`;
  const res = await fetch(`${STORAGE_URL}/watch-party`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: opts.type,
      imdbId: opts.imdbId,
      videoId: opts.videoId ?? null,
      password: opts.password ?? null,
      guestId: opts.authToken ? null : opts.guestId ?? null,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create watch-party room (${res.status})`);
  }
  const json = (await res.json()) as { code: string };
  return json.code;
}

export type WatchPartyRoomInfo = {
  code: string;
  type: 'movie' | 'series';
  imdbId: string;
  videoId: string | null;
  /** Host's current RD fallback URL (or null when on Vidking). Web concept. */
  streamUrl?: string | null;
  hasPassword: boolean;
  participantCount: number;
};

/** Look up a room without joining — used to validate invite codes
 *  and to detect whether a password is required. */
export async function getWatchPartyRoom(code: string): Promise<WatchPartyRoomInfo | null> {
  try {
    const res = await fetch(`${STORAGE_URL}/watch-party/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    return (await res.json()) as WatchPartyRoomInfo;
  } catch {
    return null;
  }
}

/** Like getWatchPartyRoom but distinguishes a CONFIRMED-gone room (404 — host
 *  left / room reaped) from a transient network error, so the player can bail
 *  out of a dead room (clear the stale "Join party" cache) without false-firing
 *  on a blip. */
export async function getWatchPartyRoomStatus(
  code: string,
): Promise<{ status: 'exists'; info: WatchPartyRoomInfo } | { status: 'gone' } | { status: 'error' }> {
  try {
    const res = await fetch(`${STORAGE_URL}/watch-party/${encodeURIComponent(code)}`);
    if (res.status === 404) return { status: 'gone' };
    if (!res.ok) return { status: 'error' };
    return { status: 'exists', info: (await res.json()) as WatchPartyRoomInfo };
  } catch {
    return { status: 'error' };
  }
}

export type VerifyResult = 'ok' | 'wrong-password' | 'no-room' | 'error';

/** Validate a password without actually joining the room. Lets the
 *  Join modal fail fast before navigating into the player. */
export async function verifyWatchPartyPassword(code: string, password: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`${STORAGE_URL}/watch-party/${encodeURIComponent(code)}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) return 'ok';
    if (res.status === 401) return 'wrong-password';
    if (res.status === 404) return 'no-room';
    return 'error';
  } catch {
    return 'error';
  }
}
