import bcrypt from 'bcryptjs';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
import { WebSocketServer } from 'ws';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 8787);
const corsOrigin = process.env.CORS_ORIGIN ?? '*';
const mongodbUri =
  process.env.MONGODB_URI ?? 'mongodb://blissful:change-me@blissful-mongodb:27017/blissful?authSource=admin';
const mongodbDb = process.env.MONGODB_DB ?? 'blissful';

// JWT signing key for Blissful's native auth.
// In production an env var is required; the fallback is fine for local
// dev but unsafe to ship — server logs a warning and a one-time random
// key is generated so tokens issued during a single run still verify.
const JWT_SECRET = (() => {
  const fromEnv = process.env.BLISSFUL_JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  console.warn('[auth] BLISSFUL_JWT_SECRET unset or too short — using ephemeral key (tokens reset on restart).');
  return crypto.randomBytes(32).toString('hex');
})();
const JWT_TTL_SECONDS = Number(process.env.BLISSFUL_JWT_TTL_SECONDS ?? 30 * 24 * 3600);

let mongoClient;
let accountStateCollection;
let watchPartyCollection;
let friendsCollection;
let usersCollection;
let libraryCollection;
let dmsCollection;

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// ---- Blissful native auth ------------------------------------------------
//
// JWT-based session: client sends `Authorization: Bearer <token>`. The
// token payload is `{ sub: userId }`; we look up the live user doc each
// request so password resets / disabled accounts kick in immediately.

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  // Pragmatic regex — not RFC-perfect, just rejects obvious garbage.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// 3-50 chars, lowercase alphanumeric + underscore + hyphen. Common
// "@handle" shape; keeps URLs and regex searches simple.
function isValidUsername(value) {
  return /^[a-z0-9_-]{3,50}$/.test(value);
}

// Derive a candidate username from a free-form displayName for the
// one-time backfill of pre-username accounts.
//
//   - lowercase
//   - whitespace stripped outright ("John Doe" → "johndoe", not
//     "john_doe")
//   - other invalid chars (apostrophes, periods, emoji) collapse to
//     "_" so the result still matches the [a-z0-9_-] regex
//   - leading/trailing underscores trimmed
//   - truncated to 50 chars
//
// Falls back to "user" when nothing usable remains (e.g. emoji-only
// display names) so the backfill can still proceed.
function sanitizeForUsername(value) {
  const base = String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 50);
  return base.length >= 3 ? base : 'user';
}

function signJwt(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_TTL_SECONDS });
}

function readBearerToken(req) {
  const header = req.header('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function getBlissfulUser(req) {
  const token = readBearerToken(req);
  if (!token) return null;
  if (!usersCollection) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || typeof payload.sub !== 'string') return null;
    const user = await usersCollection.findOne({ _id: payload.sub });
    return user ?? null;
  } catch {
    return null;
  }
}

// Express middleware shorthand — attach req.user or 401.
async function requireBlissfulAuth(req, res, next) {
  const user = await getBlissfulUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.user = user;
  next();
}


