// Shared "join a watch-party room → open the player in it" flow, used by the
// Join Party modal AND the PartyInviteListener's Join pill. Enriches the room's
// bare imdbId with Cinemeta meta (real title + poster/backdrop/logo) so the player
// shows the title properly instead of "ttXXXXXXX", then resolves a stream and
// navigates to the player with the room code.
import { fetchMeta, normalizeStremioImage } from '@blissful/core';
import { navigationRef } from './navigationRef';
import { loadStreams } from './streamPicker';
import type { WatchPartyRoomInfo } from './watchParty';

export async function joinWatchPartyRoom(token: string | null, room: WatchPartyRoomInfo): Promise<{ ok: boolean; reason?: string }> {
  // Series rooms carry the episode id in videoId; movies use the imdbId.
  const videoId = room.videoId ?? room.imdbId;

  // Enrich title + art (best-effort — fall back to the bare id).
  let name = room.imdbId;
  let poster: string | undefined;
  let background: string | undefined;
  let logo: string | undefined;
  let description: string | undefined;
  let releaseInfo: string | undefined;
  try {
    const { meta } = await fetchMeta({ type: room.type, id: room.imdbId });
    name = meta.name ?? room.imdbId;
    poster = normalizeStremioImage(meta.poster) ?? undefined;
    background = normalizeStremioImage(meta.background) ?? undefined;
    logo = normalizeStremioImage((meta as { logo?: string | null }).logo) ?? undefined;
    description = meta.description ?? undefined;
    releaseInfo = meta.releaseInfo ?? undefined;
  } catch {
    /* no meta — the title shows as its id */
  }

  let playable: { url: string; title: string }[] = [];
  try {
    const streams = await loadStreams(token, room.type, videoId);
    playable = streams.filter((s) => s.url).map((s) => ({ url: s.url as string, title: s.title }));
  } catch {
    return { ok: false, reason: 'Could not load streams' };
  }
  if (playable.length === 0) return { ok: false, reason: 'No streams for that title' };

  navigationRef.current?.navigate('Player', {
    url: playable[0].url,
    title: name,
    playlist: playable,
    startIndex: 0,
    startSeconds: 0,
    poster,
    background,
    logo,
    description,
    releaseInfo,
    streamTarget: { type: room.type, id: videoId, title: name },
    detailId: room.imdbId,
    roomCode: room.code,
  });
  return { ok: true };
}
