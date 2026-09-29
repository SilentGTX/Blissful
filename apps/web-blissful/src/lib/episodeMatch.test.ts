import { describe, it, expect } from 'vitest';
import { episodeContradicts, expectedEpisodeFor, scoreEpisodeMatch, type ExpectedEpisode } from './episodeMatch';

// Regression guard for the "asked for Bleach episode 2, got Thousand-Year Blood
// War" class of bug: the addon's absolute episode numbering vs a release packed
// by broadcast season. The four strings below are the real /rd-fallback answer
// for kitsu:244:2 (Bleach episode 2), in the order Torrentio returned them.

const BLEACH_EP2: ExpectedEpisode = {
  season: 1,
  episode: 2,
  absolute: 2,
  title: "A Shinigami's Work",
};

const TYBW_S17E02 =
  '[RD+] Torrentio 1080p [LGH] Bleach Season 17 (S17) E01-E13 (BD Remux 1080p FLAC H.264) [Dual Audio] ' +
  'Bleach.S17E02.1080p.BluRay.Remux.Dual-Audio.FLAC2.0.H.264-LGH.mkv';
const CLASSIC_S01E02 =
  '[RD+] Torrentio 1080p [pursua] Bleach 001-366 (R2J DVD JPN BD 1080p) ' +
  'Season 01/Bleach (2004) - S01E02 - 002 - A Shinigamis Work [DVD][FLAC 2.0][JA][x264 10bit]-SOFCJ-Raws.mkv';
const ABSOLUTE_E002 =
  '[RD+] Torrentio 1080p [2jzgte] Bleach - BluRay Box Set 1-4 [Episodes 1-111] ' +
  'Bleach.Box1.E01-27.Hi10p.BluRay.FLAC.x264-2jzgte/Bleach.E002.Hi10p.BluRay.DUAL.FLAC.x264-2jzgte.mkv';
const ABSOLUTE_EPISODE_2 =
  '[RD+] Torrentio 1080p [TSS] BLEACH Kai - 1080p ' +
  '[1] Agent of the Shinigami Arc/BLEACH Kai - Episode 2 - GOODBYE PARAKEET, GOODNITE MY SISTA.mkv';

describe('scoreEpisodeMatch', () => {
  it('ranks the right episode above a same-numbered episode of another season', () => {
    const wrong = scoreEpisodeMatch(TYBW_S17E02, BLEACH_EP2);
    for (const right of [CLASSIC_S01E02, ABSOLUTE_E002, ABSOLUTE_EPISODE_2]) {
      expect(scoreEpisodeMatch(right, BLEACH_EP2)).toBeGreaterThan(wrong);
    }
  });
  it('gives the season-tagged wrong-season release no credit at all', () => {
    expect(scoreEpisodeMatch(TYBW_S17E02, BLEACH_EP2)).toBe(0);
  });
  it('scores an exact SxxEyy + episode-title match highest', () => {
    expect(scoreEpisodeMatch(CLASSIC_S01E02, BLEACH_EP2)).toBeGreaterThan(
      scoreEpisodeMatch(ABSOLUTE_E002, BLEACH_EP2),
    );
  });
  it('credits absolute numbering ("E002", "Episode 2")', () => {
    expect(scoreEpisodeMatch(ABSOLUTE_E002, BLEACH_EP2)).toBeGreaterThan(0);
    expect(scoreEpisodeMatch(ABSOLUTE_EPISODE_2, BLEACH_EP2)).toBeGreaterThan(0);
  });
  it('does not credit a different episode number', () => {
    expect(scoreEpisodeMatch('Bleach.E007.1080p.mkv', BLEACH_EP2)).toBe(0);
    expect(scoreEpisodeMatch('Bleach.S01E07.1080p.mkv', BLEACH_EP2)).toBe(0);
  });
  it('matches an ordinary imdb episode by SxxEyy', () => {
    const expected: ExpectedEpisode = { season: 9, episode: 1, absolute: null, title: null };
    expect(scoreEpisodeMatch('Rick.and.Morty.S09E01.1080p.WEB.h264', expected)).toBeGreaterThan(0);
    expect(scoreEpisodeMatch('Rick.and.Morty.S08E01.1080p.WEB.h264', expected)).toBe(0);
  });
  it('accepts the 1x02 marker shape', () => {
    expect(scoreEpisodeMatch('Bleach 1x02 DVDRip', BLEACH_EP2)).toBeGreaterThan(0);
  });
  it('is inert without an expectation or text', () => {
    expect(scoreEpisodeMatch(CLASSIC_S01E02, null)).toBe(0);
    expect(scoreEpisodeMatch('', BLEACH_EP2)).toBe(0);
  });
  it('ignores a too-short episode title (collides with random release words)', () => {
    const expected: ExpectedEpisode = { season: 1, episode: 2, absolute: 2, title: 'Home' };
    expect(scoreEpisodeMatch('Some.Show.Home.Video.S03E09.mkv', expected)).toBe(0);
  });
});

