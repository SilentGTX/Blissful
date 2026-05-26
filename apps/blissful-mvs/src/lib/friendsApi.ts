import { STORAGE_URL } from './storageBaseUrl';

export type FriendRecord = {
  id: string;
  userId: string;
  displayName: string;
  realName?: string | null;
  nickname?: string | null;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
  createdAt: number;
};

export type FriendsState = {
  friends: FriendRecord[];
  incoming: FriendRecord[];
  outgoing: FriendRecord[];
};

async function request<T>(path: string, authKey: string, init?: RequestInit): Promise<T> {
  if (!authKey) throw new Error('Friends API: not signed in');
  const res = await fetch(`${STORAGE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${authKey}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Friends API ${path} failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      // body wasn't JSON; ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchFriends(authKey: string): Promise<FriendsState> {
  return request<FriendsState>('/friends', authKey);
}

export async function sendFriendRequest(
  authKey: string,
  args: { toUserId: string; toDisplayName?: string; fromDisplayName?: string }
): Promise<{ ok: true; accepted?: boolean; already?: boolean }> {
  return request('/friends/request', authKey, {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

export async function acceptFriendRequest(authKey: string, id: string): Promise<void> {
  await request(`/friends/${id}/accept`, authKey, { method: 'POST' });
}

export async function removeFriend(authKey: string, id: string): Promise<void> {
  await request(`/friends/${id}`, authKey, { method: 'DELETE' });
}

export async function setFriendNickname(
  authKey: string,
  id: string,
  nickname: string | null
): Promise<{ nickname: string | null }> {
  return request(`/friends/${id}/nickname`, authKey, {
    method: 'PATCH',
    body: JSON.stringify({ nickname: nickname ?? '' }),
  });
}