function parseJson(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildMergedState(existing, incoming) {
  const next = { ...(existing ?? {}) };
  const source = incoming ?? {};

  if (source.theme !== undefined) next.theme = source.theme;
  if (source.uiStyle !== undefined) next.uiStyle = source.uiStyle;
  if (source.darkGradient !== undefined) next.darkGradient = source.darkGradient;
  if (source.lightGradient !== undefined) next.lightGradient = source.lightGradient;
  if (source.playerSettings !== undefined) {
    next.playerSettings = {
      ...(existing?.playerSettings ?? {}),
      ...(source.playerSettings ?? {}),
    };
  }
  if (source.homeRowPrefs !== undefined) {
    next.homeRowPrefs = {
      ...(existing?.homeRowPrefs ?? {}),
      ...(source.homeRowPrefs ?? {}),
    };
  }
  if (source.addons !== undefined) {
    next.addons = source.addons;
  }
  if (source.profile !== undefined) {
    next.profile = {
      ...(existing?.profile ?? {}),
      ...(source.profile ?? {}),
    };
  }

  return next;
}

function toStateDocument(userId, email, state) {
  return {
    _id: userId,
    userId,
    email: email ?? null,
    theme: state?.theme ?? null,
    uiStyle: state?.uiStyle ?? null,
    darkGradient: state?.darkGradient ?? null,
    lightGradient: state?.lightGradient ?? null,
    playerSettings: state?.playerSettings ?? null,
    homeRowPrefs: state?.homeRowPrefs ?? null,
    addons: Array.isArray(state?.addons) ? state.addons : null,
    profile: state?.profile ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function fromStateDocument(doc) {
  if (!doc) return null;
  return {
    theme: doc.theme ?? undefined,
    uiStyle: doc.uiStyle ?? undefined,
    darkGradient: doc.darkGradient ?? undefined,
    lightGradient: doc.lightGradient ?? undefined,
    playerSettings: doc.playerSettings ?? undefined,
    homeRowPrefs: doc.homeRowPrefs ?? undefined,
    addons: doc.addons ?? undefined,
    profile: doc.profile ?? undefined,
  };
}

async function getAccountState(userId) {
  const doc = await accountStateCollection.findOne({ _id: userId });
  return fromStateDocument(doc);
}

async function upsertAccountState(userId, email, incomingState) {
  const existing = await getAccountState(userId);
  const merged = buildMergedState(existing, incomingState);
  await accountStateCollection.replaceOne(
    { _id: userId },
    toStateDocument(userId, email, merged),
    { upsert: true }
  );
  return merged;
}



async function connectWithRetry(client, retries = 10, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      await client.connect();
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`MongoDB connection attempt ${i + 1}/${retries} failed, retrying in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function initializeStorage() {
  mongoClient = new MongoClient(mongodbUri);
  await connectWithRetry(mongoClient);

  const db = mongoClient.db(mongodbDb);
  accountStateCollection = db.collection('account_state');
  await accountStateCollection.createIndex({ email: 1 }, { sparse: true });
  await accountStateCollection.createIndex({ updatedAt: -1 });

  // Watch-party rooms — persisted across restarts so a storage crash
  // doesn't kill in-flight parties. TTL auto-expires rooms 24h after
  // creation so abandoned ones don't accumulate in Mongo.
  watchPartyCollection = db.collection('watch_parties');
  try {
    await watchPartyCollection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 24 * 3600 }
    );
  } catch (err) {
    // Index may already exist with a different TTL — non-fatal.
    console.warn('[watch-party] TTL index setup warning:', err?.message ?? err);
  }

  // Friends graph — pending or accepted edges between two userIds.
  // Indexed both ways so we can list incoming + outgoing for either
  // side, and a unique compound key prevents duplicate requests.
  friendsCollection = db.collection('friends');
  try {
    await friendsCollection.createIndex({ fromUserId: 1, toUserId: 1 }, { unique: true });
    await friendsCollection.createIndex({ toUserId: 1, status: 1 });
    await friendsCollection.createIndex({ fromUserId: 1, status: 1 });
  } catch (err) {
    console.warn('[friends] index setup warning:', err?.message ?? err);
  }

  // Native Blissful users — username/password accounts. `_id` is a
  // stable random id we generate; `username` is the primary login
  // identifier (lowercased, unique). `email` is kept on legacy docs
  // so users registered under the old email flow can still log in
  // with their email until they pick a username, but new accounts
  // don't collect one. The email index stays sparse so it tolerates
  // username-only registrations.
  usersCollection = db.collection('users');
  try {
    await usersCollection.createIndex({ email: 1 }, { unique: true, sparse: true });
  } catch (err) {
    console.warn('[users] email index setup warning:', err?.message ?? err);
  }
  try {
    await usersCollection.createIndex({ username: 1 }, { unique: true, sparse: true });
  } catch (err) {
    console.warn('[users] username index setup warning:', err?.message ?? err);
  }
  // One-time backfill: derive a username for any account that
  // doesn't have one yet (i.e. registered under the old email-only
  // flow). Seed from displayName, fall back to the email prefix, and
  // dedupe with a numeric suffix when collisions arise.
  try {
    const missing = await usersCollection
      .find({ $or: [{ username: { $exists: false } }, { username: null }] })
      .project({ _id: 1, displayName: 1, email: 1 })
      .toArray();
    if (missing.length > 0) {
      const taken = new Set(
        (await usersCollection
          .find({ username: { $exists: true, $ne: null } })
          .project({ username: 1 })
          .toArray())
          .map((u) => u.username)
          .filter(Boolean)
      );
      let updated = 0;
      for (const u of missing) {
        const seed = sanitizeForUsername(
          u.displayName || (u.email ? u.email.split('@')[0] : '')
        );
        let candidate = seed;
        let n = 2;
        while (taken.has(candidate)) {
          const suffix = String(n++);
          candidate = `${seed.slice(0, Math.max(3, 50 - suffix.length))}${suffix}`;
        }
        taken.add(candidate);
        await usersCollection.updateOne({ _id: u._id }, { $set: { username: candidate } });
        updated += 1;
      }
      console.log(`[users] backfilled username on ${updated} pre-username account(s).`);
    }
  } catch (err) {
    console.warn('[users] username backfill warning:', err?.message ?? err);
  }

  // Library + continue-watching: one document per (userId, itemId).
  // `state.timeOffset` / `state.timeWatched` drive Continue Watching;
  // `removed` flips items out of the library list without deleting
  // the progress so users can pick up where they left off later.
  libraryCollection = db.collection('library');
  try {
    await libraryCollection.createIndex({ userId: 1, id: 1 }, { unique: true });
    await libraryCollection.createIndex({ userId: 1, 'state.lastWatched': -1 });
  } catch (err) {
    console.warn('[library] index setup warning:', err?.message ?? err);
  }

  // Direct messages — `pair` is the sorted-by-userId conversation key
  // so reads are a single indexed scan regardless of who sent which
  // message. Both participants share the same pair value.
  dmsCollection = db.collection('dms');
  try {
    await dmsCollection.createIndex({ pair: 1, at: 1 });
    await dmsCollection.createIndex({ toUserId: 1, read: 1 });
    // Free-text search on message body (used by the sidebar search).
    await dmsCollection.createIndex({ text: 'text' });
  } catch (err) {
    console.warn('[dms] index setup warning:', err?.message ?? err);
  }
}

// Stable conversation key for a pair of userIds — sorted so both
// directions resolve to the same value.
function dmPair(a, b) {
  return [a, b].sort().join('|');
}

// ---- Watch-party persistence helpers ----
//
// In-memory `rooms` Map stays the source of truth for active state
// (participants, latest tick). Mongo holds enough to reconstruct
// the room on a fresh server boot: code, host, media identity,
// password hash, last known tick. Tick is overwritten on each event;
// we accept losing a few seconds of position on a crash.

async function persistRoom(room) {
  if (!watchPartyCollection) return;
  try {
    await watchPartyCollection.replaceOne(
      { _id: room.code },
      {
        _id: room.code,
        hostUserId: room.hostUserId,
        // Stored so we can push `party:room-closed` to the original
        // invitee when this room is destroyed, even after a server
        // restart rehydrates the room from Mongo.
        invitedRequesterId: room.invitedRequesterId ?? null,
        type: room.type,
        imdbId: room.imdbId,
        videoId: room.videoId,
        streamUrl: room.streamUrl ?? null,
        subtitleLang: room.subtitleLang ?? null,
        source: room.source ?? null,
        passwordHash: room.passwordHash ?? null,
        lastTick: room.lastTick ?? null,
        chat: room.chat ?? [],
        reactions: room.reactions ?? {},
        createdAt: new Date(room.createdAt),
        updatedAt: new Date(),
      },
      { upsert: true }
    );
  } catch (err) {
    console.warn(`[watch-party] persist ${room.code} failed:`, err?.message ?? err);
  }
}

async function loadRoom(code) {
  if (!watchPartyCollection) return null;
  try {
    const doc = await watchPartyCollection.findOne({ _id: code });
    if (!doc) return null;
    return {
      code: doc._id,
      hostUserId: doc.hostUserId,
      invitedRequesterId: doc.invitedRequesterId ?? null,
      type: doc.type,
      imdbId: doc.imdbId,
      videoId: doc.videoId ?? null,
      streamUrl: doc.streamUrl ?? null,
      subtitleLang: doc.subtitleLang ?? null,
      source: doc.source ?? null,
      passwordHash: doc.passwordHash ?? null,
      participants: new Map(),
      lastTick: doc.lastTick ?? null,
      chat: Array.isArray(doc.chat) ? doc.chat : [],
      reactions: doc.reactions && typeof doc.reactions === 'object' ? doc.reactions : {},
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.getTime() : Date.now(),
    };
  } catch (err) {
    console.warn(`[watch-party] load ${code} failed:`, err?.message ?? err);
    return null;
  }
}

async function destroyRoom(code) {
  // Grab who to notify BEFORE deleting the in-memory entry. The
  // friend who originally requested the party gets a push so their
  // sidebar can flip the dropdown back from "Join party" → "Request
  // party". No-op if this room wasn't born from an invite.
  const room = rooms.get(code);
  const invitedRequesterId = room?.invitedRequesterId ?? null;
  rooms.delete(code);
  if (watchPartyCollection) {
    try {
      await watchPartyCollection.deleteOne({ _id: code });
    } catch (err) {
      console.warn(`[watch-party] delete ${code} failed:`, err?.message ?? err);
    }
  }
  if (invitedRequesterId) {
    pushToUser(invitedRequesterId, {
      t: 'party:room-closed',
      code,
      at: Date.now(),
    });
  }
}

// Empty-room cleanup with a short grace window. A page refresh or
// brief network blip closes the WS for a second or two before the
// client reconnects — destroying immediately would orphan the user
// when they come back. After 15s of no participants the room is
// gone for good (memory AND Mongo); a Mongo TTL of 24h is the
// hard backstop for crash-orphaned rooms.
const ROOM_EMPTY_GRACE_MS = 15000;

function scheduleEmptyDestroy(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    room.cleanupTimer = null;
    if (room.participants.size > 0) return; // someone re-joined during the grace window
    destroyRoom(room.code).then(() => {
      console.log(`[watch-party] room ${room.code} destroyed (empty)`);
    });
  }, ROOM_EMPTY_GRACE_MS);
}

function cancelEmptyDestroy(room) {
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
}

// Host migration grace. When the host disconnects (commonly just a page
// refresh), DON'T promote a successor immediately — that would make the host
// come back as a guest. Wait the same ~15s window; if the original host
// reconnects, they keep the crown (cancelHostMigration on their re-join).
function scheduleHostMigration(room) {
  if (room.hostMigrationTimer) clearTimeout(room.hostMigrationTimer);
  room.hostMigrationTimer = setTimeout(() => {
    room.hostMigrationTimer = null;
    if (room.participants.has(room.hostUserId)) return; // host reconnected
    if (room.participants.size === 0) return;           // empty-destroy handles it
    let oldest = null;
    for (const p of room.participants.values()) {
      if (!oldest || p.joinedAt < oldest.joinedAt) oldest = p;
    }
    if (oldest) {
      room.hostUserId = oldest.userId;
      persistRoom(room).catch(() => {});
      broadcast(room, {
        t: 'presence', kind: 'host-changed',
        userId: oldest.userId, displayName: oldest.displayName, hostUserId: oldest.userId,
      });
      console.log(`[watch-party] room ${room.code} host promoted to ${oldest.userId} (refresh grace elapsed)`);
    }
  }, ROOM_EMPTY_GRACE_MS);
}

function cancelHostMigration(room) {
  if (room.hostMigrationTimer) {
    clearTimeout(room.hostMigrationTimer);
    room.hostMigrationTimer = null;
  }
}

// Hard auto-close: a watch room older than 24h is force-closed regardless of
// participants. The empty-room grace + Mongo TTL handle ABANDONED rooms, but a
// room with a lingering/dead socket (or a stale long-running session) would
// otherwise live forever — and stale rooms surface wrong titles in "Join party".
// The reaper kicks everyone, destroys memory + Mongo, every 30 min.
const ROOM_MAX_AGE_MS = Number(process.env.BLISSFUL_ROOM_MAX_AGE_MS ?? 24 * 3600 * 1000);
const ROOM_REAPER_INTERVAL_MS = 30 * 60 * 1000;
let roomReaperInterval = null;

async function reapStaleRooms() {
  const now = Date.now();
  // In-memory rooms past max age → disconnect participants + destroy.
  for (const room of Array.from(rooms.values())) {
    if (now - (room.createdAt ?? now) <= ROOM_MAX_AGE_MS) continue;
    console.log(`[watch-party] auto-closing room ${room.code} (age > ${Math.round(ROOM_MAX_AGE_MS / 3600000)}h)`);
    for (const p of room.participants.values()) {
      try { p.ws.close(4002, 'room expired'); } catch { /* already closed */ }
    }
    await destroyRoom(room.code).catch(() => {});
  }
  // Backstop: sweep any Mongo docs past max age not in memory (Mongo's own TTL
  // runs on a ~60s background pass; this makes the bound deterministic).
  if (watchPartyCollection) {
    try {
      await watchPartyCollection.deleteMany({ createdAt: { $lt: new Date(now - ROOM_MAX_AGE_MS) } });
    } catch (err) {
      console.warn('[watch-party] reaper sweep failed:', err?.message ?? err);
    }
  }
}

function startRoomReaper() {
  if (roomReaperInterval) return;
  roomReaperInterval = setInterval(() => { void reapStaleRooms(); }, ROOM_REAPER_INTERVAL_MS);
  // Sweep once shortly after boot to clear anything left from a prior run.
  setTimeout(() => { void reapStaleRooms(); }, 30 * 1000);
  console.log(`[watch-party] room reaper started — max age ${Math.round(ROOM_MAX_AGE_MS / 3600000)}h, every ${ROOM_REAPER_INTERVAL_MS / 60000} min`);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, mongo: true });
});

app.get('/state', requireBlissfulAuth, async (req, res) => {
  const { _id: userId, email } = req.user;
  try {
    const state = await getAccountState(userId);
    res.json({ state: state ?? null });
  } catch {
    res.status(500).json({ error: 'Failed to read state' });
  }
});

app.get('/settings', requireBlissfulAuth, async (req, res) => {
  const { _id: userId, email } = req.user;
  try {
    const state = await getAccountState(userId);
    res.json({ playerSettings: state?.playerSettings ?? null, userId, email });
  } catch {
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

app.get('/home', requireBlissfulAuth, async (req, res) => {
  const { _id: userId, email } = req.user;
  try {
    const state = await getAccountState(userId);
    res.json({
      homeRowPrefs: state?.homeRowPrefs ?? null,
      addons: state?.addons ?? null,
      userId,
      email,
    });
  } catch {
    res.status(500).json({ error: 'Failed to read home state' });
  }
});

app.post('/state', requireBlissfulAuth, async (req, res) => {
  const state = req.body?.state;
  if (!state || typeof state !== 'object') {
    res.status(400).json({ error: 'Invalid state payload' });
    return;
  }
  try {
    await upsertAccountState(req.user._id, req.user.email, state);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to store state' });
  }
});

app.post('/settings', requireBlissfulAuth, async (req, res) => {
  const playerSettings = req.body?.playerSettings;
  if (!playerSettings || typeof playerSettings !== 'object') {
    res.status(400).json({ error: 'Invalid player settings payload' });
    return;
  }
  try {
    await upsertAccountState(req.user._id, req.user.email, { playerSettings });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to store settings' });
  }
});

app.post('/home', requireBlissfulAuth, async (req, res) => {
  const homeRowPrefs = req.body?.homeRowPrefs;
  const addons = req.body?.addons;
  if (homeRowPrefs !== undefined && (!homeRowPrefs || typeof homeRowPrefs !== 'object')) {
    res.status(400).json({ error: 'Invalid home row prefs payload' });
    return;
  }
  if (addons !== undefined && !Array.isArray(addons)) {
    res.status(400).json({ error: 'Invalid addons payload' });
    return;
  }
  try {
    await upsertAccountState(req.user._id, req.user.email, { homeRowPrefs, addons });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to store home state' });
  }
});

// ---------- Watch Party ----------------------------------------------------
//
// Sync rooms for "watch together" sessions. Rooms live in memory only — a
// storage restart drops them (intentional: this is real-time sync, not
// persisted state). Each room has one host whose timeline is canonical;
// other participants snap to it on join + on drift. Stream URL is NOT
// part of the room — each client resolves their own stream and we sync
// purely on currentTime + play/pause.

const rooms = new Map(); // code -> Room
const ROOM_CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // skip ambiguous chars (0/o, 1/l/i)

function generateRoomCode() {
  const pick = (n) => Array.from({ length: n }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  let code;
  do {
    code = `${pick(3)}-${pick(3)}`;
  } while (rooms.has(code));
  return code;
}

function hashPartyPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

// Cap chat history per room so a long-running session doesn't grow
// the Mongo doc unbounded. 100 ≈ enough scroll-back for the average
// watch party while staying well under Mongo's 16 MB doc limit.
const MAX_CHAT_HISTORY = 100;

// Watch-party v2 content identity. Validate every field — this is host-
// supplied and relayed to guests, who feed parts of it into URLs (infoHash
// into /rd-by-hash, rdUrl/relay url into the player), so it must be strict.
// See docs/WATCH-PARTY-V2.md.
function sanitizeWatchPartySource(s) {
  if (!s || typeof s !== 'object') return null;
  const isHash = (h) => typeof h === 'string' && /^[a-f0-9]{40}$/i.test(h);
  const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= 2000;
  switch (s.kind) {
    case 'torrent': {
      if (!isHash(s.infoHash)) return null;
      const out = { kind: 'torrent', infoHash: s.infoHash.toLowerCase(), fileIdx: Number.isInteger(s.fileIdx) ? s.fileIdx : null };
      if (Array.isArray(s.trackers)) out.trackers = s.trackers.filter((t) => typeof t === 'string' && t.length <= 400).slice(0, 50);
      return out;
    }
    case 'rd': {
      if (!isHttp(s.rdUrl)) return null;
      const out = { kind: 'rd', rdUrl: s.rdUrl };
      if (isHash(s.infoHash)) out.infoHash = s.infoHash.toLowerCase();
      return out;
    }
    case 'vidking': {
      if (!Number.isInteger(s.tmdbId)) return null;
      const out = { kind: 'vidking', tmdbId: s.tmdbId, mediaType: s.mediaType === 'tv' ? 'tv' : 'movie' };
      if (Number.isInteger(s.season)) out.season = s.season;
      if (Number.isInteger(s.episode)) out.episode = s.episode;
      return out;
    }
    case 'relay':
      return isHttp(s.url) ? { kind: 'relay', url: s.url } : null;
    default:
      return null;
  }
}

function serializeRoom(room) {
  return {
    code: room.code,
    hostUserId: room.hostUserId,
    type: room.type,
    imdbId: room.imdbId,
    videoId: room.videoId,
    streamUrl: room.streamUrl ?? null,
    subtitleLang: room.subtitleLang ?? null,
    source: room.source ?? null,
    hasPassword: !!room.passwordHash,
    participants: Array.from(room.participants.values()).map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      joinedAt: p.joinedAt,
      isHost: p.userId === room.hostUserId,
    })),
    lastTick: room.lastTick,
    // Persistent room state — new joiners (or anyone refreshing) get
    // the full history so chat + reactions survive both a tab reload
    // and a storage container restart.
    chat: room.chat ?? [],
    reactions: room.reactions ?? {},
  };
}

function broadcast(room, payload, exceptWs) {
  const json = JSON.stringify(payload);
  for (const p of room.participants.values()) {
    if (p.ws !== exceptWs && p.ws.readyState === 1) {
      try {
        p.ws.send(json);
      } catch {
        // Ignore — closed sockets get cleaned by the 'close' handler.
      }
    }
  }
}

// Resolves the caller's userId — Blissful JWT subject when present,
// namespaced guest id otherwise. Throws on missing/invalid.
async function resolveCallerUserId(req, { guestId }) {
  const blissfulUser = await getBlissfulUser(req);
  if (blissfulUser) return blissfulUser._id;
  const trimmed = typeof guestId === 'string' ? guestId.trim() : '';
  if (!trimmed || trimmed.length < 8) {
    throw new Error('auth or guestId required');
  }
  // Namespace so guest ids can't collide with real user ids.
  return `guest:${trimmed.slice(0, 64)}`;
}

app.post('/watch-party', async (req, res) => {
  const { type, imdbId, videoId, password, guestId } = req.body ?? {};
  if (type !== 'movie' && type !== 'series') {
    res.status(400).json({ error: 'type must be movie or series' });
    return;
  }
  if (typeof imdbId !== 'string' || !imdbId.trim()) {
    res.status(400).json({ error: 'imdbId required' });
    return;
  }
  const passwordTrimmed = typeof password === 'string' ? password.trim() : '';
  if (password != null && typeof password !== 'string') {
    res.status(400).json({ error: 'password must be a string' });
    return;
  }
  try {
    const userId = await resolveCallerUserId(req, { guestId });
    const code = generateRoomCode();
    const room = {
      code,
      hostUserId: userId,
      type,
      imdbId: imdbId.trim(),
      videoId: typeof videoId === 'string' && videoId.trim() ? videoId.trim() : null,
      streamUrl: null,
      subtitleLang: null,
      source: null,
      passwordHash: passwordTrimmed ? hashPartyPassword(passwordTrimmed) : null,
      participants: new Map(),
      lastTick: null,
      chat: [],
      reactions: {},
      createdAt: Date.now(),
    };
    rooms.set(code, room);
    await persistRoom(room);
    console.log(`[watch-party] created room ${code} for ${type} ${imdbId} by ${userId}${passwordTrimmed ? ' (password)' : ''}`);
    res.json({ code });
  } catch (err) {
    if (err && err.message === 'auth or guestId required') {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error('[watch-party] failed to create room:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// ---------- Party invites (real-time over the user socket) -----------------
//
// Invite request flow:
//   1. POST /party-invite/request — requester (B) asks friend (A,
//      who is currently watching something) to start a watch party.
//      Server validates they're friends + A has an active activity,
//      pushes `party:invite-request` to A.
//   2. A clicks accept in their player → POST /party-invite/accept
//      with the title/episode payload. Server creates a real
//      watch-party room with A as host, pushes
//      `party:invite-accepted` (with the room code) back to B.
//   3. B's UI shows a "Join" button that hits the existing watch-
//      party-join flow with that code.

app.post('/party-invite/request', requireBlissfulAuth, async (req, res) => {
  const targetUserId = typeof req.body?.targetUserId === 'string' ? req.body.targetUserId.trim() : '';
  if (!targetUserId) {
    res.status(400).json({ error: 'Missing targetUserId' });
    return;
  }
  const me = req.user._id;
  if (targetUserId === me) {
    res.status(400).json({ error: "Can't invite yourself" });
    return;
  }
  if (!(await isFriendOf(me, targetUserId))) {
    res.status(403).json({ error: 'Not friends' });
    return;
  }
  // Snapshot the friend's current activity from the users row.
  if (!usersCollection) {
    res.status(503).json({ error: 'Storage unavailable' });
    return;
  }
  const target = await usersCollection.findOne(
    { _id: targetUserId },
    { projection: { displayName: 1, currentActivity: 1 } }
  );
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  // Online = the user has an active /ws/user socket right now.
  // WebSockets survive paused players, scrubbing, and tab throttling,
  // so this is the reliable signal.
  const isOnline = userSockets.has(target._id);
  const activity = target.currentActivity;
  if (!isOnline || !activity?.id || !activity?.type) {
    res.status(409).json({ error: "They aren't watching anything right now." });
    return;
  }
  // Stamp the inviter's display info so the player UI on the target
  // can render "X wants to watch with you" without an extra lookup.
  pushToUser(target._id, {
    t: 'party:invite-request',
    from: {
      userId: me,
      displayName: req.user.displayName || req.user.username || 'Someone',
    },
    // Echo the activity so the target sees exactly what's being
    // offered — even if their playback context drifts.
    activity: {
      type: activity.type,
      id: activity.id,
      name: activity.name,
      videoId: activity.videoId ?? null,
    },
    at: Date.now(),
  });
  res.json({ ok: true });
});

app.post('/party-invite/accept', requireBlissfulAuth, async (req, res) => {
  // The accepting user (the one who's watching) becomes the room host.
  const requesterUserId = typeof req.body?.requesterUserId === 'string' ? req.body.requesterUserId.trim() : '';
  const type = typeof req.body?.type === 'string' ? req.body.type : '';
  const imdbId = typeof req.body?.imdbId === 'string' ? req.body.imdbId.trim() : '';
  const videoId = typeof req.body?.videoId === 'string' && req.body.videoId.trim()
    ? req.body.videoId.trim()
    : null;
  const partyType = type === 'series' || type === 'anime' ? 'series' : 'movie';
  if (!requesterUserId || !imdbId) {
    res.status(400).json({ error: 'Missing requesterUserId or imdbId' });
    return;
  }
  const me = req.user._id;
  if (!(await isFriendOf(me, requesterUserId))) {
    res.status(403).json({ error: 'Not friends' });
    return;
  }
  try {
    // Look for an existing room hosted by me for this same title +
    // requester. If found, reuse it — spam-clicking Accept (or a
    // second invite from the same friend before the first room
    // closes) should NOT spawn a duplicate.
    let room = null;
    for (const r of rooms.values()) {
      if (
        r.hostUserId === me
        && r.type === partyType
        && r.imdbId === imdbId
        && (r.videoId ?? null) === (videoId ?? null)
        && r.invitedRequesterId === requesterUserId
      ) {
        room = r;
        break;
      }
    }
    if (!room) {
      const code = generateRoomCode();
      room = {
        code,
        hostUserId: me,
        invitedRequesterId: requesterUserId,
        type: partyType,
        imdbId,
        videoId,
        passwordHash: null,
        participants: new Map(),
        lastTick: null,
        chat: [],
        reactions: {},
        createdAt: Date.now(),
      };
      rooms.set(code, room);
      await persistRoom(room);
      console.log(`[watch-party] room ${code} via invite — host ${me} for ${requesterUserId}`);
    } else {
      console.log(`[watch-party] room ${room.code} reused — host ${me} for ${requesterUserId}`);
    }
    // Push the room code straight to the requester so their UI can
    // render a "Join" button without polling.
    pushToUser(requesterUserId, {
      t: 'party:invite-accepted',
      code: room.code,
      type: partyType,
      imdbId,
      videoId,
      host: {
        userId: me,
        displayName: req.user.displayName || req.user.username || 'Friend',
      },
      at: Date.now(),
    });
    res.json({ code: room.code });
  } catch (err) {
    console.error('[party-invite] accept failed:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Helper: read a room from memory, falling back to Mongo. Used by
// GET / verify / WS join so a storage restart doesn't make rooms
// appear "deleted" — we just lazily rehydrate from the persisted
// definition.
async function getRoomCached(code) {
  const live = rooms.get(code);
  if (live) return live;
  const hydrated = await loadRoom(code);
  if (hydrated) rooms.set(code, hydrated);
  return hydrated;
}

app.get('/watch-party/:code', async (req, res) => {
  const room = await getRoomCached(req.params.code);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json({
    code: room.code,
    type: room.type,
    imdbId: room.imdbId,
    videoId: room.videoId,
    streamUrl: room.streamUrl ?? null,
    hasPassword: !!room.passwordHash,
    participantCount: room.participants.size,
  });
});

// Verify password without joining — used by the Join modal to fail
// fast before navigating the user into the player.
app.post('/watch-party/:code/verify', async (req, res) => {
  const room = await getRoomCached(req.params.code);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  if (!room.passwordHash) {
    res.json({ ok: true });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
  if (!password || hashPartyPassword(password) !== room.passwordHash) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }
  res.json({ ok: true });
});

// ---------- Native Blissful auth -------------------------------------------

function serializeBlissfulUser(user) {
  if (!user) return null;
  return {
    id: user._id,
    username: user.username ?? null,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    avatar: user.avatar ?? null,
    createdAt: user.createdAt instanceof Date ? user.createdAt.getTime() : user.createdAt,
  };
}

app.post('/auth/register', async (req, res) => {
  if (!usersCollection) {
    res.status(503).json({ error: 'Auth storage unavailable' });
    return;
  }
  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const displayName = typeof req.body?.displayName === 'string'
    ? req.body.displayName.trim().slice(0, 60)
    : '';
  if (!isValidUsername(username)) {
    res.status(400).json({
      error: 'Username must be 3-50 chars: lowercase letters, numbers, underscore, hyphen.',
    });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  if (password.length > 50) {
    res.status(400).json({ error: 'Password must be at most 50 characters' });
    return;
  }
  try {
    const existing = await usersCollection.findOne({ username });
    if (existing) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }
    const userId = crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      _id: userId,
      username,
      passwordHash,
      displayName: displayName || username,
      avatar: null,
      createdAt: new Date(),
    };
    await usersCollection.insertOne(doc);
    const token = signJwt(userId);
    res.json({ token, user: serializeBlissfulUser(doc) });
  } catch (err) {
    console.warn('[auth] register failed:', err?.message ?? err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login accepts a single `identifier` field — username OR email.
// "@" in the input → email lookup (back-compat for users registered
// under the old email-only flow). Otherwise username lookup against
// the new unique field. The legacy `email` body field is still
// honoured so older client builds don't break mid-rollout.
app.post('/auth/login', async (req, res) => {
  if (!usersCollection) {
    res.status(503).json({ error: 'Auth storage unavailable' });
    return;
  }
  const raw = typeof req.body?.identifier === 'string'
    ? req.body.identifier
    : typeof req.body?.email === 'string'
      ? req.body.email
      : typeof req.body?.username === 'string'
        ? req.body.username
        : '';
  const identifier = raw.trim().toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!identifier || !password) {
    res.status(400).json({ error: 'Missing username/email or password' });
    return;
  }
  try {
    const lookup = identifier.includes('@')
      ? { email: identifier }
      : { username: identifier };
    const user = await usersCollection.findOne(lookup);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = signJwt(user._id);
    res.json({ token, user: serializeBlissfulUser(user) });
  } catch (err) {
    console.warn('[auth] login failed:', err?.message ?? err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/auth/me', async (req, res) => {
  const user = await getBlissfulUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  res.json({ user: serializeBlissfulUser(user) });
});

// PATCH /auth/me — update the signed-in user's username, displayName
// and/or avatar. Used by the Settings page (username) and the
// "Who's watching?" / Profile prompt (displayName + avatar). Empty
// strings clear displayName/avatar; missing keys are left alone.
// Username is validated against the same regex as registration and
// checked for uniqueness; a duplicate returns 409.
app.patch('/auth/me', requireBlissfulAuth, async (req, res) => {
  if (!usersCollection) {
    res.status(503).json({ error: 'Auth storage unavailable' });
    return;
  }
  const updates = {};
  if (typeof req.body?.displayName === 'string') {
    updates.displayName = req.body.displayName.trim().slice(0, 60);
  }
  if (typeof req.body?.avatar === 'string') {
    updates.avatar = req.body.avatar.trim() || null;
  } else if (req.body?.avatar === null) {
    updates.avatar = null;
  }
  if (typeof req.body?.username === 'string') {
    const nextUsername = normalizeUsername(req.body.username);
    if (!isValidUsername(nextUsername)) {
      res.status(400).json({
        error: 'Username must be 3-50 chars: lowercase letters, numbers, underscore, hyphen.',
      });
      return;
    }
    if (nextUsername !== req.user.username) {
      // Uniqueness check — fast-fail before the writes hit. Sparse
      // unique index would also block this at insert time, but
      // pre-checking lets us return a clean 409 with a message
      // instead of a generic 500.
      const clash = await usersCollection.findOne({
        username: nextUsername,
        _id: { $ne: req.user._id },
      });
      if (clash) {
        res.status(409).json({ error: 'Username already taken' });
        return;
      }
      updates.username = nextUsername;
    }
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }
  try {
    await usersCollection.updateOne({ _id: req.user._id }, { $set: updates });
    const fresh = await usersCollection.findOne({ _id: req.user._id });
    res.json({ user: serializeBlissfulUser(fresh) });
  } catch (err) {
    console.warn('[auth] profile update failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ---------- Library + Continue Watching -----------------------------------
//
// The migration endpoint accepts the raw Stremio library item array
// (what `datastoreGet libraryItem` returns) and stores it as-is under
// the caller's Blissful userId. Going forward, `progressStore.ts`
// writes incremental updates here too.

// Stremio's library items use `_id` as the identifier; we accept
// either `_id` or `id` to keep this endpoint usable from any client.
// The Mongo doc stores it as `id` so PUT/DELETE on /library/:id work.
function extractItemId(item) {
  if (!item || typeof item !== 'object') return null;
  const candidate = item._id ?? item.id;
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  return trimmed.length ? trimmed : null;
}

app.post('/library/import', requireBlissfulAuth, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) {
    res.status(400).json({ error: 'Expected items array' });
    return;
  }
  if (!libraryCollection) {
    res.status(503).json({ error: 'Library storage unavailable' });
    return;
  }
  const userId = req.user._id;
  let imported = 0;
  let skipped = 0;
  let writeErrors = 0;
  try {
    const ops = [];
    for (const item of items) {
      const itemId = extractItemId(item);
      if (!itemId) {
        skipped++;
        continue;
      }
      // Strip `_id` so each user gets their own auto-generated ObjectId
      // — otherwise Stremio's IMDB-id-as-_id collides when two users
      // share the same item. Uniqueness is enforced by the
      // {userId, id} compound index, not by _id.
      const { _id, ...rest } = item;
      ops.push({
        replaceOne: {
          filter: { userId, id: itemId },
          replacement: { ...rest, userId, id: itemId, updatedAt: new Date() },
          upsert: true,
        },
      });
    }
    if (ops.length > 0) {
      try {
        const result = await libraryCollection.bulkWrite(ops, { ordered: false });
        imported = (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0);
      } catch (err) {
        // With `ordered: false`, the driver still throws when *any* op
        // fails — but the successful ops did go through. Pull the partial
        // counts off the BulkWriteError so the import is reported as a
        // partial success instead of a hard failure.
        if (err && typeof err === 'object' && err.code === 11000) {
          const r = err.result?.result ?? err.writeResult ?? {};
          imported = (r.nUpserted ?? 0) + (r.nModified ?? 0);
          writeErrors = err.writeErrors?.length ?? 1;
          console.warn(`[library] partial import for ${userId}: ${imported} written, ${writeErrors} write errors`);
        } else {
          throw err;
        }
      }
    }
    res.json({ ok: true, imported, total: items.length, skipped, writeErrors });
  } catch (err) {
    console.warn('[library] import failed:', err?.message ?? err);
    res.status(500).json({ error: 'Import failed' });
  }
});

app.get('/library', requireBlissfulAuth, async (req, res) => {
  if (!libraryCollection) {
    res.status(503).json({ error: 'Library storage unavailable' });
    return;
  }
  try {
    const items = await libraryCollection
      .find({ userId: req.user._id })
      .toArray();
    // Strip Mongo bookkeeping but expose the stored Stremio identifier
    // back as `_id` (and keep `id` too). The rest of the app expects
    // `item._id` everywhere — without this, `/detail/series/${item._id}`
    // renders `/detail/series/undefined`.
    const out = items.map((doc) => {
      const { _id, userId, updatedAt, id, ...rest } = doc;
      return { ...rest, _id: id, id };
    });
    res.json({ items: out });
  } catch (err) {
    console.warn('[library] read failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to read library' });
  }
});

app.put('/library/:id', requireBlissfulAuth, async (req, res) => {
  if (!libraryCollection) {
    res.status(503).json({ error: 'Library storage unavailable' });
    return;
  }
  const id = req.params.id;
  const body = req.body && typeof req.body === 'object' ? req.body : null;
  if (!id || !body) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  try {
    // Strip the client-supplied `_id` before replaceOne. `GET /library`
    // exposes the Stremio id as `_id` for client convenience, and the
    // client's progress merger spreads `...existing` back into the PUT
    // body — without stripping here, replaceOne tries to set the doc's
    // immutable Mongo _id (an ObjectId from /library/import) to the
    // Stremio string id and the update fails: "After applying the
    // update, the (immutable) field '_id' was found to have been
    // altered". The doc is identified by {userId, id}; Mongo manages
    // _id on its own.
    const { _id: _clientId, ...safeBody } = body;
    await libraryCollection.replaceOne(
      { userId: req.user._id, id },
      { ...safeBody, userId: req.user._id, id, updatedAt: new Date() },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.warn('[library] put failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to save' });
  }
});

app.delete('/library/:id', requireBlissfulAuth, async (req, res) => {
  if (!libraryCollection) {
    res.status(503).json({ error: 'Library storage unavailable' });
    return;
  }
  try {
    await libraryCollection.deleteOne({ userId: req.user._id, id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.warn('[library] delete failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ---------- Stremio account sync -----------------------------------------
//
// Two-way mirror between a user's official Stremio account and Blissful's
// `library` collection. Both stores share the libraryItem shape (same
// `_id`, `state.timeOffset`, `_mtime`, …), so the merge is per-item:
// whichever side has the newer `_mtime` replaces the loser entirely.
//
// Token flow: client POSTs Stremio email/password to /stremio/link, we
// hit Stremio's /api/login, stash the returned authKey on the user doc,
// run an immediate sync. A 15-min cron iterates linked users and runs
// syncUserStremio for each. Errors land on `stremioLastSyncError` so the
// Settings UI can surface them.

const STREMIO_API_BASE = 'https://api.strem.io/api';
const STREMIO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const STREMIO_PUT_CHUNK = 100;
const STREMIO_USER_GAP_MS = 250;

function stremioMtimeMs(v) {
  // Stremio's _mtime is an ISO string; Blissful writes either ISO, a
  // numeric ms, or a Date. Normalize so newer-wins compares apples to
  // apples.
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

async function stremioFetchLibrary(authKey) {
  const res = await fetch(`${STREMIO_API_BASE}/datastoreGet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ authKey, collection: 'libraryItem', ids: [], all: true }),
  });
  if (!res.ok) throw new Error(`stremio datastoreGet HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) {
    throw new Error(`stremio datastoreGet: ${json.error.message ?? 'unknown error'}`);
  }
  // Response shape varies: { result: { items: [...] } } or { result: [...] }.
  const raw = json?.result;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

async function stremioPushLibrary(authKey, changes) {
  // Stremio caps payload size; chunk to keep each PUT small.
  for (let i = 0; i < changes.length; i += STREMIO_PUT_CHUNK) {
    const slice = changes.slice(i, i + STREMIO_PUT_CHUNK);
    const res = await fetch(`${STREMIO_API_BASE}/datastorePut`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authKey, collection: 'libraryItem', changes: slice }),
    });
    if (!res.ok) throw new Error(`stremio datastorePut HTTP ${res.status}`);
    const json = await res.json();
    if (json?.error) {
      throw new Error(`stremio datastorePut: ${json.error.message ?? 'unknown error'}`);
    }
  }
}

// Per-user merge. Returns { pulled, pushed }.
//
// Race note: a player write can land between our local read and bulkWrite,
// so the loser of that race gets clobbered. The next 15-min tick heals it
// (the now-stale side will have an older _mtime). Acceptable for v1.
async function syncUserStremio(userDoc) {
  const userId = userDoc._id;
  const authKey = userDoc.stremioAuthKey;
  if (!authKey) return { pulled: 0, pushed: 0 };

  // Fetch remote first so the local read window is as close as possible
  // to the write that follows.
  const remoteItems = await stremioFetchLibrary(authKey);
  const localDocs = await libraryCollection.find({ userId }).toArray();

  const remoteById = new Map();
  for (const item of remoteItems) {
    const id = extractItemId(item);
    if (id) remoteById.set(id, item);
  }
  const localById = new Map();
  for (const doc of localDocs) {
    if (doc.id) localById.set(doc.id, doc);
  }

  const mongoOps = [];
  const stremioChanges = [];
  let pulled = 0;
  let pushed = 0;

  const upsertLocal = (remote, id) => {
    // Strip Stremio's _id and any stray Mongo metadata; the {userId, id}
    // unique index is what identifies the row locally. Stamp
    // _blissProgressSource so the client can badge this row in CW as
    // Stremio-sourced (cleared when the Blissful player writes progress).
    const { _id: _strip, ...rest } = remote;
    mongoOps.push({
      replaceOne: {
        filter: { userId, id },
        replacement: {
          ...rest,
          userId,
          id,
          updatedAt: new Date(),
          _blissProgressSource: 'stremio',
        },
        upsert: true,
      },
    });
    pulled++;
  };

  const queueRemotePush = (local, id) => {
    // Strip Mongo internals + Blissful-only flags; explicit _id wins
    // as the Stremio identifier.
    //
    // Force `removed: false` / `temp: false` when the local row has
    // progress. Blissful keeps "ghost" rows as `removed: true, temp:
    // true` so they show in CW without populating the Library page,
    // but Stremio reads `removed: true` as "user removed it" and
    // hides the entry entirely — progress would silently fail to
    // appear in the user's official Stremio app even though we
    // pushed it. Normalising on push keeps Stremio's library + CW
    // working without changing Blissful's internal semantics.
    const {
      _id: _mongoId,
      userId: _u,
      updatedAt: _ua,
      _blissProgressSource: _src,
      ...rest
    } = local;
    const hasProgress =
      typeof rest.state?.timeOffset === 'number' && rest.state.timeOffset > 0;
    const normalized = hasProgress
      ? { ...rest, removed: false, temp: false }
      : rest;
    stremioChanges.push({ ...normalized, _id: id });
    pushed++;
  };

  for (const [id, remote] of remoteById) {
    const local = localById.get(id);
    if (!local) {
      upsertLocal(remote, id);
      continue;
    }
    const remoteMtime = stremioMtimeMs(remote._mtime);
    const localMtime = stremioMtimeMs(local._mtime);
    if (remoteMtime > localMtime) upsertLocal(remote, id);
    else if (localMtime > remoteMtime) queueRemotePush(local, id);
    // ties: in sync, skip
  }
  for (const [id, local] of localById) {
    if (remoteById.has(id)) continue;
    queueRemotePush(local, id);
  }

  if (mongoOps.length) {
    try {
      await libraryCollection.bulkWrite(mongoOps, { ordered: false });
    } catch (err) {
      // Same partial-success handling as /library/import — dup-key errors
      // are non-fatal when ordered: false is set.
      if (err && typeof err === 'object' && err.code !== 11000) throw err;
    }
  }
  if (stremioChanges.length) {
    await stremioPushLibrary(authKey, stremioChanges);
  }

  return { pulled, pushed };
}

