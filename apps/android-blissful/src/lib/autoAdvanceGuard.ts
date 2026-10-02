import {
  consumeStartKind,
  lastManualEpisode,
  markAutoAdvance,
  readAutoAdvanceStreak,
  rememberManualEpisode,
  resetAutoAdvance,
  shouldAskStillWatching,
  stillWatchingLimit,
  type EpisodeTarget,
  type ManualEpisode,
  type StorageLike,
} from '@blissful/core';
import { kv } from './storage';

// "Are you still watching?" guard, bound to this app's stores. The shared core
// module defaults to sessionStorage/localStorage, which don't exist on React
// Native, so every call here injects a store.
//
// The streak + auto-start flag are session data: a module-level Map, NOT
// component state, because switchToEpisode does navigation.replace and the
// Player screen remounts per episode. It dies with the process, like web's
// sessionStorage. The last hand-picked episode persists in MMKV.

const mem = new Map<string, string>();
const sessionStore: StorageLike = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => { mem.set(k, v); },
  removeItem: (k) => { mem.delete(k); },
};
const persistentStore: StorageLike = {
  getItem: (k) => kv.get(k),
  setItem: (k, v) => kv.set(k, v),
  removeItem: (k) => kv.remove(k),
};

export const autoAdvanceStreak = () => readAutoAdvanceStreak(sessionStore);
export const markAutoAdvanced = (target: EpisodeTarget) => markAutoAdvance(target, sessionStore);
export const resetAutoAdvanceStreak = () => resetAutoAdvance(sessionStore);
export const consumeEpisodeStartKind = (target: EpisodeTarget) => consumeStartKind(target, sessionStore);
export const rememberHandPickedEpisode = (type: string, id: string, episode: ManualEpisode) =>
  rememberManualEpisode(type, id, episode, persistentStore);
export const lastHandPickedEpisode = (type: string, id: string) => lastManualEpisode(type, id, persistentStore);

/** True when the next auto-advance should be held for the prompt. */
export function shouldHoldAutoAdvance(stillWatchingAfter: unknown): boolean {
  return shouldAskStillWatching(autoAdvanceStreak(), stillWatchingLimit(stillWatchingAfter));
}
