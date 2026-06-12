// REST client for Blissful's native auth + library/CW endpoints.
// This is the only source of truth — Stremio's API and the
// per-account Stremio session are no longer used.

import { getStorageBaseUrl } from './adapters';

export type BlissfulUser = {
  id: string;
  /** Primary login handle. Lowercase a-z 0-9 _ -. Required on accounts
   *  created via the new flow; backfilled from displayName for legacy
   *  email-only accounts. Null only on a malformed response. */
  username: string | null;
  /** Kept on legacy docs (registered under the old email-only flow)
   *  so those users can still log in with their email until they
   *  pick a different identifier. New accounts don't collect one. */
  email: string | null;
  displayName: string | null;
  avatar: string | null;
  createdAt: number;
};

export type AuthResponse = {
  token: string;
  user: BlissfulUser;
};

async function request<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(`${getStorageBaseUrl()}${path}`, { ...init, headers });
  if (!res.ok) {
    let message = `${path} failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      // body wasn't JSON
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function registerBlissfulAccount(args: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

// `identifier` is the username OR (for legacy accounts) the email.
// The server picks the lookup based on whether the value contains "@".
export async function loginBlissfulAccount(args: {
  identifier: string;
  password: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

export async function fetchCurrentBlissfulUser(token: string): Promise<BlissfulUser | null> {
  try {
    const result = await request<{ user: BlissfulUser }>('/auth/me', {}, token);
    return result.user;
  } catch {
    return null;
  }
}

export async function updateCurrentBlissfulUser(
  token: string,
  updates: { username?: string; displayName?: string; avatar?: string | null }
): Promise<BlissfulUser> {
  const result = await request<{ user: BlissfulUser }>(
    '/auth/me',
    { method: 'PATCH', body: JSON.stringify(updates) },
    token
  );
  return result.user;
}

// --- Library / Continue-watching ----------------------------------------

export async function importLibraryItems(token: string, items: unknown[]): Promise<{ imported: number; total: number }> {
  const result = await request<{ ok: true; imported: number; total: number }>(
    '/library/import',
    { method: 'POST', body: JSON.stringify({ items }) },
    token
  );
  return { imported: result.imported, total: result.total };
}

export async function fetchBlissfulLibrary<T = unknown>(token: string): Promise<T[]> {
  const result = await request<{ items: T[] }>('/library', {}, token);
  return result.items;
}

export async function putBlissfulLibraryItem(token: string, id: string, item: unknown): Promise<void> {
  await request(`/library/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(item),
  }, token);
}

export async function deleteBlissfulLibraryItem(token: string, id: string): Promise<void> {
  await request(`/library/${encodeURIComponent(id)}`, { method: 'DELETE' }, token);
}

// --- Direct messages ----------------------------------------------------

export type DmMessage = {
  id: string;
  from: string;
  to: string;
  text: string;
  at: number;
  read: boolean;
};

export type DmConversation = {
  userId: string;
  displayName: string;
  avatar: string | null;
  unread: number;
  /** Server-derived bucket:
   *  - 'accepted'        — friends, or both sides have replied
   *  - 'requestIncoming' — they messaged first, no reply from me yet
   *  - 'requestOutgoing' — I messaged first, no reply yet */
  kind: 'accepted' | 'requestIncoming' | 'requestOutgoing';
  lastMessage: { from: string; text: string; at: number };
};

export type DmSearchHit = {
  id: string;
  friend: { userId: string; displayName: string; avatar: string | null };
  text: string;
  from: string;
  at: number;
};

export async function fetchDmThread(token: string, friendUserId: string): Promise<DmMessage[]> {
  const result = await request<{ messages: DmMessage[] }>(
    `/dms/${encodeURIComponent(friendUserId)}`,
    {},
    token
  );
  return result.messages;
}

export async function sendDm(token: string, friendUserId: string, text: string): Promise<DmMessage> {
  return request<DmMessage>(
    `/dms/${encodeURIComponent(friendUserId)}`,
    { method: 'POST', body: JSON.stringify({ text }) },
    token
  );
}

export async function fetchDmConversations(token: string): Promise<DmConversation[]> {
  const result = await request<{ conversations: DmConversation[] }>('/dms', {}, token);
  return result.conversations;
}

export async function searchDms(token: string, query: string): Promise<DmSearchHit[]> {
  const result = await request<{ matches?: DmSearchHit[] }>(
    `/dms/search?q=${encodeURIComponent(query)}`,
    {},
    token
  );
  // Server can omit the key when there are zero results — fall back
  // to an empty array so callers never see `undefined`.
  return result.matches ?? [];
}

// --- Presence -----------------------------------------------------------

export type PresenceActivity = {
  type: string | null;
  id: string | null;
  name: string | null;
  videoId: string | null;
};

export type PresenceRecord = {
  userId: string;
  online: boolean;
  lastSeenAt: number | null;
  activity: (PresenceActivity & { at: number }) | null;
};

export async function postHeartbeat(token: string, activity: PresenceActivity | null): Promise<void> {
  await request('/presence/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ activity }),
  }, token);
}

export async function lookupPresence(token: string, userIds: string[]): Promise<PresenceRecord[]> {
  if (userIds.length === 0) return [];
  const result = await request<{ users: PresenceRecord[] }>(
    '/presence/lookup',
    { method: 'POST', body: JSON.stringify({ userIds }) },
    token
  );
  return result.users;
}

// --- Friend profile -----------------------------------------------------

