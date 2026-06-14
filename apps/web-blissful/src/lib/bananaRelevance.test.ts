import { describe, expect, it } from 'vitest';
import {
  extractBananaTitleRegion,
  filterRelevantBananas,
  isRelevantBanana,
  normalizeTitleTokens,
} from './bananaRelevance';

describe('normalizeTitleTokens', () => {
  it('lowercases, de-accents, drops apostrophes, splits on punctuation', () => {
    expect(normalizeTitleTokens("Marvel's Daredevil")).toEqual(['marvels', 'daredevil']);
    expect(normalizeTitleTokens('From.S01E01.1080p')).toEqual(['from', 's01e01', '1080p']);
    expect(normalizeTitleTokens('Pokémon & Friends')).toEqual(['pokemon', 'and', 'friends']);
    expect(normalizeTitleTokens(null)).toEqual([]);
  });
});

describe('extractBananaTitleRegion', () => {
  it('strips leading bracket groups and cuts at the first marker', () => {
    expect(extractBananaTitleRegion('[GetItTwisted] From Bureaucrat to Villainess - S01E01 [BD 1080p]')).toBe(
      'From Bureaucrat to Villainess -',
    );
    expect(extractBananaTitleRegion('From.S01E01.1080p.WEB.h264-GOSSIP')).toBe('From.');
    expect(extractBananaTitleRegion('Arifureta.S01E01.The.Monster.of.the.Abyss.1080p')).toBe('Arifureta.');
    expect(extractBananaTitleRegion('The.Dark.Knight.2008.2160p.BluRay')).toBe('The.Dark.Knight.');
  });
});

describe('isRelevantBanana — all-stopword title ("From")', () => {
  const title = 'From';
  it('keeps the real show', () => {
    expect(isRelevantBanana('From.S01E01.1080p.WEB.h264-GOSSIP', title)).toBe(true);
    expect(isRelevantBanana('From.US.S01E01.1080p', title)).toBe(true); // country tag allowed
    expect(isRelevantBanana('From.2022.S01E01.1080p.BluRay', title)).toBe(true); // year between
  });
  it('drops longer titles that merely start with the word', () => {
    expect(isRelevantBanana('[GetItTwisted] From Bureaucrat to Villainess - S01E01 [BD 1080p]', title)).toBe(false);
    expect(isRelevantBanana('Love.from.9.to.5.S01E01.1080p.ColdFilm', title)).toBe(false);
  });
  it('drops unrelated shows that only matched the episode marker', () => {
    expect(isRelevantBanana('Arifureta.S01E01.The.Monster.of.the.Abyss.1080p.BluRay', title)).toBe(false);
    expect(isRelevantBanana('[Cait-Sidhe] LasDan - S01E01 [BD 1080p HEVC]', title)).toBe(false);
    expect(isRelevantBanana('[OZR] Arifureta - S01E01 (BD 1080p Hi10 FLAC) [Dual-Audio]', title)).toBe(false);
  });
});

describe('isRelevantBanana — content title', () => {
  it('keeps releases containing all content tokens (incl. franchise prefix / abbreviation)', () => {
    expect(isRelevantBanana('The.Dark.Knight.2008.2160p.BluRay.x265', 'The Dark Knight')).toBe(true);
    expect(isRelevantBanana('Marvels.Daredevil.S01E01.1080p', 'Daredevil')).toBe(true);
    expect(isRelevantBanana('Daredevil.S01E01.1080p', "Marvel's Daredevil")).toBe(true);
  });
  it('drops unrelated releases missing a content token', () => {
    expect(isRelevantBanana('Arifureta.S01E01.1080p', 'The Dark Knight')).toBe(false);
    expect(isRelevantBanana('Some.Random.Movie.2021.1080p', 'Severance')).toBe(false);
  });
  it('keeps when title is empty or release name is unknown', () => {
    expect(isRelevantBanana('Anything.At.All', '')).toBe(true);
    expect(isRelevantBanana(null, 'The Dark Knight')).toBe(true);
  });
  it('does not filter purely numeric titles', () => {
    expect(isRelevantBanana('Some.Other.Movie.2019.1080p', '1917')).toBe(true);
  });
});

describe('filterRelevantBananas', () => {
  const releases = [
    { name: 'TPB+', torrentName: 'From.S01E01.1080p.WEB.h264-GOSSIP' },
    { name: '[RD] Comet', torrentName: '[GetItTwisted] From Bureaucrat to Villainess - S01E01 [BD 1080p]' },
    { name: '[RD] Comet', torrentName: 'Arifureta.S01E01.The.Monster.of.the.Abyss.1080p.BluRay' },
    { name: '[RD] Comet', torrentName: 'Love.from.9.to.5.S01E01.1080p.ColdFilm' },
  ];
  it('keeps only the matching release for "From"', () => {
    const kept = filterRelevantBananas(releases, 'From');
    expect(kept.map((r) => r.torrentName)).toEqual(['From.S01E01.1080p.WEB.h264-GOSSIP']);
  });
  it('falls back to the full list when nothing matches (parser miss)', () => {
    const onlyJunk = releases.slice(1); // no real "From" release present
    const kept = filterRelevantBananas(onlyJunk, 'From');
    expect(kept).toEqual(onlyJunk);
  });
  it('is a no-op without an expected title', () => {
    expect(filterRelevantBananas(releases, null)).toEqual(releases);
  });
});
