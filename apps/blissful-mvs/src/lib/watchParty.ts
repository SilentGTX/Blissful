// Watch Party — types, protocol, REST client, and helper utilities
// for the synchronized "watch together" sessions backed by
// blissful-storage's WebSocket endpoint. See
// `apps/blissful-storage/server.js` for the server side.
//
// Stream URL is intentionally NOT part of the room. Each client
// resolves their own stream (their addons, their RD account) and we
// sync purely on currentTime + play/pause/seek + episode changes. That
// way a host with 4K Real-Debrid links and a guest on free Videasy
// streams can share the same timeline; quality may differ but
// playback stays in lock-step.

import { STORAGE_URL, STORAGE_WS_URL } from './storageBaseUrl';

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

export type WatchPartyRoomSnapshot = {
  code: string;
  hostUserId: string;
  type: 'movie' | 'series';
  imdbId: string;
  videoId: string | null;
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
  | { t: 'host:transfer'; targetUserId: string }
  /** Anyone in the room can broadcast a discrete play/pause/seek —
   *  the server stamps `from` on the relay so clients can attribute
   *  the action in the UI. */
  | { t: 'event'; kind: 'play' | 'pause' | 'seek'; currentTime: number }
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
};

export async function buildRoomPlayerUrl(room: WatchPartyRoomTarget): Promise<string> {
  // Desktop app: look up the last stream we played for this content.
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

  const params = new URLSearchParams();
  params.set('type', room.type);
  params.set('id', room.imdbId);
  if (room.videoId) params.set('videoId', room.videoId);
  params.set('url', stored.url);
  if (stored.title) params.set('title', stored.title);
  params.set('room', room.code);

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
  // Use the direct WebSocket URL — the desktop shell's HTTP proxy
  // does not handle WebSocket upgrade requests.
  return `${STORAGE_WS_URL}/ws/room`;
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
  // 18 random alpha-num chars — long enough to be globally unique in
  // practice, short enough to read in server logs.
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 18; i++) out += chars[Math.floor(Math.random() * chars.length)];
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
