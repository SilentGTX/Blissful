import { useEffect, useMemo, useState } from 'react';
import {
  fetchFriends,
  lookupPresence,
  type FriendRecord,
  type PresenceActivity,
  type PresenceRecord,
} from '@blissful/core';

// --- pure helpers (ports of Friends/relativeTime + activityLabel) ----------
export function formatRelativeTime(epochMs: number | null | undefined): string {
  if (epochMs == null || !Number.isFinite(epochMs)) return '';
  const delta = Date.now() - epochMs;
  if (delta < 60_000) return 'just now';
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} wk ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

export function activityLabel(activity: PresenceActivity | null | undefined): string | null {
  if (!activity || !activity.name) return null;
  const tag = seasonEpisodeTag(activity.videoId);
  return tag ? `${activity.name} - ${tag}` : activity.name;
}

function seasonEpisodeTag(videoId: string | null | undefined): string | null {
  if (!videoId) return null;
  const parts = videoId.split(':');
  if (parts.length < 3) return null;
  const season = Number(parts[parts.length - 2]);
  const episode = Number(parts[parts.length - 1]);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return `S${season}E${episode}`;
}

export function statusLine(p?: PresenceRecord | null): string {
  if (!p) return 'offline';
  if (p.online && p.activity?.name) return activityLabel(p.activity) ?? 'online';
  if (p.online) return 'online';
  if (p.lastSeenAt) return `last seen ${formatRelativeTime(p.lastSeenAt)}`;
  return 'offline';
}

// --- data hook (fetchFriends + presence) -----------------------------------
export function useFriends(token: string | null) {
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [incoming, setIncoming] = useState<FriendRecord[]>([]);
  const [presence, setPresence] = useState<Map<string, PresenceRecord>>(new Map());

  useEffect(() => {
    if (!token) {
      setFriends([]);
      setIncoming([]);
      setPresence(new Map());
      return;
    }
    let cancelled = false;
    const load = () =>
      fetchFriends(token)
        .then((s) => {
          if (cancelled) return;
          setFriends(s.friends);
          setIncoming(s.incoming);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  const friendIds = useMemo(() => friends.map((f) => f.userId), [friends]);
  const idKey = friendIds.slice().sort().join(',');

  useEffect(() => {
    if (!token || friendIds.length === 0) {
      setPresence(new Map());
      return;
    }
    let cancelled = false;
    const load = () =>
      lookupPresence(token, friendIds)
        .then((records) => {
          if (cancelled) return;
          setPresence(new Map(records.map((r) => [r.userId, r])));
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, idKey]);

  const sorted = useMemo(
    () => [...friends].sort((a, b) => (presence.get(b.userId)?.online ? 1 : 0) - (presence.get(a.userId)?.online ? 1 : 0)),
    [friends, presence],
  );

  return { friends: sorted, incoming, presence };
}