async function recordStremioSync(userId, ok, error) {
  if (!usersCollection) return;
  const update = { stremioLastSyncAt: Date.now() };
  if (ok) update.stremioLastSyncError = null;
  else update.stremioLastSyncError = typeof error === 'string' ? error.slice(0, 500) : 'unknown error';
  await usersCollection.updateOne({ _id: userId }, { $set: update });
}

// Accepts a Stremio authKey already obtained by the browser (the popup
// at /stremio-link posts credentials directly to api.strem.io, so the
// password never reaches us — only the resulting token does). Stores
// the token and triggers an immediate sync, same as /stremio/link.
app.post('/stremio/link-token', requireBlissfulAuth, async (req, res) => {
  const authKey = typeof req.body?.authKey === 'string' ? req.body.authKey.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!authKey) {
    res.status(400).json({ error: 'authKey required' });
    return;
  }
  try {
    await usersCollection.updateOne(
      { _id: req.user._id },
      {
        $set: {
          stremioAuthKey: authKey,
          stremioEmail: email || req.user.stremioEmail || null,
          stremioLinkedAt: Date.now(),
          stremioLastSyncAt: null,
          stremioLastSyncError: null,
        },
      }
    );
    const fresh = await usersCollection.findOne({ _id: req.user._id });
    let syncResult = { pulled: 0, pushed: 0 };
    try {
      syncResult = await syncUserStremio(fresh);
      await recordStremioSync(fresh._id, true);
    } catch (err) {
      await recordStremioSync(fresh._id, false, err?.message);
      console.warn(`[stremio] first sync (token-link) failed for ${fresh._id}:`, err?.message ?? err);
    }
    res.json({ ok: true, stremioEmail: fresh.stremioEmail, pulled: syncResult.pulled, pushed: syncResult.pushed });
  } catch (err) {
    console.warn('[stremio] link-token failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to store Stremio token' });
  }
});

