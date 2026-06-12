// Watch Party — protocol + REST client + helpers. 1:1 port of the Windows app's
// apps/web-blissful/src/lib/watchParty.ts, adapted for react-native-tvos:
//   - localStorage/sessionStorage  -> MMKV (kv) + a module Map for passwords
//   - URL query (?room=)           -> navigation params (the player reads `roomCode`)
//   - STORAGE_WS_URL               -> derived from getStorageBaseUrl() (https -> wss)
//
// Transport: a dedicated raw WebSocket per room at `${wss}/ws/room` for realtime
// sync, plus REST (`/watch-party*`) to create/look-up/verify rooms. The server
// (blissful-storage) generates the room code and relays messages; the wire
// contract below is the only spec for what it expects/emits.
import { getStorageBaseUrl } from '@blissful/core';
import { kv } from './storage';

// ── Room code ────────────────────────────────────────────────────────────────
// "xxx-yyy", alphabet excludes look-alikes (0/o/1/l/i). The SERVER generates it;
// formatRoomCodeInput only sanitises what a joiner types.
export const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const ROOM_CODE_LENGTH = 7; // "xxx-yyy"
const ROOM_CODE_RE = /^[a-hjkmnpqrstuvwxyz23456789]{3}-[a-hjkmnpqrstuvwxyz23456789]{3}$/;

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_RE.test(code.trim().toLowerCase());
}

export function formatRoomCodeInput(raw: string): string {
  const filtered = raw
    .toLowerCase()
    .split('')
    .filter((c) => ROOM_CODE_ALPHABET.includes(c))
    .slice(0, 6)
    .join('');
  return filtered.length > 3 ? `${filtered.slice(0, 3)}-${filtered.slice(3)}` : filtered;
}

// ── Wire types ───────────────────────────────────────────────────────────────
export type WatchPartyParticipant = { userId: string; displayName: string; joinedAt: number; isHost: boolean };
export type WatchPartyChatMessage = { from: { userId: string; displayName: string }; text: string; at: number };
export type ReactionMap = Record<string, Record<string, string[]>>; // messageKey -> emoji -> userId[]

export type WatchPartyActivity =
  | { id: string; kind: 'play' | 'pause' | 'seek'; who: { userId: string; displayName: string }; currentTime: number; at: number }
  | { id: string; kind: 'joined' | 'left' | 'host-changed'; who: { userId: string; displayName: string }; at: number };

export type WatchPartyRoomSnapshot = {
  code: string;
  hostUserId: string;
  type: 'movie' | 'series';
  imdbId: string;
  videoId: string | null;
  hasPassword: boolean;
  participants: WatchPartyParticipant[];
  lastTick: { currentTime: number; isPlaying: boolean; at: number } | null;
  chat?: WatchPartyChatMessage[];
  reactions?: ReactionMap;
};

/** Lightweight room info from `GET /watch-party/:code`. */
export type WatchPartyRoomInfo = {
  code: string;
  type: 'movie' | 'series';
  imdbId: string;
  videoId: string | null;
  hasPassword: boolean;
  participantCount: number;
};

// Client -> server
export type WatchPartyClientMessage =
  | { t: 'join'; code: string; displayName: string; token?: string; guestId?: string; password?: string }
  | { t: 'host:tick'; currentTime: number; isPlaying: boolean }
  | { t: 'host:episode'; videoId: string | null }
  | { t: 'host:transfer'; targetUserId: string }
  | { t: 'event'; kind: 'play' | 'pause' | 'seek'; currentTime: number }
  | { t: 'typing' }
  | { t: 'chat'; text: string }
  | { t: 'chat:react'; messageKey: string; emoji: string; kind: 'add' | 'remove' }
  | { t: 'leave' };

