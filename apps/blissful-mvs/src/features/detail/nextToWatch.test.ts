// Tests for computeNextToWatch — the resume-vs-advance decision behind the
// Continue-Watching "open at the next episode" fix. Regression magnet: a
// furthest-watched / next-index mistake sends the user to the wrong episode,
// and a too-loose resume threshold reintroduces the "Resume 0:00" / resume-a-
// finished-episode bugs.

import { describe, expect, it } from 'vitest';
import { computeNextToWatch, type NextToWatchVideo } from './nextToWatch';

const SERIES = 'tt0106179'; // The X-Files
// Native meta order: S1E1..S1E10 for the tests below.
const season1 = (n: number): NextToWatchVideo[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${SERIES}:1:${i + 1}`, season: 1, episode: i + 1 }));

describe('computeNextToWatch', () => {
  it('advances to the episode after the FURTHEST watched (X-Files 1,3,7 -> 8)', () => {
    const videos = season1(10);
    const watched = new Set([`${SERIES}:1:1`, `${SERIES}:1:3`, `${SERIES}:1:7`]);
    const result = computeNextToWatch({
      videos,
      watchedIds: watched,
      lastPlayedVideoId: `${SERIES}:1:3`, // last rewatched ep 3, but no partial progress
      lastPlayedProgress: null,
    });
    expect(result).toEqual({ videoId: `${SERIES}:1:8`, inProgress: false, resumeSeconds: 0 });
  });

  it('resumes the last-played episode when it has genuine partial progress', () => {
    const videos = season1(10);
    const watched = new Set([`${SERIES}:1:1`, `${SERIES}:1:2`]);
    const result = computeNextToWatch({
      videos,
      watchedIds: watched,
      lastPlayedVideoId: `${SERIES}:1:3`,
      lastPlayedProgress: { timeSeconds: 600, durationSeconds: 2700 }, // ~22%
    });
    expect(result).toEqual({ videoId: `${SERIES}:1:3`, inProgress: true, resumeSeconds: 600 });
  });

  it('does NOT resume a sub-15s leftover (would be "Resume 0:00") — advances instead', () => {
    const videos = season1(10);
    const watched = new Set([`${SERIES}:1:1`, `${SERIES}:1:2`]);
    const result = computeNextToWatch({
      videos,
      watchedIds: watched,
      lastPlayedVideoId: `${SERIES}:1:3`,
      lastPlayedProgress: { timeSeconds: 0.8, durationSeconds: 2700 },
    });
    // ep3 not watched, but no genuine progress -> advance past furthest (ep2) -> ep3.
    expect(result?.inProgress).toBe(false);
    expect(result?.videoId).toBe(`${SERIES}:1:3`);
  });

  it('does NOT resume a basically-finished episode (>95%) — treats it as done', () => {
    const videos = season1(10);
    const watched = new Set([`${SERIES}:1:1`]);
    const result = computeNextToWatch({
      videos,
      watchedIds: watched,
      lastPlayedVideoId: `${SERIES}:1:2`,
      lastPlayedProgress: { timeSeconds: 2660, durationSeconds: 2700 }, // ~98.5%
    });
    expect(result?.inProgress).toBe(false);
    // furthest watched = ep1 -> next = ep2 (the near-finished one, fresh open).
    expect(result?.videoId).toBe(`${SERIES}:1:2`);
  });

  it('nothing watched -> first episode', () => {
    const videos = season1(10);
    const result = computeNextToWatch({
      videos,
      watchedIds: new Set<string>(),
      lastPlayedVideoId: null,
      lastPlayedProgress: null,
    });
    expect(result).toEqual({ videoId: `${SERIES}:1:1`, inProgress: false, resumeSeconds: 0 });
  });

  it('finale already watched -> falls back to last-played, else last episode', () => {
    const videos = season1(3);
    const watchedAll = new Set([`${SERIES}:1:1`, `${SERIES}:1:2`, `${SERIES}:1:3`]);
    expect(
      computeNextToWatch({
        videos,
        watchedIds: watchedAll,
        lastPlayedVideoId: `${SERIES}:1:2`,
        lastPlayedProgress: null,
      }),
    ).toEqual({ videoId: `${SERIES}:1:2`, inProgress: false, resumeSeconds: 0 });

    expect(
      computeNextToWatch({
        videos,
        watchedIds: watchedAll,
        lastPlayedVideoId: null,
        lastPlayedProgress: null,
      }),
    ).toEqual({ videoId: `${SERIES}:1:3`, inProgress: false, resumeSeconds: 0 });
  });

  it('skips Specials (season 0) as an advance target', () => {
    // Native order: a special precedes S1E1, and a special sits after S1E1.
    const videos: NextToWatchVideo[] = [
      { id: `${SERIES}:0:1`, season: 0, episode: 1 },
      { id: `${SERIES}:1:1`, season: 1, episode: 1 },
      { id: `${SERIES}:0:2`, season: 0, episode: 2 },
      { id: `${SERIES}:1:2`, season: 1, episode: 2 },
    ];
    // Nothing watched -> first non-special is S1E1.
    expect(
      computeNextToWatch({
        videos,
        watchedIds: new Set<string>(),
        lastPlayedVideoId: null,
        lastPlayedProgress: null,
      })?.videoId,
    ).toBe(`${SERIES}:1:1`);
    // Watched S1E1 -> next index is the special, skip it -> S1E2.
    expect(
      computeNextToWatch({
        videos,
        watchedIds: new Set([`${SERIES}:1:1`]),
        lastPlayedVideoId: null,
        lastPlayedProgress: null,
      })?.videoId,
    ).toBe(`${SERIES}:1:2`);
  });

  it('returns null for an empty video list (movies / no episodes)', () => {
    expect(
      computeNextToWatch({
        videos: [],
        watchedIds: new Set<string>(),
        lastPlayedVideoId: null,
        lastPlayedProgress: null,
      }),
    ).toBeNull();
  });
});