app.post('/stremio/unlink', requireBlissfulAuth, async (req, res) => {
  await usersCollection.updateOne(
    { _id: req.user._id },
    {
      $unset: {
        stremioAuthKey: '',
        stremioEmail: '',
        stremioLinkedAt: '',
        stremioLastSyncAt: '',
        stremioLastSyncError: '',
      },
    }
  );
  res.json({ ok: true });
});

app.get('/stremio/status', requireBlissfulAuth, async (req, res) => {
  const u = req.user;
  res.json({
    linked: typeof u.stremioAuthKey === 'string' && u.stremioAuthKey.length > 0,
    email: u.stremioEmail ?? null,
    linkedAt: u.stremioLinkedAt ?? null,
    lastSyncAt: u.stremioLastSyncAt ?? null,
    lastSyncError: u.stremioLastSyncError ?? null,
  });
});

app.post('/stremio/sync', requireBlissfulAuth, async (req, res) => {
  if (!req.user.stremioAuthKey) {
    res.status(400).json({ error: 'Stremio account not linked' });
    return;
  }
  try {
    const result = await syncUserStremio(req.user);
    await recordStremioSync(req.user._id, true);
    res.json({ ok: true, pulled: result.pulled, pushed: result.pushed });
  } catch (err) {
    await recordStremioSync(req.user._id, false, err?.message).catch(() => {});
    console.warn(`[stremio] manual sync failed for ${req.user._id}:`, err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Sync failed' });
  }
});

// Per-item sync for the player-open/player-close triggers. Same
// merge logic as syncUserStremio but scoped to one libraryItem, so a
// player mount/unmount costs a single Stremio API call each direction
// instead of the full datastore pull. Lets the cron stay at 15 min.
async function syncSingleStremioItem(userDoc, itemId) {
  const userId = userDoc._id;
  const authKey = userDoc.stremioAuthKey;
  if (!authKey) return { pulled: 0, pushed: 0 };

  // Stremio's datastoreGet accepts `ids: [...]` with `all: false` to
  // fetch a specific subset — much cheaper than `all: true` for a
  // single-item check.
  const res = await fetch(`${STREMIO_API_BASE}/datastoreGet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ authKey, collection: 'libraryItem', ids: [itemId], all: false }),
  });
  if (!res.ok) throw new Error(`stremio datastoreGet HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) {
    throw new Error(`stremio datastoreGet: ${json.error.message ?? 'unknown error'}`);
  }
  const raw = json?.result;
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  const remote = items.find((it) => extractItemId(it) === itemId) ?? null;
  const local = await libraryCollection.findOne({ userId, id: itemId });

  let pulled = 0;
  let pushed = 0;

  if (remote && !local) {
    // Stremio-only → pull into Blissful (mark source = stremio).
    const { _id: _strip, ...rest } = remote;
    await libraryCollection.replaceOne(
      { userId, id: itemId },
      { ...rest, userId, id: itemId, updatedAt: new Date(), _blissProgressSource: 'stremio' },
      { upsert: true }
    );
    pulled = 1;
  } else if (local && !remote) {
    // Blissful-only → push to Stremio. Strip Blissful-only flags;
    // normalize ghost rows (removed/temp) so Stremio shows them in
    // its library + CW when they have progress.
    const {
      _id: _mongoId,
      userId: _u,
      updatedAt: _ua,
      _blissProgressSource: _src,
      ...rest
    } = local;
    const hasProgress =
      typeof rest.state?.timeOffset === 'number' && rest.state.timeOffset > 0;
    const normalized = hasProgress
      ? { ...rest, removed: false, temp: false }
      : rest;
    await stremioPushLibrary(authKey, [{ ...normalized, _id: itemId }]);
    pushed = 1;
  } else if (remote && local) {
    const remoteMtime = stremioMtimeMs(remote._mtime);
    const localMtime = stremioMtimeMs(local._mtime);
    if (remoteMtime > localMtime) {
      const { _id: _strip, ...rest } = remote;
      await libraryCollection.replaceOne(
        { userId, id: itemId },
        { ...rest, userId, id: itemId, updatedAt: new Date(), _blissProgressSource: 'stremio' },
        { upsert: true }
      );
      pulled = 1;
    } else if (localMtime > remoteMtime) {
      const {
        _id: _mongoId,
        userId: _u,
        updatedAt: _ua,
        _blissProgressSource: _src,
        ...rest
      } = local;
      const hasProgress =
        typeof rest.state?.timeOffset === 'number' && rest.state.timeOffset > 0;
      const normalized = hasProgress
        ? { ...rest, removed: false, temp: false }
        : rest;
      await stremioPushLibrary(authKey, [{ ...normalized, _id: itemId }]);
      pushed = 1;
    }
    // ties: in sync, no-op
  }

  return { pulled, pushed };
}

app.post('/stremio/sync-item', requireBlissfulAuth, async (req, res) => {
  if (!req.user.stremioAuthKey) {
    res.status(400).json({ error: 'Stremio account not linked' });
    return;
  }
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }
  try {
    const result = await syncSingleStremioItem(req.user, id);
    // Touch lastSyncAt so the panel's relative time reflects activity,
    // but don't clobber lastSyncError on success (cron still owns full
    // error reporting).
    await usersCollection
      .updateOne({ _id: req.user._id }, { $set: { stremioLastSyncAt: Date.now() } })
      .catch(() => {});
    res.json({ ok: true, pulled: result.pulled, pushed: result.pushed });
  } catch (err) {
    console.warn(`[stremio] sync-item ${id} failed for ${req.user._id}:`, err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Sync failed' });
  }
});

let stremioSyncInterval = null;
let stremioSyncInFlight = false;

async function runStremioSyncTick() {
  if (stremioSyncInFlight) return;
  if (!usersCollection) return;
  stremioSyncInFlight = true;
  try {
    const users = await usersCollection
      .find(
        { stremioAuthKey: { $exists: true, $ne: null } },
        { projection: { _id: 1, stremioAuthKey: 1 } }
      )
      .toArray();
    if (!users.length) return;
    console.log(`[stremio-sync] tick: ${users.length} linked user(s)`);
    for (const u of users) {
      try {
        const result = await syncUserStremio(u);
        await recordStremioSync(u._id, true);
        if (result.pulled || result.pushed) {
          console.log(`[stremio-sync] ${u._id}: pulled=${result.pulled} pushed=${result.pushed}`);
        }
      } catch (err) {
        await recordStremioSync(u._id, false, err?.message).catch(() => {});
        console.warn(`[stremio-sync] ${u._id} failed:`, err?.message ?? err);
      }
      // Be polite to Stremio's API — small gap between users.
      await new Promise((r) => setTimeout(r, STREMIO_USER_GAP_MS));
    }
  } catch (err) {
    console.warn('[stremio-sync] tick failed:', err?.message ?? err);
  } finally {
    stremioSyncInFlight = false;
  }
}

function startStremioSyncCron() {
  if (stremioSyncInterval) return;
  // First tick a minute after boot so storage is warm; then every interval.
  setTimeout(() => { void runStremioSyncTick(); }, 60 * 1000);
  stremioSyncInterval = setInterval(() => { void runStremioSyncTick(); }, STREMIO_SYNC_INTERVAL_MS);
  console.log(`[stremio-sync] cron started — interval ${STREMIO_SYNC_INTERVAL_MS / 60000} min`);
}

// ---------- Direct messages -----------------------------------------------
//
// 1:1 chat between any two real users. Each message is a single doc;
// `pair` is the sorted (userId, userId) pair so reads collapse to a
// single indexed range scan regardless of direction.
//
// Conversations are classified into three "kinds" at read-time:
//
//   - accepted          → either you're friends OR both sides have
//                         sent at least one message
//   - requestIncoming   → the other side opened the thread, we're
//                         not friends, and you haven't replied yet
//   - requestOutgoing   → you opened the thread to a non-friend who
//                         hasn't replied yet
//
// Stored messages are identical in all cases — `kind` is purely a
// derived label so the sidebar can bucket them.

function isFriendOf(viewerId, otherId) {
  if (!friendsCollection) return Promise.resolve(false);
  return friendsCollection.findOne({
    status: 'accepted',
    $or: [
      { fromUserId: viewerId, toUserId: otherId },
      { fromUserId: otherId, toUserId: viewerId },
    ],
  }).then((doc) => Boolean(doc));
}

app.get('/dms/:userId', requireBlissfulAuth, async (req, res) => {
  if (!dmsCollection) {
    res.status(503).json({ error: 'DM storage unavailable' });
    return;
  }
  const me = req.user._id;
  const other = req.params.userId;
  if (other === me) {
    res.status(400).json({ error: 'Cannot DM yourself' });
    return;
  }
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const docs = await dmsCollection
      .find({ pair: dmPair(me, other) })
      .sort({ at: 1 })
      .limit(limit)
      .toArray();
    // Mark anything addressed to me as read.
    await dmsCollection.updateMany(
      { pair: dmPair(me, other), toUserId: me, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    res.json({
      messages: docs.map((d) => ({
        id: String(d._id),
        from: d.fromUserId,
        to: d.toUserId,
        text: d.text,
        at: d.at instanceof Date ? d.at.getTime() : d.at,
        read: Boolean(d.read),
      })),
    });
  } catch (err) {
    console.warn('[dms] read failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to read messages' });
  }
});

app.post('/dms/:userId', requireBlissfulAuth, async (req, res) => {
  if (!dmsCollection) {
    res.status(503).json({ error: 'DM storage unavailable' });
    return;
  }
  const me = req.user._id;
  const other = req.params.userId;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'Empty message' });
    return;
  }
  if (text.length > 2000) {
    res.status(400).json({ error: 'Message too long' });
    return;
  }
  if (other === me) {
    res.status(400).json({ error: 'Cannot DM yourself' });
    return;
  }
  // Anyone can message anyone — but the recipient must be a real
  // user. Friend-gating happens at read-time via the conversation
  // `kind`, not at the write boundary.
  if (usersCollection) {
    const exists = await usersCollection.findOne({ _id: other }, { projection: { _id: 1 } });
    if (!exists) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
  }
  try {
    const doc = {
      pair: dmPair(me, other),
      fromUserId: me,
      toUserId: other,
      text,
      at: new Date(),
      read: false,
    };
    const result = await dmsCollection.insertOne(doc);
    const serialized = {
      id: String(result.insertedId),
      from: doc.fromUserId,
      to: doc.toUserId,
      text: doc.text,
      at: doc.at.getTime(),
      read: false,
    };
    // Push to both sides: the recipient sees it instantly, and any
    // other tab the sender has open mirrors the new message without
    // waiting for a poll.
    const event = { t: 'dm:new', message: serialized };
    pushToUser(other, event);
    pushToUser(me, event);
    res.json(serialized);
  } catch (err) {
    console.warn('[dms] send failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to send' });
  }
});

