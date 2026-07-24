import { describe, it, expect } from 'vitest';
import { buildPlayerPath, parsePlayerPath, slugifyTitle } from './playerUrl';

// URL build/parse is a regression magnet (a wrong split silently routes the
// player at the wrong episode, or drops the source and re-resolves RD as
// vidking). Keep coverage tight around: id-segment shape (movie vs episode),
// slug cosmetics, round-trips, and rejecting the legacy query form.

describe('slugifyTitle', () => {
  it('dot-joins spaces and strips punctuation/emoji', () => {
    expect(slugifyTitle('Rick and Morty - S9E1')).toBe('Rick.and.Morty.S9E1');
  });
  it('passes an already-dotted release name through', () => {
    expect(slugifyTitle('Rick.and.Morty.S09E01.1080p.Slurpuff')).toBe(
      'Rick.and.Morty.S09E01.1080p.Slurpuff',
    );
  });
  it('drops emoji and metadata glyphs from a torrentio title', () => {
    expect(slugifyTitle('The Chestnut Man 👤 492 💾 1005 MB ⚙️ 1337x')).toBe(
      'The.Chestnut.Man.492.1005.MB.1337x',
    );
  });
  it('returns empty for nullish', () => {
    expect(slugifyTitle(null)).toBe('');
    expect(slugifyTitle(undefined)).toBe('');
    expect(slugifyTitle('')).toBe('');
  });
  it('never ends on a dot even when the length cap cuts mid-run', () => {
    const s = slugifyTitle('a '.repeat(60)); // → "a.a.a…", 80-char slice may land on a dot
    expect(s.endsWith('.')).toBe(false);
  });
});

describe('buildPlayerPath', () => {
  it('builds an episode path from a videoId', () => {
    expect(
      buildPlayerPath({ source: 'vidking', id: 'tt2861424', videoId: 'tt2861424:9:1', title: 'Rick and Morty S9E1' }),
    ).toBe('/player/vidking/tt2861424:9:1/Rick.and.Morty.S9E1');
  });
  it('builds a movie path with no videoId', () => {
    expect(buildPlayerPath({ source: 'vidking', id: 'tt0137523', title: 'Fight Club' })).toBe(
      '/player/vidking/tt0137523/Fight.Club',
    );
  });
  it('builds an auto path (the neutral default — no "vidking" in the URL)', () => {
    expect(
      buildPlayerPath({ source: 'auto', id: 'tt11198330', videoId: 'tt11198330:2:6', title: 'House of the Dragon' }),
    ).toBe('/player/auto/tt11198330:2:6/House.of.the.Dragon');
  });
  it('builds an rd path from a release name', () => {
    expect(
      buildPlayerPath({ source: 'rd', id: 'tt2861424', videoId: 'tt2861424:9:1', title: 'Rick.and.Morty.S09E01.1080p.Slurpuff' }),
    ).toBe('/player/rd/tt2861424:9:1/Rick.and.Morty.S09E01.1080p.Slurpuff');
  });
  it('omits the slug (no trailing slash) when there is no title', () => {
    expect(buildPlayerPath({ source: 'vidking', id: 'tt0137523' })).toBe('/player/vidking/tt0137523');
  });
});

describe('parsePlayerPath', () => {
  it('parses an episode path', () => {
    expect(parsePlayerPath('/player/vidking/tt2861424:9:1/Rick.and.Morty.S9E1')).toEqual({
      source: 'vidking',
      type: 'series',
      id: 'tt2861424',
      videoId: 'tt2861424:9:1',
    });
  });
  it('parses a movie path', () => {
    expect(parsePlayerPath('/player/rd/tt0137523/Fight.Club')).toEqual({
      source: 'rd',
      type: 'movie',
      id: 'tt0137523',
      videoId: null,
    });
  });
  it('parses without a cosmetic slug', () => {
    expect(parsePlayerPath('/player/vidking/tt2861424:9:1')).toEqual({
      source: 'vidking',
      type: 'series',
      id: 'tt2861424',
      videoId: 'tt2861424:9:1',
    });
  });
  it('tolerates a trailing slash', () => {
    expect(parsePlayerPath('/player/vidking/tt0137523/')?.id).toBe('tt0137523');
  });
  it('returns null for the legacy query form', () => {
    expect(parsePlayerPath('/player')).toBeNull();
  });
  it('parses an auto path', () => {
    expect(parsePlayerPath('/player/auto/tt11198330:2:6/House.of.the.Dragon')).toEqual({
      source: 'auto',
      type: 'series',
      id: 'tt11198330',
      videoId: 'tt11198330:2:6',
    });
  });
  it('returns null for an unknown source', () => {
    expect(parsePlayerPath('/player/torrent/tt0137523')).toBeNull();
  });
  it('round-trips build → parse for an episode', () => {
    const path = buildPlayerPath({ source: 'rd', id: 'tt2861424', videoId: 'tt2861424:9:1', title: 'x' });
    const parsed = parsePlayerPath(path);
    expect(parsed).toMatchObject({ source: 'rd', type: 'series', id: 'tt2861424', videoId: 'tt2861424:9:1' });
  });
});
