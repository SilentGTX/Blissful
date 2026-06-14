import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { registerAccount, api } from '../fixtures/auth';
import type { FriendsState } from '../../apps/web-blissful/src/lib/friendsApi';
import type { TestAccount } from '../fixtures/auth';

// Social over the /ws/user push socket — the real, two-account WS layer the
// REST-only social.protocol suite couldn't reach. The user socket IS the
// "online" signal (server tracks `userSockets.has(userId)`), and party invites
// are pushed live over it. Both accounts are throwaway; runs against the
// deployed backend (no browser, no mocks).
//
// Handshake (UserSocketProvider): open the socket, send {t:'auth', token},
// server replies {t:'ready'} and registers the socket as the user's presence.

const STORAGE_HTTP = process.env.STORAGE_HTTP || 'https://blissful.budinoff.com/storage';
const WS_USER_URL = process.env.STORAGE_WS_USER || `${STORAGE_HTTP.replace(/^http/, 'ws')}/ws/user`;

type Pushed = { t: string } & Record<string, unknown>;

type UserSock = {
  ws: WebSocket;
  /** Resolve with the next (or already-buffered) push of type `t`. */
  waitFor: (t: string, timeoutMs?: number) => Promise<Pushed>;
  close: () => void;
};

// Open an authed /ws/user socket and resolve once the server sends {t:'ready'}.
// Messages are buffered so a push that lands before waitFor() is registered is
// never lost.
function openUserSocket(token: string): Promise<UserSock> {
  const ws = new WebSocket(WS_USER_URL);
  const inbox: Pushed[] = [];
  const waiters: Array<{ t: string; resolve: (m: Pushed) => void }> = [];

  ws.on('message', (raw) => {
    let msg: Pushed;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    const i = waiters.findIndex((w) => w.t === msg.t);
    if (i >= 0) {
      const [w] = waiters.splice(i, 1);
      w.resolve(msg);
    } else {
      inbox.push(msg);
    }
  });

  const waitFor = (t: string, timeoutMs = 10_000) =>
    new Promise<Pushed>((resolve, reject) => {
      const buffered = inbox.findIndex((m) => m.t === t);
      if (buffered >= 0) {
        const [m] = inbox.splice(buffered, 1);
        resolve(m);
        return;
      }
      const wrapped = (m: Pushed) => {
        clearTimeout(timer);
        resolve(m);
      };
      const timer = setTimeout(() => {
        const j = waiters.findIndex((w) => w.resolve === wrapped);
        if (j >= 0) waiters.splice(j, 1);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for '${t}' over /ws/user`));
      }, timeoutMs);
      waiters.push({ t, resolve: wrapped });
    });

  return new Promise<UserSock>((resolve, reject) => {
    ws.once('error', reject);
    ws.once('open', () => {
      try {
        ws.send(JSON.stringify({ t: 'auth', token }));
      } catch (err) {
        reject(err);
      }
    });
    // The server registers the socket (→ presence online) right before sending
    // {t:'ready'}, so once we see it the user is observably online.
    waitFor('ready', 10_000)
      .then(() => resolve({ ws, waitFor, close: () => { try { ws.close(); } catch { /* */ } } }))
      .catch(reject);
  });
}

async function befriend(a: TestAccount, b: TestAccount) {
  await api('/friends/request', a.token, {
    method: 'POST',
    body: JSON.stringify({ toUserId: b.id, toDisplayName: b.displayName }),
  });
  const bState = await api<FriendsState>('/friends', b.token);
  const incoming = bState.incoming.find((r) => r.userId === a.id);
  expect(incoming, 'friend request should arrive').toBeTruthy();
  await api(`/friends/${incoming!.id}/accept`, b.token, { method: 'POST' });
}

async function lookup(token: string, ids: string[]) {
  return api<{ users: Array<{ userId: string; online: boolean; activity: { id?: string } | null }> }>(
    '/presence/lookup',
    token,
    { method: 'POST', body: JSON.stringify({ userIds: ids }) },
  );
}

test.describe('Social over /ws/user (real, two accounts)', () => {
  test('the user socket is the live online + activity signal', async () => {
    const A = await registerAccount('e2ews');
    const B = await registerAccount('e2ews');
    await befriend(A, B);

    // No socket yet → A reads as offline (the socket, not the heartbeat, is the
    // online signal).
    const before = await lookup(B.token, [A.id]);
    expect(before.users.find((u) => u.userId === A.id)?.online, 'offline with no socket').toBe(false);

    const sockA = await openUserSocket(A.token);
    try {
      // A is "watching" something — the activity friends see next to "online".
      await api('/presence/heartbeat', A.token, {
        method: 'POST',
        body: JSON.stringify({ activity: { type: 'movie', id: 'tt1254207', name: 'Big Buck Bunny', videoId: null } }),
      });

      // B now sees A online WITH the activity — over the live socket.
      await expect
        .poll(async () => (await lookup(B.token, [A.id])).users.find((u) => u.userId === A.id)?.online, { timeout: 10_000 })
        .toBe(true);
      const withSocket = await lookup(B.token, [A.id]);
      expect(withSocket.users.find((u) => u.userId === A.id)?.activity?.id, 'activity is exposed while online').toBe('tt1254207');
    } finally {
      sockA.close();
    }

    // Socket gone → A flips back to offline and the activity is withheld.
    await expect
      .poll(async () => (await lookup(B.token, [A.id])).users.find((u) => u.userId === A.id)?.online, { timeout: 10_000 })
      .toBe(false);
    const after = await lookup(B.token, [A.id]);
    expect(after.users.find((u) => u.userId === A.id)?.activity, 'activity withheld once offline').toBeNull();
  });

  test('party invite request + accept are pushed live over the socket', async () => {
    const A = await registerAccount('e2ews'); // the watcher → becomes host
    const B = await registerAccount('e2ews'); // the requester → joins
    await befriend(A, B);

    const sockA = await openUserSocket(A.token);
    const sockB = await openUserSocket(B.token);
    try {
      // A is watching a movie — the prerequisite for being invitable.
      await api('/presence/heartbeat', A.token, {
        method: 'POST',
        body: JSON.stringify({ activity: { type: 'movie', id: 'tt1254207', name: 'Big Buck Bunny', videoId: null } }),
      });

      // B asks A (who's watching) to start a party → A gets a live push.
      const reqPush = sockA.waitFor('party:invite-request');
      const reqRes = await api<{ ok: boolean }>('/party-invite/request', B.token, {
        method: 'POST',
        body: JSON.stringify({ targetUserId: A.id }),
      });
      expect(reqRes.ok).toBe(true);
      const invite = (await reqPush) as {
        from: { userId: string; displayName: string };
        activity: { id: string; type: string };
      };
      expect(invite.from.userId, 'invite is attributed to the requester').toBe(B.id);
      expect(invite.activity.id, 'the offered activity is echoed').toBe('tt1254207');

      // A accepts → a real room is created (A host) and the code is pushed to B.
      const acceptedPush = sockB.waitFor('party:invite-accepted');
      const acceptRes = await api<{ code: string }>('/party-invite/accept', A.token, {
        method: 'POST',
        body: JSON.stringify({ requesterUserId: B.id, type: 'movie', imdbId: 'tt1254207', videoId: null }),
      });
      expect(acceptRes.code, 'accept returns the new room code').toBeTruthy();
      const accepted = (await acceptedPush) as { code: string; host: { userId: string }; imdbId: string };

      // The code B receives over its socket is the very room A just created.
      expect(accepted.code, 'B is pushed the same room code A created').toBe(acceptRes.code);
      expect(accepted.host.userId, 'A is the host').toBe(A.id);
      expect(accepted.imdbId).toBe('tt1254207');
    } finally {
      sockA.close();
      sockB.close();
    }
  });

  test('inviting a friend who is offline / not watching is rejected', async () => {
    const A = await registerAccount('e2ews');
    const B = await registerAccount('e2ews');
    await befriend(A, B);

    // A never opens a socket and never heartbeats → not invitable.
    const res = await fetch(`${STORAGE_HTTP}/party-invite/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${B.token}` },
      body: JSON.stringify({ targetUserId: A.id }),
    });
    expect(res.status, 'offline friend → 409 not invitable').toBe(409);
  });
});