// Lightweight digest: most-recent message per friend + unread count.
// Used by the sidebar Chats tab and by the unread badge.
app.get('/dms', requireBlissfulAuth, async (req, res) => {
  if (!dmsCollection) {
    res.status(503).json({ error: 'DM storage unavailable' });
    return;
  }
  const me = req.user._id;
  try {
    // Aggregate the latest message and the unread count per `pair`,
    // plus flags we need for classification: did *I* ever send in
    // this thread, and who sent the first message.
    const summaries = await dmsCollection.aggregate([
      { $match: { $or: [{ fromUserId: me }, { toUserId: me }] } },
      { $sort: { at: -1 } },
      {
        $group: {
          _id: '$pair',
          lastMessage: { $first: '$$ROOT' },
          firstFrom: { $last: '$fromUserId' },
          mySends: { $sum: { $cond: [{ $eq: ['$fromUserId', me] }, 1, 0] } },
          theirSends: { $sum: { $cond: [{ $ne: ['$fromUserId', me] }, 1, 0] } },
          unread: {
            $sum: { $cond: [{ $and: [{ $eq: ['$toUserId', me] }, { $eq: ['$read', false] }] }, 1, 0] },
          },
        },
      },
    ]).toArray();

    // Resolve the "other" userIds and pull display data + friend set.
    const others = new Set();
    for (const s of summaries) {
      const m = s.lastMessage;
      others.add(m.fromUserId === me ? m.toUserId : m.fromUserId);
    }
    const [userDocs, friendDocs] = await Promise.all([
      usersCollection
        ? usersCollection.find(
            { _id: { $in: [...others] } },
            { projection: { displayName: 1, username: 1, avatar: 1 } }
          ).toArray()
        : Promise.resolve([]),
      friendsCollection
        ? friendsCollection.find(
            {
              status: 'accepted',
              $or: [
                { fromUserId: me, toUserId: { $in: [...others] } },
                { toUserId: me, fromUserId: { $in: [...others] } },
              ],
            }
          ).toArray()
        : Promise.resolve([]),
    ]);
    const userById = new Map(userDocs.map((u) => [u._id, u]));
    const friendSet = new Set();
    for (const f of friendDocs) {
      friendSet.add(f.fromUserId === me ? f.toUserId : f.fromUserId);
    }

    res.json({
      conversations: summaries.map((s) => {
        const otherId = s.lastMessage.fromUserId === me ? s.lastMessage.toUserId : s.lastMessage.fromUserId;
        const other = userById.get(otherId);
        const isFriend = friendSet.has(otherId);
        // Accepted if we're friends OR both sides have spoken.
        let kind;
        if (isFriend || (s.mySends > 0 && s.theirSends > 0)) {
          kind = 'accepted';
        } else if (s.mySends > 0 && s.theirSends === 0) {
          kind = 'requestOutgoing';
        } else {
          kind = 'requestIncoming';
        }
        return {
          userId: otherId,
          displayName: other?.displayName || other?.username || 'Friend',
          avatar: other?.avatar ?? null,
          unread: s.unread,
          kind,
          lastMessage: {
            from: s.lastMessage.fromUserId,
            text: s.lastMessage.text,
            at: s.lastMessage.at instanceof Date ? s.lastMessage.at.getTime() : s.lastMessage.at,
          },
        };
      }),
    });
  } catch (err) {
    console.warn('[dms] summary failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to read conversations' });
  }
});

