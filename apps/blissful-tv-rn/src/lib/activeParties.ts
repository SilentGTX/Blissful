import { useSyncExternalStore } from 'react';

// Tracks friends' currently-OPEN watch-party rooms (1:1 with the desktop
// ActivePartiesProvider). Fed by the user socket: `party:invite-accepted` adds a
// room keyed by the host's userId; `party:room-closed` drops it. Drives the
// friend accordion's "Join party" affordance (vs "Request party") until the room
// closes. Cleared on logout.
export type ActivePartyRoom = {
  hostUserId: string;
  code: string;
  type: 'movie' | 'series';
  imdbId: string;
  videoId: string | null;
};

let parties: Record<string, ActivePartyRoom> = {};
const listeners = new Set<() => void>();
function notify() { listeners.forEach((l) => l()); }

export function setActiveParty(room: ActivePartyRoom): void {
  parties = { ...parties, [room.hostUserId]: room };
  notify();
}
export function removeActivePartyByCode(code: string): void {
  const next: Record<string, ActivePartyRoom> = {};
  let changed = false;
  for (const [k, v] of Object.entries(parties)) {
    if (v.code === code) { changed = true; continue; }
    next[k] = v;
  }
  if (changed) { parties = next; notify(); }
}
export function clearActiveParties(): void {
  if (Object.keys(parties).length) { parties = {}; notify(); }
}

function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
function getSnapshot(): Record<string, ActivePartyRoom> { return parties; }

/** The map of hostUserId -> open room. */
export function useActiveParties(): Record<string, ActivePartyRoom> {
  return useSyncExternalStore(subscribe, getSnapshot);
}
