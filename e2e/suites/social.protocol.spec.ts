import { test, expect } from '@playwright/test';
import { registerAccount, api } from '../fixtures/auth';
import type { FriendsState } from '../../apps/web-blissful/src/lib/friendsApi';

// Social — the REAL two-account friend flow over blissful-storage (no browser,
// no mocks): register A + B, A sends a friend request, B accepts, both see the
// friendship. Plus presence between the two. Real accounts are throwaway.

test.describe('Social (real, two accounts)', () => {
  test('friend request → accept → both are friends', async () => {
    const A = await registerAccount('e2ea');
    const B = await registerAccount('e2eb');

    // A → friend request to B.
    await api('/friends/request', A.token, { method: 'POST', body: JSON.stringify({ toUserId: B.id, toDisplayName: B.displayName }) });

    // B sees the incoming request and accepts it.
    const bBefore = await api<FriendsState>('/friends', B.token);
    const incoming = bBefore.incoming.find((r) => r.userId === A.id);
    expect(incoming, 'B should have an incoming request from A').toBeTruthy();
    await api(`/friends/${incoming!.id}/accept`, B.token, { method: 'POST' });

    // Both sides now list the other as an accepted friend.
    const aAfter = await api<FriendsState>('/friends', A.token);
    const bAfter = await api<FriendsState>('/friends', B.token);
    expect(aAfter.friends.some((f) => f.userId === B.id && f.status === 'accepted')).toBe(true);
    expect(bAfter.friends.some((f) => f.userId === A.id && f.status === 'accepted')).toBe(true);
  });

  test('presence lookup is friend-gated and returns the friend record', async () => {
    const A = await registerAccount('e2ea');
    const B = await registerAccount('e2eb');
    // become friends (presence lookup is gated to friends)
    await api('/friends/request', A.token, { method: 'POST', body: JSON.stringify({ toUserId: B.id }) });
    const bState = await api<FriendsState>('/friends', B.token);
    const inc = bState.incoming.find((r) => r.userId === A.id);
    await api(`/friends/${inc!.id}/accept`, B.token, { method: 'POST' });

    await api('/presence/heartbeat', A.token, {
      method: 'POST',
      body: JSON.stringify({ activity: { type: 'movie', id: 'tt1254207', name: 'Big Buck Bunny', videoId: null } }),
    });
    const lookup = await api<{ users: Array<{ userId: string }> }>('/presence/lookup', B.token, {
      method: 'POST',
      body: JSON.stringify({ userIds: [A.id] }),
    });
    const rec = lookup.users.find((u) => u.userId === A.id);
    expect(rec, "B's friend-gated lookup should return a record for A").toBeTruthy();
    // NOTE: `online: true` + the live activity require an authed /ws/user socket
    // (UserSocketProvider), not a REST heartbeat — covered in social-ws.protocol.spec.ts.
  });
});