// Cross-conversation text search. Returns matches grouped by friend
// so the sidebar can render "Chat results" with the friend name.
app.get('/dms/search', requireBlissfulAuth, async (req, res) => {
  if (!dmsCollection) {
    res.status(503).json({ error: 'DM storage unavailable' });
    return;
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.json({ matches: [] });
    return;
  }
  const me = req.user._id;
  try {
    // Case-insensitive partial match. `$text` would need exact-word
    // tokens; the sidebar wants type-ahead, so a regex is friendlier.
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const docs = await dmsCollection
      .find({
        $or: [{ fromUserId: me }, { toUserId: me }],
        text: { $regex: escaped, $options: 'i' },
      })
      .sort({ at: -1 })
      .limit(30)
      .toArray();
    const others = new Set();
    for (const d of docs) others.add(d.fromUserId === me ? d.toUserId : d.fromUserId);
    const userDocs = usersCollection
      ? await usersCollection.find(
          { _id: { $in: [...others] } },
          { projection: { displayName: 1, username: 1, avatar: 1 } }
        ).toArray()
      : [];
    const userById = new Map(userDocs.map((u) => [u._id, u]));
    res.json({
      matches: docs.map((d) => {
        const otherId = d.fromUserId === me ? d.toUserId : d.fromUserId;
        const other = userById.get(otherId);
        return {
          id: String(d._id),
          friend: {
            userId: otherId,
            displayName: other?.displayName || other?.username || 'Friend',
            avatar: other?.avatar ?? null,
          },
          text: d.text,
          from: d.fromUserId,
          at: d.at instanceof Date ? d.at.getTime() : d.at,
        };
      }),
    });
  } catch (err) {
    console.warn('[dms] search failed:', err?.message ?? err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ---------- Presence + activity --------------------------------------------
//
// Every open tab POSTs /presence/heartbeat every ~30s. The body
// carries the user's current playback activity (optional) so friends
// can see "watching <title>" instead of just "online". Stale activity
// is filtered out at read-time (≥5 min since last heartbeat).

const HEARTBEAT_FRESH_MS = 75 * 1000;   // online if last seen within 75s

app.post('/presence/heartbeat', requireBlissfulAuth, async (req, res) => {
  if (!usersCollection) {
    res.status(503).json({ error: 'Auth storage unavailable' });
    return;
  }
  const now = new Date();
  const activity = req.body?.activity && typeof req.body.activity === 'object'
    ? {
        type: typeof req.body.activity.type === 'string' ? req.body.activity.type : null,
        id: typeof req.body.activity.id === 'string' ? req.body.activity.id : null,
        name: typeof req.body.activity.name === 'string' ? req.body.activity.name.slice(0, 200) : null,
        videoId: typeof req.body.activity.videoId === 'string' ? req.body.activity.videoId : null,
        at: now.getTime(),
      }
    : null;
  try {
    await usersCollection.updateOne(
      { _id: req.user._id },
      { $set: { lastSeenAt: now, currentActivity: activity } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.warn('[presence] heartbeat failed:', err?.message ?? err);
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// Bulk presence for a list of userIds. Returns `online` + optional
// `activity` per user. Used by the friends sidebar.
app.post('/presence/lookup', requireBlissfulAuth, async (req, res) => {
  if (!usersCollection) {
    res.status(503).json({ error: 'Auth storage unavailable' });
    return;
  }
  const ids = Array.isArray(req.body?.userIds) ? req.body.userIds.filter((v) => typeof v === 'string') : [];
  if (ids.length === 0) {
    res.json({ users: [] });
    return;
  }
  try {
    const docs = await usersCollection
      .find({ _id: { $in: ids } }, { projection: { lastSeenAt: 1, currentActivity: 1 } })
      .toArray();
    const byId = new Map(docs.map((d) => [d._id, d]));
    res.json({
      users: ids.map((requestedId) => {
        const d = byId.get(requestedId);
        if (!d) {
          return { userId: requestedId, online: false, lastSeenAt: null, activity: null };
        }
        const lastSeen = d.lastSeenAt instanceof Date ? d.lastSeenAt.getTime() : null;
        // "Online" is whether the user has an active /ws/user socket
        // right now — WebSockets stay connected through pause / tab
        // throttling, so this beats the heartbeat-age check.
        const online = userSockets.has(d._id);
        const rawActivity = d.currentActivity ?? null;
        return {
          userId: requestedId,
          online,
          lastSeenAt: lastSeen,
          activity: online ? rawActivity : null,
        };
      }),
    });
  } catch (err) {
    console.warn('[presence] lookup failed:', err?.message ?? err);
    res.status(500).json({ error: 'Presence lookup failed' });
  }
});

// ---------- User search ----------------------------------------------------
// Fuzzy match against displayName and username. Excludes the caller. Top 10.
// Email is no longer matched or returned — it's a private contact
// detail now that username is the public handle.

app.get('/users/search', requireBlissfulAuth, async (req, res) => {
  if (!usersCollection) {
    res.status(503).json({ error: 'Auth storage unavailable' });
    return;
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q || q.length < 1) {
    res.json({ users: [] });
    return;
  }
  try {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const docs = await usersCollection
      .find({
        _id: { $ne: req.user._id },
        $or: [
          { displayName: { $regex: escaped, $options: 'i' } },
          { username: { $regex: escaped, $options: 'i' } },
        ],
      })
      .project({ displayName: 1, username: 1, avatar: 1 })
      .limit(10)
      .toArray();
    res.json({
      users: docs.map((u) => ({
        id: u._id,
        displayName: u.displayName || u.username || 'User',
        username: u.username ?? null,
        avatar: u.avatar ?? null,
      })),
    });
  } catch (err) {
    console.warn('[users] search failed:', err?.message ?? err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ---------- Friends --------------------------------------------------------
//
// Two-way friendship: a request is a single document with status
// 'pending'. The recipient flips it to 'accepted' (or declines, which
// deletes it). We store each side's displayName in the document so the
// other party can render the friend without an extra lookup.

function serializeFriendDoc(doc, viewerUserId) {
  // Normalize the doc into a viewer-relative shape: who *they* see.
  const isOutgoing = doc.fromUserId === viewerUserId;
  const otherUserId = isOutgoing ? doc.toUserId : doc.fromUserId;
  const otherDisplayName = isOutgoing ? doc.toDisplayName : doc.fromDisplayName;
  // Per-viewer nickname overrides — stored in a `nicknames` map keyed
  // by the viewer's userId so each side gets their own.
  const nickname = doc.nicknames?.[viewerUserId] ?? null;
  return {
    id: String(doc._id),
    userId: otherUserId,
    displayName: nickname || otherDisplayName || 'Friend',
    realName: otherDisplayName || null,
    nickname,
    status: doc.status,
    direction: isOutgoing ? 'outgoing' : 'incoming',
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.getTime() : doc.createdAt,
  };
}

app.get('/friends', requireBlissfulAuth, async (req, res) => {
  if (!friendsCollection) {
    res.status(503).json({ error: 'Friends storage unavailable' });
    return;
  }
  try {
    const userId = req.user._id;
    const docs = await friendsCollection
      .find({ $or: [{ fromUserId: userId }, { toUserId: userId }] })
      .sort({ createdAt: -1 })
      .toArray();
    // Pull the live displayName for every "other side" of these
    // edges. The names cached on the friend doc are stale whenever the
    // friend has updated their profile since the request was made, so
    // we override with the current user record where one exists.
    const otherIds = new Set();
    for (const doc of docs) {
      otherIds.add(doc.fromUserId === userId ? doc.toUserId : doc.fromUserId);
    }
    const liveUsers = usersCollection
      ? await usersCollection
          .find({ _id: { $in: [...otherIds] } }, { projection: { displayName: 1, username: 1 } })
          .toArray()
      : [];
    const nameByUserId = new Map();
    for (const u of liveUsers) {
      nameByUserId.set(u._id, u.displayName || u.username || null);
    }
    const out = { friends: [], incoming: [], outgoing: [] };
    for (const doc of docs) {
      const serialized = serializeFriendDoc(doc, userId);
      const fresh = nameByUserId.get(serialized.userId);
      // Refresh the friend's *real* name from the live user record so
      // it tracks profile renames. Do NOT touch displayName when a
      // nickname is set — the viewer's override always wins.
      if (fresh) {
        serialized.realName = fresh;
        if (!serialized.nickname) serialized.displayName = fresh;
      }
      if (serialized.status === 'accepted') out.friends.push(serialized);
      else if (serialized.direction === 'incoming') out.incoming.push(serialized);
      else out.outgoing.push(serialized);
    }
    res.json(out);
  } catch (err) {
    console.warn('[friends] list failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to read friends' });
  }
});

app.post('/friends/request', requireBlissfulAuth, async (req, res) => {
  if (!friendsCollection) {
    res.status(503).json({ error: 'Friends storage unavailable' });
    return;
  }
  const toUserId = typeof req.body?.toUserId === 'string' ? req.body.toUserId.trim() : '';
  const toDisplayName = typeof req.body?.toDisplayName === 'string' ? req.body.toDisplayName.trim() : '';
  const fromDisplayName = typeof req.body?.fromDisplayName === 'string' ? req.body.fromDisplayName.trim() : '';
  if (!toUserId) {
    res.status(400).json({ error: 'Missing toUserId' });
    return;
  }
  try {
    const { _id: userId, displayName, username } = req.user;
    if (toUserId === userId) {
      res.status(400).json({ error: "Can't befriend yourself" });
      return;
    }
    // If the other person already sent us a request, accept it instead
    // of creating a duplicate edge.
    const inbound = await friendsCollection.findOne({ fromUserId: toUserId, toUserId: userId });
    if (inbound) {
      if (inbound.status === 'accepted') {
        res.json({ ok: true, already: true });
        return;
      }
      await friendsCollection.updateOne(
        { _id: inbound._id },
        { $set: { status: 'accepted', acceptedAt: new Date() } }
      );
      res.json({ ok: true, accepted: true });
      return;
    }
    await friendsCollection.updateOne(
      { fromUserId: userId, toUserId },
      {
        $setOnInsert: {
          fromUserId: userId,
          toUserId,
          fromDisplayName: fromDisplayName || displayName || username || 'Someone',
          toDisplayName: toDisplayName || 'Friend',
          status: 'pending',
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.warn('[friends] request failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

app.post('/friends/:id/accept', requireBlissfulAuth, async (req, res) => {
  if (!friendsCollection) {
    res.status(503).json({ error: 'Friends storage unavailable' });
    return;
  }
  let oid;
  try {
    const { ObjectId } = await import('mongodb');
    oid = new ObjectId(req.params.id);
  } catch {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  try {
    const userId = req.user._id;
    const doc = await friendsCollection.findOne({ _id: oid });
    if (!doc) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    // Only the recipient (toUserId) can accept.
    if (doc.toUserId !== userId) {
      res.status(403).json({ error: 'Not your request' });
      return;
    }
    await friendsCollection.updateOne(
      { _id: oid },
      { $set: { status: 'accepted', acceptedAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.warn('[friends] accept failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to accept' });
  }
});

// Per-viewer nickname override for an accepted friend. Stored as a
// map on the friend edge keyed by the viewer's userId, so each side
// can rename the other independently.
app.patch('/friends/:id/nickname', requireBlissfulAuth, async (req, res) => {
  if (!friendsCollection) {
    res.status(503).json({ error: 'Friends storage unavailable' });
    return;
  }
  let oid;
  try {
    const { ObjectId } = await import('mongodb');
    oid = new ObjectId(req.params.id);
  } catch {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const raw = req.body?.nickname;
  // Empty string / null both clear the override.
  const nickname = typeof raw === 'string' ? raw.trim().slice(0, 60) : null;
  try {
    const userId = req.user._id;
    const doc = await friendsCollection.findOne({ _id: oid });
    if (!doc) {
      res.status(404).json({ error: 'Friend not found' });
      return;
    }
    if (doc.fromUserId !== userId && doc.toUserId !== userId) {
      res.status(403).json({ error: 'Not your friend edge' });
      return;
    }
    const update = nickname
      ? { $set: { [`nicknames.${userId}`]: nickname } }
      : { $unset: { [`nicknames.${userId}`]: '' } };
    await friendsCollection.updateOne({ _id: oid }, update);
    res.json({ ok: true, nickname: nickname || null });
  } catch (err) {
    console.warn('[friends] nickname update failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to update nickname' });
  }
});

app.delete('/friends/:id', requireBlissfulAuth, async (req, res) => {
  // Used for: decline incoming, cancel outgoing, remove accepted.
  if (!friendsCollection) {
    res.status(503).json({ error: 'Friends storage unavailable' });
    return;
  }
  let oid;
  try {
    const { ObjectId } = await import('mongodb');
    oid = new ObjectId(req.params.id);
  } catch {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  try {
    const userId = req.user._id;
    const result = await friendsCollection.deleteOne({
      _id: oid,
      $or: [{ fromUserId: userId }, { toUserId: userId }],
    });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.warn('[friends] delete failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ---------- Friend profile -------------------------------------------------
//
// Powers the in-app Profile page: a friend's public identity plus what
// they've been watching lately. Friends-only (or self) — same privacy
// model as presence (you already see a friend's "watching now"); this
// just adds recent history for accepted friends.
//
// History is derived from the friend's own `library` rows that carry
// playback progress (state.timeOffset > 0), newest first by
// state.lastWatched. That's exactly their Continue-Watching surface,
// so no separate history store is needed. Ghost rows (removed/temp)
// are intentionally included — they represent watched titles the
// friend never explicitly bookmarked; rows the friend removed from CW
// are hard-deleted upstream, so they never show here.

function toEpochMs(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

app.get('/users/:userId/profile', requireBlissfulAuth, async (req, res) => {
  if (!usersCollection) {
    res.status(503).json({ error: 'Auth storage unavailable' });
    return;
  }
  const me = req.user._id;
  const targetId = req.params.userId;
  const isSelf = targetId === me;
  if (!isSelf && !(await isFriendOf(me, targetId))) {
    // Don't leak existence — a non-friend is told the same thing
    // whether or not the account exists.
    res.status(403).json({ error: 'You can only view friends’ profiles.' });
    return;
  }
  try {
    const user = await usersCollection.findOne(
      { _id: targetId },
      { projection: { displayName: 1, username: 1, avatar: 1, createdAt: 1, currentActivity: 1, lastSeenAt: 1 } }
    );
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    // Online = active /ws/user socket right now (same signal presence uses).
    const online = userSockets.has(targetId);

    let history = [];
    if (libraryCollection) {
      const docs = await libraryCollection
        .find({ userId: targetId, 'state.timeOffset': { $gt: 0 } })
        .sort({ 'state.lastWatched': -1 })
        .limit(40)
        .toArray();
      history = docs.map((d) => {
        const st = d.state ?? {};
        return {
          id: d.id ?? null,
          type: typeof d.type === 'string' ? d.type : null,
          name: typeof d.name === 'string' ? d.name : null,
          poster: typeof d.poster === 'string' ? d.poster : null,
          videoId: typeof st.video_id === 'string' ? st.video_id : null,
          lastWatched: toEpochMs(st.lastWatched) ?? toEpochMs(d._mtime),
          timeOffset: typeof st.timeOffset === 'number' ? st.timeOffset : 0,
          duration: typeof st.duration === 'number' ? st.duration : 0,
        };
      }).filter((h) => h.id);
    }

    res.json({
      profile: {
        id: user._id,
        displayName: user.displayName || user.username || 'Friend',
        username: user.username ?? null,
        avatar: user.avatar ?? null,
        createdAt: toEpochMs(user.createdAt),
      },
      online,
      lastSeenAt: toEpochMs(user.lastSeenAt),
      // Only expose what they're watching while they're actually online,
      // mirroring /presence/lookup's behaviour.
      currentActivity: online ? (user.currentActivity ?? null) : null,
      history,
    });
  } catch (err) {
    console.warn('[profile] read failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to read profile' });
  }
});

const httpServer = http.createServer(app);
// Both WS servers run on the same httpServer. `ws` only wires up one
// path automatically — for multiple endpoints we have to use
// `noServer: true` and dispatch the HTTP `upgrade` event by pathname.
const wss = new WebSocketServer({ noServer: true });

// -- Per-user push socket (DMs, friend events) -----------------------------
//
// One WS per signed-in tab. First client message must be
//   { t: 'auth', token: '<JWT>' }
// On success the socket is added to `userSockets[userId]` so the
// REST endpoints can fan messages out. Closed sockets are pruned
// automatically; the client reconnects with backoff.

const userWss = new WebSocketServer({ noServer: true });

// Single upgrade handler routes by pathname to the right WSS.
httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/ws/room') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (url.pathname === '/ws/user') {
    userWss.handleUpgrade(req, socket, head, (ws) => userWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
const userSockets = new Map(); // userId → Set<ws>

function attachUserSocket(userId, ws) {
  let set = userSockets.get(userId);
  if (!set) {
    set = new Set();
    userSockets.set(userId, set);
  }
  set.add(ws);
  ws.on('close', () => {
    set.delete(ws);
    if (set.size === 0) userSockets.delete(userId);
  });
}

function pushToUser(userId, payload) {
  const set = userSockets.get(userId);
  if (!set || set.size === 0) {
    console.log(`[user-ws] push to ${userId}: no sockets, skipped`);
    return;
  }
  const text = JSON.stringify(payload);
  let sent = 0;
  for (const ws of set) {
    if (ws.readyState === 1) {
      try { ws.send(text); sent++; } catch { /* socket likely dying, will be pruned on close */ }
    }
  }
  console.log(`[user-ws] pushed ${payload.t} to ${userId} (${sent}/${set.size} sockets)`);
}

userWss.on('connection', (ws) => {
  console.log('[user-ws] connection opened');
  let authedUserId = null;
  // 5s grace: if the first message isn't a valid auth, drop the
  // connection. Prevents anonymous sockets from hanging around.
  const authTimer = setTimeout(() => {
    if (!authedUserId) {
      console.log('[user-ws] auth timeout, closing');
      ws.close(4001, 'auth timeout');
    }
  }, 5000);
  ws.on('message', async (raw) => {
    if (authedUserId) return; // post-auth messages are ignored — this WS is push-only
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.t !== 'auth' || typeof msg.token !== 'string') return;
    try {
      const payload = jwt.verify(msg.token, JWT_SECRET);
      if (!payload || typeof payload.sub !== 'string') {
        console.log('[user-ws] auth failed (no sub)');
        ws.close(4003, 'auth failed');
        return;
      }
      authedUserId = payload.sub;
      clearTimeout(authTimer);
      attachUserSocket(authedUserId, ws);
      ws.send(JSON.stringify({ t: 'ready' }));
      // The socket itself is the "online" signal — refresh lastSeenAt
      // on open so any stale value gets clobbered. Browsers keep WS
      // connections alive even in background tabs, so this stays
      // accurate when the heartbeat interval would otherwise throttle.
      if (usersCollection) {
        usersCollection.updateOne({ _id: authedUserId }, { $set: { lastSeenAt: new Date() } })
          .catch((err) => console.warn('[user-ws] open-side lastSeen update failed:', err?.message ?? err));
      }
      console.log(`[user-ws] authed userId=${authedUserId} (sockets for this user: ${userSockets.get(authedUserId)?.size ?? 0})`);
    } catch (err) {
      console.log('[user-ws] auth failed:', err?.message ?? err);
      ws.close(4003, 'auth failed');
    }
  });
  ws.on('close', (code, reason) => {
    console.log(`[user-ws] closed userId=${authedUserId ?? '<unauthed>'} code=${code} reason=${reason}`);
    // On final close (no remaining sockets for the user), stamp a
    // fresh lastSeenAt so the "last seen" label is accurate.
    if (authedUserId && usersCollection && !userSockets.has(authedUserId)) {
      usersCollection.updateOne({ _id: authedUserId }, { $set: { lastSeenAt: new Date() } })
        .catch((err) => console.warn('[user-ws] close-side lastSeen update failed:', err?.message ?? err));
    }
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let participant = null;
  let room = null;

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    // First message must be `join` — establishes identity + room.
    if (!participant) {
      if (msg.t !== 'join' || typeof msg.code !== 'string') {
        ws.send(JSON.stringify({ t: 'error', code: 'protocol', message: 'first message must be join' }));
        ws.close(4001, 'protocol');
        return;
      }
      // Blissful JWT (preferred) or guestId.
      const providedToken = typeof msg.token === 'string' && msg.token.length > 0 ? msg.token : null;
      const hasAuth = Boolean(providedToken);
      const hasGuestId = typeof msg.guestId === 'string' && msg.guestId.trim().length >= 8;
      if (!hasAuth && !hasGuestId) {
        ws.send(JSON.stringify({ t: 'error', code: 'auth', message: 'auth or guestId required' }));
        ws.close(4001, 'no auth');
        return;
      }
      const target = await getRoomCached(msg.code);
      if (!target) {
        ws.send(JSON.stringify({ t: 'error', code: 'no-room', message: 'room not found' }));
        ws.close(4004, 'no room');
        return;
      }
      if (target.passwordHash) {
        const provided = typeof msg.password === 'string' ? msg.password.trim() : '';
        if (!provided) {
          ws.send(JSON.stringify({ t: 'error', code: 'password-required', message: 'password required' }));
          ws.close(4005, 'password required');
          return;
        }
        if (hashPartyPassword(provided) !== target.passwordHash) {
          ws.send(JSON.stringify({ t: 'error', code: 'password-incorrect', message: 'incorrect password' }));
          ws.close(4006, 'incorrect password');
          return;
        }
      }
      try {
        let userId;
        if (hasAuth) {
          // Verify Blissful JWT and look up the user.
          let payload;
          try {
            payload = jwt.verify(providedToken, JWT_SECRET);
          } catch {
            ws.send(JSON.stringify({ t: 'error', code: 'auth', message: 'invalid token' }));
            ws.close(4003, 'auth failed');
            return;
          }
          if (!payload || typeof payload.sub !== 'string') {
            ws.send(JSON.stringify({ t: 'error', code: 'auth', message: 'invalid token' }));
            ws.close(4003, 'auth failed');
            return;
          }
          userId = payload.sub;
        } else {
          userId = `guest:${msg.guestId.trim().slice(0, 64)}`;
        }
        const existing = target.participants.get(userId);
        if (existing && existing.ws !== ws && existing.ws.readyState === 1) {
          // Replace prior connection for the same user (refresh / reconnect).
          existing.ws.close(4002, 'replaced');
        }
        const displayName = typeof msg.displayName === 'string' && msg.displayName.trim()
          ? msg.displayName.trim().slice(0, 64)
          : 'Guest';
        participant = {
          ws,
          userId,
          displayName,
          joinedAt: existing?.joinedAt ?? Date.now(),
          lastSeen: Date.now(),
        };
        room = target;
        // Cancel any pending empty-destroy timer — someone's back.
        cancelEmptyDestroy(room);
        room.participants.set(userId, participant);
        // The original host reconnected during the migration grace (e.g. a
        // refresh) → keep them as host, don't promote anyone.
        if (room.hostUserId === userId) cancelHostMigration(room);
        // If the host slot is vacant (room was rehydrated from Mongo
        // after a crash, or the original host left without a
        // successor), promote this joiner. Persist so subsequent
        // rehydrations remember the new host.
        if (!room.participants.has(room.hostUserId) || room.hostUserId === userId) {
          // Either the original host isn't here OR we ARE the
          // original host returning — set the snapshot field
          // either way so the client renders correctly.
          if (room.hostUserId !== userId && !room.participants.has(room.hostUserId)) {
            room.hostUserId = userId;
            await persistRoom(room);
          }
        }
        // `self.userId` so the client knows which participant in the
        // snapshot is them (used for host-vs-guest UI gating).
        ws.send(JSON.stringify({ t: 'room', self: { userId, displayName }, ...serializeRoom(room) }));
        broadcast(
          room,
          { t: 'presence', kind: 'joined', userId, displayName },
          ws
        );
        console.log(`[watch-party] ${userId} joined ${room.code} (${room.participants.size} total)`);
      } catch (err) {
        ws.send(JSON.stringify({ t: 'error', code: 'auth', message: 'auth failed' }));
        ws.close(4003, 'auth failed');
      }
      return;
    }

    participant.lastSeen = Date.now();

    // Host-only messages: drift-correction tick and episode advance
    // stay with the host so they don't fight each other.
    if (msg.t === 'host:tick' || msg.t === 'host:episode') {
      if (participant.userId !== room.hostUserId) return;
      const sentAt = Date.now();
      if (msg.t === 'host:tick') {
        const currentTime = Number(msg.currentTime);
        if (!Number.isFinite(currentTime)) return;
        room.lastTick = { currentTime, isPlaying: !!msg.isPlaying, at: sentAt };
        broadcast(room, { t: 'tick', currentTime, isPlaying: !!msg.isPlaying, sentAt }, ws);
      } else {
        const videoId = typeof msg.videoId === 'string' && msg.videoId.trim() ? msg.videoId.trim() : null;
        room.videoId = videoId;
        room.lastTick = null;
        // New episode → the previous RD stream + subtitle choice + content
        // source no longer apply. Clear so a guest joining mid-change doesn't
        // get stale state.
        room.streamUrl = null;
        room.subtitleLang = null;
        room.source = null;
        // Persist so a guest who joins after a crash lands on the
        // current episode rather than where the room started.
        persistRoom(room).catch(() => {});
        broadcast(room, { t: 'episode', videoId });
      }
    } else if (msg.t === 'host:stream') {
      // Host announces (or clears) its Real-Debrid fallback URL so guests load
      // the same torrent. Host-only; stored as room state for late joiners.
      if (participant.userId !== room.hostUserId) return;
      const streamUrl = typeof msg.streamUrl === 'string' && msg.streamUrl.trim() ? msg.streamUrl.trim() : null;
      room.streamUrl = streamUrl;
      persistRoom(room).catch(() => {});
      broadcast(room, { t: 'stream', streamUrl }, ws);
    } else if (msg.t === 'host:subs') {
      // Host announces its subtitle language (or off) so guests match it.
      if (participant.userId !== room.hostUserId) return;
      const lang = typeof msg.lang === 'string' && msg.lang.trim() ? msg.lang.trim() : null;
      room.subtitleLang = lang;
      persistRoom(room).catch(() => {});
      broadcast(room, { t: 'subs', lang }, ws);
    } else if (msg.t === 'host:source') {
      // Watch-party v2: host announces the platform-neutral content identity
      // (torrent infohash / RD url / vidking tmdb / relay) so guests resolve
      // the SAME file. Host-only; stored for late joiners; cleared on episode
      // change. See docs/WATCH-PARTY-V2.md.
      if (participant.userId !== room.hostUserId) return;
      const source = sanitizeWatchPartySource(msg.source);
      room.source = source;
      persistRoom(room).catch(() => {});
      broadcast(room, { t: 'source', source }, ws);
    } else if (msg.t === 'party:request-host-stream') {
      // Layer B: a guest asks the host to relay its exact stream. Route to the
      // host only, stamped with who's asking, so the host shows a consent
      // prompt. Acceptance is just the host announcing a `relay` source (above).
      if (participant.userId === room.hostUserId) return;
      const host = room.participants.get(room.hostUserId);
      if (host && host.ws && host.ws.readyState === 1) {
        try {
          host.ws.send(JSON.stringify({
            t: 'party:host-stream-request',
            from: { userId: participant.userId, displayName: participant.displayName },
          }));
        } catch { /* host socket closed between check and send */ }
      }
    } else if (msg.t === 'party:decline-host-stream') {
      // Layer B: the host declines a specific guest's request — deliver the
      // rejection to that guest so it keeps its own fallback. Host-only.
      if (participant.userId !== room.hostUserId) return;
      const targetUserId = typeof msg.targetUserId === 'string' ? msg.targetUserId : null;
      const target = targetUserId ? room.participants.get(targetUserId) : null;
      if (target && target.ws && target.ws.readyState === 1) {
        try {
          target.ws.send(JSON.stringify({ t: 'party:host-stream-declined' }));
        } catch { /* guest socket closed between check and send */ }
      }
    } else if (msg.t === 'buffering') {
      // "Buffer until everybody loads" gate. Track who is buffering; whenever the
      // aggregate flips, broadcast the gate so everyone holds/resumes together.
      if (!room.bufferingUsers) room.bufferingUsers = new Set();
      const before = room.bufferingUsers.size > 0;
      if (msg.waiting) room.bufferingUsers.add(participant.userId);
      else room.bufferingUsers.delete(participant.userId);
      const after = room.bufferingUsers.size > 0;
      if (before !== after) broadcast(room, { t: 'gate', waiting: after });
    } else if (msg.t === 'event') {
      // Anyone in the room can pause / play / seek now — last write
      // wins. Server tags the broadcast with `from` so clients can
      // surface a "X paused" indicator without having to correlate
      // it themselves.
      const currentTime = Number(msg.currentTime);
      if (!Number.isFinite(currentTime)) return;
      if (msg.kind !== 'play' && msg.kind !== 'pause' && msg.kind !== 'seek') return;
      const sentAt = Date.now();
      const isPlaying = msg.kind === 'play'
        ? true
        : msg.kind === 'pause'
          ? false
          : (room.lastTick?.isPlaying ?? true);
      room.lastTick = { currentTime, isPlaying, at: sentAt };
      broadcast(
        room,
        {
          t: 'event',
          kind: msg.kind,
          currentTime,
          sentAt,
          from: { userId: participant.userId, displayName: participant.displayName },
        },
        ws
      );
    } else if (msg.t === 'typing') {
      // Lightweight ping — relayed to everyone else so they can
      // render a "X is typing…" indicator in their chat tab.
      broadcast(
        room,
        {
          t: 'typing',
          from: { userId: participant.userId, displayName: participant.displayName },
        },
        ws
      );
    } else if (msg.t === 'chat') {
      const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 500) : '';
      if (!text) return;
      const message = {
        from: { userId: participant.userId, displayName: participant.displayName },
        text,
        at: Date.now(),
      };
      // Persist into the room buffer so refreshes / late joiners
      // get the history in their room snapshot.
      room.chat = (room.chat ?? []).concat(message);
      if (room.chat.length > MAX_CHAT_HISTORY) {
        room.chat = room.chat.slice(-MAX_CHAT_HISTORY);
      }
      persistRoom(room).catch(() => {});
      broadcast(room, { t: 'chat', ...message });
    } else if (msg.t === 'chat:react') {
      // Reactions are stored on the room (so refreshes preserve
      // them) AND fanned out to other clients so they can update
      // their optimistic local state.
      const messageKey = typeof msg.messageKey === 'string' ? msg.messageKey.slice(0, 200) : '';
      const emoji = typeof msg.emoji === 'string' ? msg.emoji.slice(0, 16) : '';
      const kind = msg.kind === 'remove' ? 'remove' : 'add';
      if (!messageKey || !emoji) return;
      room.reactions = room.reactions ?? {};
      const messageMap = { ...(room.reactions[messageKey] ?? {}) };
      const list = messageMap[emoji] ?? [];
      const has = list.includes(participant.userId);
      if (kind === 'add' && !has) {
        messageMap[emoji] = [...list, participant.userId];
      } else if (kind === 'remove' && has) {
        const next = list.filter((u) => u !== participant.userId);
        if (next.length === 0) delete messageMap[emoji];
        else messageMap[emoji] = next;
      } else {
        return; // no-op (e.g. duplicate add from the same user)
      }
      if (Object.keys(messageMap).length === 0) {
        const { [messageKey]: _drop, ...rest } = room.reactions;
        void _drop;
        room.reactions = rest;
      } else {
        room.reactions = { ...room.reactions, [messageKey]: messageMap };
      }
      persistRoom(room).catch(() => {});
      broadcast(
        room,
        {
          t: 'reaction',
          messageKey,
          emoji,
          kind,
          from: { userId: participant.userId, displayName: participant.displayName },
        },
        ws
      );
    } else if (msg.t === 'host:transfer') {
      // Only the current host can hand the crown off, and only to
      // a participant who's actually in the room.
      if (participant.userId !== room.hostUserId) return;
      const target = typeof msg.targetUserId === 'string' ? msg.targetUserId : null;
      if (!target || target === room.hostUserId) return;
      const next = room.participants.get(target);
      if (!next) return;
      room.hostUserId = target;
      persistRoom(room);
      broadcast(room, {
        t: 'presence',
        kind: 'host-changed',
        userId: next.userId,
        displayName: next.displayName,
        hostUserId: next.userId,
      });
    } else if (msg.t === 'leave') {
      ws.close(1000, 'left');
    }
  });

  ws.on('close', () => {
    if (!participant || !room) return;
    // If a newer connection took over for the same user, leave it alone.
    if (room.participants.get(participant.userId)?.ws !== ws) return;
    room.participants.delete(participant.userId);
    // Drop them from the buffering gate so a disconnect-while-buffering doesn't
    // hold the room forever; re-broadcast if that opens the gate.
    if (room.bufferingUsers?.has(participant.userId)) {
      room.bufferingUsers.delete(participant.userId);
      if (room.bufferingUsers.size === 0) broadcast(room, { t: 'gate', waiting: false });
    }

    if (room.participants.size === 0) {
      // Don't destroy synchronously — give refreshing clients ~15s
      // to reconnect (their `?room=` URL would otherwise hit a
      // "Room not found" error). After the grace window with no
      // participants, the room is gone from both memory and Mongo.
      console.log(`[watch-party] room ${room.code} empty — destroying in ${ROOM_EMPTY_GRACE_MS / 1000}s`);
      scheduleEmptyDestroy(room);
      return;
    }

    // Host left — but they're often just refreshing. Wait the grace window
    // before promoting a successor; if they reconnect, they keep the crown.
    if (room.hostUserId === participant.userId) {
      scheduleHostMigration(room);
    }
    broadcast(room, { t: 'presence', kind: 'left', userId: participant.userId, displayName: participant.displayName });
  });
});

// Heartbeat: terminate dead sockets so empty rooms get cleaned up even if
// the client never sent a clean close (mobile background tab, etc.).
const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      // Socket may already be closing.
    }
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeatInterval));

initializeStorage()
  .then(() => {
    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`Blissful storage listening on 0.0.0.0:${port}`);
      console.log(`WebSocket watch-party endpoint at /ws/room`);
      console.log(`WebSocket user push endpoint at /ws/user`);
      console.log(`Using MongoDB: ${mongodbUri.replace(/:[^:@/]+@/, ':***@')}`);
      console.log(`Using database: ${mongodbDb}`);
    });
    startStremioSyncCron();
    startRoomReaper();
  })
  .catch((err) => {
    console.error('Failed to initialize storage service:', err);
    process.exit(1);
  });