// Server -> client
export type WatchPartyServerMessage =
  | ({ t: 'room'; self: { userId: string; displayName: string } } & WatchPartyRoomSnapshot)
  | { t: 'presence'; kind: 'joined' | 'left'; userId: string; displayName: string }
  | { t: 'presence'; kind: 'host-changed'; userId: string; displayName: string; hostUserId: string }
  | { t: 'tick'; currentTime: number; isPlaying: boolean; sentAt: number }
  | { t: 'event'; kind: 'play' | 'pause' | 'seek'; currentTime: number; sentAt: number; from: { userId: string; displayName: string } }
  | { t: 'episode'; videoId: string | null }
  | { t: 'typing'; from: { userId: string; displayName: string } }
  | ({ t: 'chat' } & WatchPartyChatMessage)
  | { t: 'reaction'; messageKey: string; emoji: string; kind: 'add' | 'remove'; from: { userId: string; displayName: string } }
  | { t: 'error'; code: string; message: string };

// ── Endpoints ────────────────────────────────────────────────────────────────
function restBase(): string {
  return getStorageBaseUrl(); // https://blissful.budinoff.com/storage
}
/** The room sync socket. The HTTP proxy can't upgrade WS, so hit storage directly. */
export function watchPartyWsUrl(): string {
  return `${getStorageBaseUrl().replace(/^http/, 'ws')}/ws/room`;
}

// ── Guest identity (persisted) ───────────────────────────────────────────────
const GUEST_ID_KEY = 'bliss:watchParty:guestId';
const GUEST_NAME_KEY = 'bliss:watchParty:guestName';

export function getOrCreateGuestUserId(): string {
  let id = kv.get(GUEST_ID_KEY);
  if (id && id.length >= 12) return id;
  // 18 random [a-z0-9] — Math.random is fine here (not security-sensitive).
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  id = '';
  for (let i = 0; i < 18; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  kv.set(GUEST_ID_KEY, id);
  return id;
}
export function getStoredGuestName(): string {
  return kv.get(GUEST_NAME_KEY) ?? '';
}
export function setStoredGuestName(name: string): void {
  kv.set(GUEST_NAME_KEY, name.trim());
}

// ── Password stash (session-scoped; module map survives navigation) ───────────
const passwordStash = new Map<string, string>();
export function stashWatchPartyPassword(code: string, password: string): void {
  passwordStash.set(code.toLowerCase(), password);
}
export function getStashedWatchPartyPassword(code: string): string | null {
  return passwordStash.get(code.toLowerCase()) ?? null;
}
export function clearWatchPartyPassword(code: string): void {
  passwordStash.delete(code.toLowerCase());
}

// ── REST client ──────────────────────────────────────────────────────────────
function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

/** Create a room for the title being watched. Returns the server-generated code. */
export async function createWatchPartyRoom(args: {
  authToken: string | null;
  guestId: string | null;
  type: 'movie' | 'series';
  imdbId: string;
  videoId: string | null;
  password: string | null;
}): Promise<string> {
  const res = await fetch(`${restBase()}/watch-party`, {
    method: 'POST',
    headers: authHeaders(args.authToken),
    body: JSON.stringify({
      type: args.type,
      imdbId: args.imdbId,
      videoId: args.videoId,
      password: args.password,
      guestId: args.authToken ? null : args.guestId,
    }),
  });
  if (!res.ok) throw new Error(`Could not create room (${res.status})`);
  const data = (await res.json()) as { code?: string };
  if (!data.code) throw new Error('Room create returned no code');
  return data.code;
}

/** Look up a room by code, or null if it doesn't exist. */
export async function getWatchPartyRoom(code: string): Promise<WatchPartyRoomInfo | null> {
  const res = await fetch(`${restBase()}/watch-party/${encodeURIComponent(code.toLowerCase())}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Room lookup failed (${res.status})`);
  return (await res.json()) as WatchPartyRoomInfo;
}

/** Verify a room password. Returns true if correct, false if wrong, throws if no room. */
export async function verifyWatchPartyPassword(code: string, password: string): Promise<boolean> {
  const res = await fetch(`${restBase()}/watch-party/${encodeURIComponent(code.toLowerCase())}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.status === 404) throw new Error('Room not found');
  return res.ok; // 200 ok / 401 wrong
}

// ── Avatar helpers (shared across button / people / chat for consistent colour) ─
const AVATAR_PALETTE = ['#7c3aed', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#db2777', '#0284c7', '#65a30d'];
export function avatarBg(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function messageKeyFor(msg: WatchPartyChatMessage): string {
  return `${msg.from.userId}-${msg.at}`;
}
