import { describe, it, expect } from 'vitest';
import {
  AUTO_START_TTL_MS,
  consumeStartKind,
  episodeLabel,
  lastManualEpisode,
  markAutoAdvance,
  readAutoAdvanceStreak,
  rememberManualEpisode,
  resetAutoAdvance,
  shouldAskStillWatching,
  stillWatchingLimit as coreStillWatchingLimit,
  type StorageLike,
} from './autoAdvanceGuard';
import { DEFAULT_PLAYER_SETTINGS, stillWatchingLimit } from './playerSettings';

function memoryStore(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

const ep = (videoId: string) => ({ type: 'series', id: 'tt1', videoId });

describe('auto-advance streak', () => {
  it('starts at 0 and counts each auto-advance', () => {
    const s = memoryStore();
    expect(readAutoAdvanceStreak(s)).toBe(0);
    expect(markAutoAdvance(ep('tt1:1:2'), s)).toBe(1);
    expect(markAutoAdvance(ep('tt1:1:3'), s)).toBe(2);
    expect(readAutoAdvanceStreak(s)).toBe(2);
  });

  it('reset drops the streak back to 0', () => {
    const s = memoryStore();
    markAutoAdvance(ep('tt1:1:2'), s);
    markAutoAdvance(ep('tt1:1:3'), s);
    resetAutoAdvance(s);
    expect(readAutoAdvanceStreak(s)).toBe(0);
    expect(markAutoAdvance(ep('tt1:1:4'), s)).toBe(1);
  });

  it('survives garbage in storage and a missing store', () => {
    const s = memoryStore();
    s.setItem('bliss:autoAdvanceStreak', 'nope');
    expect(readAutoAdvanceStreak(s)).toBe(0);
    expect(readAutoAdvanceStreak(null)).toBe(0);
    expect(() => resetAutoAdvance(null)).not.toThrow();
  });
});

describe('shouldAskStillWatching', () => {
  it('never asks when the limit is 0 (off)', () => {
    expect(shouldAskStillWatching(0, 0)).toBe(false);
    expect(shouldAskStillWatching(50, 0)).toBe(false);
  });

  it('limit 1 asks after the first auto-advance', () => {
    expect(shouldAskStillWatching(0, 1)).toBe(false);
    expect(shouldAskStillWatching(1, 1)).toBe(true);
  });

  it('limit 2 holds the third auto-advance (A manual, B auto, C auto, ask)', () => {
    expect(shouldAskStillWatching(0, 2)).toBe(false);
    expect(shouldAskStillWatching(1, 2)).toBe(false);
    expect(shouldAskStillWatching(2, 2)).toBe(true);
    expect(shouldAskStillWatching(3, 2)).toBe(true);
  });

  it('a profile without the setting gets the default of 2', () => {
    expect(stillWatchingLimit({})).toBe(2);
    expect(stillWatchingLimit({ stillWatchingAfter: undefined })).toBe(2);
    expect(stillWatchingLimit(DEFAULT_PLAYER_SETTINGS)).toBe(2);
    expect(shouldAskStillWatching(2, stillWatchingLimit({}))).toBe(true);
  });

  it('reads 0 as off and clamps nonsense back to the default', () => {
    expect(stillWatchingLimit({ stillWatchingAfter: 0 })).toBe(0);
    expect(stillWatchingLimit({ stillWatchingAfter: 5 })).toBe(5);
    expect(stillWatchingLimit({ stillWatchingAfter: -1 })).toBe(2);
    expect(stillWatchingLimit({ stillWatchingAfter: Number.NaN })).toBe(2);
  });
});

describe('consumeStartKind', () => {
  it('an auto-advanced load is auto, exactly once', () => {
    const s = memoryStore();
    markAutoAdvance(ep('tt1:1:2'), s, 1000);
    expect(consumeStartKind(ep('tt1:1:2'), s, 2000)).toBe('auto');
    expect(consumeStartKind(ep('tt1:1:2'), s, 2000)).toBe('manual');
  });

  it('a load with no flag is a manual start', () => {
    expect(consumeStartKind(ep('tt1:1:2'), memoryStore())).toBe('manual');
  });

  it('a flag for another episode, or a stale one, does not make this load auto', () => {
    const s = memoryStore();
    markAutoAdvance(ep('tt1:1:2'), s, 1000);
    expect(consumeStartKind(ep('tt1:1:9'), s, 2000)).toBe('manual');
    markAutoAdvance(ep('tt1:1:2'), s, 1000);
    expect(consumeStartKind(ep('tt1:1:2'), s, 1000 + AUTO_START_TTL_MS + 1)).toBe('manual');
  });

  it('a manual load does not touch the streak itself (the player resets it)', () => {
    const s = memoryStore();
    markAutoAdvance(ep('tt1:1:2'), s);
    consumeStartKind(ep('tt1:1:7'), s);
    expect(readAutoAdvanceStreak(s)).toBe(1);
  });
});

describe('last manually picked episode', () => {
  it('round-trips per series', () => {
    const s = memoryStore();
    expect(lastManualEpisode('series', 'tt1', s)).toBeNull();
    rememberManualEpisode('series', 'tt1', { videoId: 'tt1:1:3', label: 'S1E3 · Pilot' }, s);
    expect(lastManualEpisode('series', 'tt1', s)).toEqual({ videoId: 'tt1:1:3', label: 'S1E3 · Pilot' });
    expect(lastManualEpisode('series', 'tt2', s)).toBeNull();
  });

  it('ignores a corrupt entry', () => {
    const s = memoryStore();
    s.setItem('bliss:lastManualEpisode:series:tt1', '{oops');
    expect(lastManualEpisode('series', 'tt1', s)).toBeNull();
    s.setItem('bliss:lastManualEpisode:series:tt1', JSON.stringify({ label: 'x' }));
    expect(lastManualEpisode('series', 'tt1', s)).toBeNull();
  });
});

describe('episodeLabel', () => {
  it('formats season, episode and title', () => {
    expect(episodeLabel({ season: 1, episode: 3, title: 'Pilot' })).toBe('S1E3 · Pilot');
    expect(episodeLabel({ season: null, episode: 33, title: null })).toBe('Episode 33');
    expect(episodeLabel({ title: 'Special' })).toBe('Special');
    expect(episodeLabel({})).toBeNull();
  });
});

describe('core stillWatchingLimit (shared with Android TV)', () => {
  it('matches the web helper: missing / invalid = default 2, 0 = off', () => {
    for (const v of [undefined, null, NaN, -1, '3', Infinity]) {
      expect(coreStillWatchingLimit(v)).toBe(2);
    }
    expect(coreStillWatchingLimit(0)).toBe(0);
    expect(coreStillWatchingLimit(1)).toBe(1);
    expect(coreStillWatchingLimit(3.9)).toBe(3);
    expect(coreStillWatchingLimit(undefined)).toBe(stillWatchingLimit(DEFAULT_PLAYER_SETTINGS));
  });
});