describe('expectedEpisodeFor', () => {
  const kitsuVideos = [
    { id: 'kitsu:244:1', season: 1, episode: 1, title: 'The Day I Became a Shinigami' },
    { id: 'kitsu:244:2', season: 1, episode: 2, title: "A Shinigami's Work" },
  ];
  it('reads season/episode/title from the addon meta and the absolute number from a prefixed id', () => {
    expect(expectedEpisodeFor('kitsu:244:2', kitsuVideos)).toEqual({
      season: 1,
      episode: 2,
      absolute: 2,
      title: "A Shinigami's Work",
    });
  });
  it('falls back to the id shape before the meta arrives', () => {
    expect(expectedEpisodeFor('kitsu:244:2', null)).toEqual({
      season: null,
      episode: 2,
      absolute: 2,
      title: null,
    });
    expect(expectedEpisodeFor('tt2861424:9:1', null)).toEqual({
      season: 9,
      episode: 1,
      absolute: null,
      title: null,
    });
  });
  it('returns null for a movie id', () => {
    expect(expectedEpisodeFor('tt0137523', [])).toBeNull();
    expect(expectedEpisodeFor(null, [])).toBeNull();
  });
});

describe('episode ranges and contradiction', () => {
  const RANGE_PACK =
    '[AnimeRG] Bleach (Complete Series) EP 001-366 [480p] [Dual-Audio] [Batch] [x265] [10-bit] [pseudo]';
  const ep = (n: number): ExpectedEpisode => ({ season: 1, episode: n, absolute: n, title: null });

  it('does not read "EP 001" inside "EP 001-366" as a marker for episode 1', () => {
    expect(scoreEpisodeMatch(RANGE_PACK, ep(1))).toBe(0);
    expect(scoreEpisodeMatch(RANGE_PACK, ep(366))).toBe(0);
  });
  it('does not treat a range that contains the episode as a contradiction', () => {
    expect(episodeContradicts(RANGE_PACK, ep(45))).toBe(false);
    expect(episodeContradicts(RANGE_PACK, ep(1))).toBe(false);
    expect(episodeContradicts('Show [Episodes 1-111] BD', ep(50))).toBe(false);
  });
  it('contradicts a range that does not contain the episode', () => {
    expect(episodeContradicts('Bleach EP 001-100 batch', ep(245))).toBe(true);
  });
  it('is silent for a release with no episode markers', () => {
    expect(episodeContradicts('[Anime Time] Bleach Complete Series + Movies [Disney+ BD][1080p]', ep(45))).toBe(false);
  });
  it('contradicts a different SxxEyy, and a wrong-season one', () => {
    expect(episodeContradicts('Bleach.S01E07.1080p.mkv', ep(45))).toBe(true);
    expect(episodeContradicts('Bleach.S17E45.1080p.mkv', ep(45))).toBe(true);
    expect(episodeContradicts('Bleach.S01E45.1080p.mkv', ep(45))).toBe(false);
  });
  it('contradicts a lone different absolute marker, and accepts the right one', () => {
    expect(episodeContradicts('Bleach - 044 - Something.mkv', ep(45))).toBe(true);
    expect(episodeContradicts('Bleach - 045 - Something.mkv', ep(45))).toBe(false);
    expect(episodeContradicts('Bleach.E045.mkv', ep(45))).toBe(false);
  });
  it('keeps a season run that contains the episode', () => {
    const s17: ExpectedEpisode = { season: 17, episode: 5, absolute: null, title: null };
    expect(episodeContradicts('Bleach S17E01-E13 BD', s17)).toBe(false);
    expect(episodeContradicts('Bleach S17E01-E03 BD', s17)).toBe(true);
  });
  it('is inert without an expectation', () => {
    expect(episodeContradicts('Bleach.S01E07.mkv', null)).toBe(false);
  });
});
