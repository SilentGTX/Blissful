import { describe, it, expect } from 'vitest';
import {
  buildFillerEpisodes,
  describeFillerRun,
  episodeNumberOf,
  fillerEpisodesCompatible,
  fillerKindFor,
  fillerRunFrom,
  isFillerAcknowledged,
  isFillerRunStart,
  kitsuEntryId,
  parseJikanEpisodesPage,
  type FillerEpisodes,
} from './animeFiller';

// Bleach-shaped fixture: MAL flags 33 and 50 as one-off filler, 64-108 as the
// Bount arc, and the entry ends at 366.
function bleach(): FillerEpisodes {
  const kinds: Record<number, 'filler' | 'recap'> = { 33: 'filler', 50: 'filler', 200: 'recap' };
  for (let n = 64; n <= 108; n += 1) kinds[n] = 'filler';
  return { malId: 269, total: 366, kinds };
}

describe('parseJikanEpisodesPage', () => {
  it('reads mal_id + filler/recap flags and the has_next_page marker', () => {
    const page = parseJikanEpisodesPage({
      pagination: { last_visible_page: 4, has_next_page: true },
      data: [
        { mal_id: 1, filler: false, recap: false },
        { mal_id: 33, filler: true, recap: false },
        { mal_id: 34, recap: true },
        { mal_id: 'x', filler: true },
      ],
    });
    expect(page.hasNext).toBe(true);
    expect(page.entries).toEqual([
      { episode: 1, filler: false, recap: false },
      { episode: 33, filler: true, recap: false },
      { episode: 34, filler: false, recap: true },
    ]);
  });

  it('tolerates garbage', () => {
    expect(parseJikanEpisodesPage(null)).toEqual({ entries: [], hasNext: false });
    expect(parseJikanEpisodesPage({ data: 'nope' })).toEqual({ entries: [], hasNext: false });
  });
});

describe('buildFillerEpisodes', () => {
  it('keeps only skippable episodes, filler winning over recap, and tracks the last listed episode', () => {
    const map = buildFillerEpisodes(269, [
      { episode: 1, filler: false, recap: false },
      { episode: 2, filler: true, recap: true },
      { episode: 3, filler: false, recap: true },
      { episode: 9, filler: false, recap: false },
    ]);
    expect(map).toEqual({ malId: 269, total: 9, kinds: { 2: 'filler', 3: 'recap' } });
  });
});

describe('fillerRunFrom', () => {
  it('is null for a canon episode', () => {
    expect(fillerRunFrom(bleach(), 63)).toBeNull();
    expect(fillerRunFrom(bleach(), null)).toBeNull();
    expect(fillerRunFrom(null, 64)).toBeNull();
  });

  it('spans the whole consecutive run and names the canon episode after it', () => {
    expect(fillerRunFrom(bleach(), 64)).toEqual({ first: 64, last: 108, count: 45, nextCanon: 109 });
    // Starting mid-run counts only what is ahead.
    expect(fillerRunFrom(bleach(), 100)).toEqual({ first: 100, last: 108, count: 9, nextCanon: 109 });
    expect(fillerRunFrom(bleach(), 33)).toEqual({ first: 33, last: 33, count: 1, nextCanon: 34 });
  });

  it('has no canon target when the run reaches the end of the listed episodes', () => {
    const map: FillerEpisodes = { malId: 1, total: 12, kinds: { 11: 'filler', 12: 'filler' } };
    expect(fillerRunFrom(map, 11)).toEqual({ first: 11, last: 12, count: 2, nextCanon: null });
  });
});

describe('isFillerRunStart', () => {
  it('is true only for the first episode of a run', () => {
    expect(isFillerRunStart(bleach(), 64)).toBe(true);
    expect(isFillerRunStart(bleach(), 65)).toBe(false);
    expect(isFillerRunStart(bleach(), 108)).toBe(false);
    expect(isFillerRunStart(bleach(), 33)).toBe(true);
    expect(isFillerRunStart(bleach(), 63)).toBe(false);
    expect(isFillerRunStart(null, 64)).toBe(false);
  });
});

describe('fillerKindFor / episodeNumberOf / kitsuEntryId', () => {
  it('looks up by episode number', () => {
    expect(fillerKindFor(bleach(), 200)).toBe('recap');
    expect(fillerKindFor(bleach(), 64)).toBe('filler');
    expect(fillerKindFor(bleach(), 1)).toBeNull();
    expect(fillerKindFor(bleach(), undefined)).toBeNull();
  });

  it('prefers the meta episode field, falls back to the id tail, ignores show ids', () => {
    expect(episodeNumberOf({ id: 'kitsu:244:33', episode: 33 })).toBe(33);
    expect(episodeNumberOf({ id: 'kitsu:244:33', episode: null })).toBe(33);
    expect(episodeNumberOf({ id: 'kitsu:244' })).toBeNull();
    expect(episodeNumberOf({ id: 'tt0434665:1:2', episode: 2 })).toBe(2);
  });

  it('extracts the numeric Kitsu entry id from show and episode ids', () => {
    expect(kitsuEntryId('kitsu:244')).toBe('244');
    expect(kitsuEntryId('kitsu:244:33')).toBe('244');
    expect(kitsuEntryId('tt0434665')).toBeNull();
    expect(kitsuEntryId('kitsu:abc')).toBeNull();
    expect(kitsuEntryId(null)).toBeNull();
  });
});

describe('fillerEpisodesCompatible', () => {
  it('accepts matching and near-matching counts, rejects a different entry', () => {
    expect(fillerEpisodesCompatible(bleach(), 366)).toBe(true);
    expect(fillerEpisodesCompatible(bleach(), 372)).toBe(true);
    // Unknown addon count (meta not loaded yet) is not a mismatch.
    expect(fillerEpisodesCompatible(bleach(), 0)).toBe(true);
    // A 13-episode Kitsu season mapped onto the 366-episode MAL entry.
    expect(fillerEpisodesCompatible(bleach(), 13)).toBe(false);
  });

  it('gives short shows an absolute allowance of ten episodes', () => {
    const map: FillerEpisodes = { malId: 1, total: 24, kinds: {} };
    expect(fillerEpisodesCompatible(map, 26)).toBe(true);
    expect(fillerEpisodesCompatible(map, 34)).toBe(true);
    expect(fillerEpisodesCompatible(map, 35)).toBe(false);
  });
});

describe('isFillerAcknowledged', () => {
  it('matches only episodes inside an acknowledged run', () => {
    const acks = [{ first: 64, last: 108 }];
    expect(isFillerAcknowledged(acks, 64)).toBe(true);
    expect(isFillerAcknowledged(acks, 108)).toBe(true);
    expect(isFillerAcknowledged(acks, 33)).toBe(false);
    expect(isFillerAcknowledged([], 64)).toBe(false);
  });
});

describe('describeFillerRun', () => {
  it('words single episodes, recaps and long runs differently', () => {
    expect(describeFillerRun({ first: 33, last: 33, count: 1, nextCanon: 34 }, 'filler', 'this')).toBe('This episode is filler.');
    expect(describeFillerRun({ first: 200, last: 200, count: 1, nextCanon: 201 }, 'recap', 'next')).toBe('The next episode is a recap.');
    expect(describeFillerRun({ first: 64, last: 108, count: 45, nextCanon: 109 }, 'filler', 'next')).toBe('The next 45 episodes are filler (Episodes 64–108).');
    expect(describeFillerRun({ first: 64, last: 108, count: 45, nextCanon: 109 }, 'filler', 'this')).toBe('Episodes 64–108 are filler (45 episodes).');
  });
});