/** One recently-watched row on a friend's profile (their Continue-Watching
 *  surface). `videoId` is the Stremio `<imdb>:<season>:<episode>` for series. */
export type WatchHistoryEntry = {
  id: string;
  type: string | null;
  name: string | null;
  poster: string | null;
  videoId: string | null;
  lastWatched: number | null;
  timeOffset: number;
  duration: number;
};

export type FriendProfileResponse = {
  profile: {
    id: string;
    displayName: string;
    username: string | null;
    avatar: string | null;
    createdAt: number | null;
  };
  online: boolean;
  lastSeenAt: number | null;
  currentActivity: (PresenceActivity & { at: number }) | null;
  history: WatchHistoryEntry[];
};

/** A friend's public profile + recent activity. Server gates this to
 *  accepted friends (or self) and proxies through the shell's /storage/*. */
export async function fetchUserProfile(token: string, userId: string): Promise<FriendProfileResponse> {
  return request<FriendProfileResponse>(`/users/${encodeURIComponent(userId)}/profile`, {}, token);
}

// --- Party invites ------------------------------------------------------

/** Ask a friend who is currently watching something to start a watch
 *  party with you. Server pushes `party:invite-request` to them. */
export async function requestPartyInvite(token: string, targetUserId: string): Promise<void> {
  await request('/party-invite/request', {
    method: 'POST',
    body: JSON.stringify({ targetUserId }),
  }, token);
}

/** Accept an inbound invite. The accepting user becomes the room host;
 *  the room code is also pushed back to the requester via
 *  `party:invite-accepted`. */
export async function acceptPartyInvite(token: string, args: {
  requesterUserId: string;
  type: string;
  imdbId: string;
  videoId?: string | null;
}): Promise<{ code: string }> {
  return request<{ code: string }>('/party-invite/accept', {
    method: 'POST',
    body: JSON.stringify(args),
  }, token);
}

// --- User search --------------------------------------------------------

export type UserSearchResult = {
  id: string;
  displayName: string;
  /** Public handle (lowercase). Null only on legacy accounts where
   *  the backfill hasn't run yet — should never be null in practice
   *  after the server boots. */
  username: string | null;
  avatar: string | null;
};

export async function searchUsers(token: string, query: string): Promise<UserSearchResult[]> {
  if (!query.trim()) return [];
  const result = await request<{ users?: UserSearchResult[] }>(
    `/users/search?q=${encodeURIComponent(query)}`,
    {},
    token
  );
  return result.users ?? [];
}

// Convenience: read the whole library, find the item, write back with
// the updated progress fields. Same get-then-put dance the Stremio
// helper used to do — fine at this scale (typical libraries are <200
// items). Returns silently if the item doesn't exist (e.g. user
// hasn't bookmarked the title yet).
export async function updateBlissfulLibraryProgress(token: string, params: {
  id: string;
  type: string;
  videoId?: string | null;
  timeSeconds: number;
  durationSeconds?: number;
  name?: string | null;
  poster?: string | null;
  streamUrl?: string | null;
  streamTitle?: string | null;
}): Promise<void> {
  const all = await fetchBlissfulLibrary<Record<string, unknown> & { _id: string }>(token);
  const existing = all.find((it) => it._id === params.id);
  if (!existing) {
    // Auto-create a minimal entry so Continue Watching picks it up.
    // This is NOT the same as "Add to library" — that's an explicit
    // user action. This just tracks playback progress.
    const nowIso = new Date().toISOString();
    const normalizedType = params.type === 'anime' ? 'series' : params.type;
    const timeOffset = Math.max(0, Math.round(params.timeSeconds * 1000));
    const duration =
      typeof params.durationSeconds === 'number' && Number.isFinite(params.durationSeconds) && params.durationSeconds > 0
        ? Math.max(0, Math.round(params.durationSeconds * 1000))
        : 0;
    await putBlissfulLibraryItem(token, params.id, {
      _id: params.id,
      type: normalizedType,
      name: params.name ?? params.id,
      poster: params.poster ?? null,
      posterShape: 'poster',
      _mtime: nowIso,
      _blissStreamUrl: params.streamUrl ?? null,
      _blissStreamTitle: params.streamTitle ?? null,
      state: {
        lastWatched: nowIso,
        timeOffset,
        duration,
        video_id: normalizedType === 'series' ? (params.videoId ?? null) : null,
      },
    });
    return;
  }
  const nowIso = new Date().toISOString();
  const normalizedType = params.type === 'anime' ? 'series' : params.type;
  const timeOffset = Math.max(0, Math.round(params.timeSeconds * 1000));
  const duration =
    typeof params.durationSeconds === 'number' && Number.isFinite(params.durationSeconds) && params.durationSeconds > 0
      ? Math.max(0, Math.round(params.durationSeconds * 1000))
      : 0;
  const next: Record<string, unknown> = {
    ...existing,
    type: normalizedType,
    _mtime: nowIso,
    state: {
      ...((existing as { state?: Record<string, unknown> }).state ?? {}),
      lastWatched: nowIso,
      timeOffset,
      duration,
      video_id: normalizedType === 'series' ? (params.videoId ?? null) : null,
    },
  };
  next._blissProgressSource = 'app';
  if (params.streamUrl) next._blissStreamUrl = params.streamUrl;
  if (params.streamTitle) next._blissStreamTitle = params.streamTitle;
  await putBlissfulLibraryItem(token, params.id, next);
}
