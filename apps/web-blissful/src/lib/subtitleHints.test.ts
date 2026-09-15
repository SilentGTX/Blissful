import { describe, it, expect } from 'vitest';
import { detectSubtitleHint, subtitleHintRank } from './subtitleHints';

// Real release-name shapes. The point of these is the FALSE POSITIVES: the hint
// drives ordering in the picker, and a name that merely contains the letters
// "sub" or "multi" must not be promoted as if it were tagged.

describe('detectSubtitleHint', () => {
  it('reads explicit subtitle tags through dot/bracket separators', () => {
    expect(detectSubtitleHint('Show.S01E02.1080p.WEB-DL.MULTISUB.x264')).toMatchObject({ kind: 'subs', label: 'Multi-subs' });
    expect(detectSubtitleHint('Movie 2024 1080p BluRay ESub')).toMatchObject({ kind: 'subs', label: 'EN subs' });
    expect(detectSubtitleHint('Film.2019.VOSTFR.1080p')).toMatchObject({ kind: 'subs', label: 'FR subs' });
    expect(detectSubtitleHint('Series S02 [Subbed]')).toMatchObject({ kind: 'subs', label: 'Subs' });
    expect(detectSubtitleHint('Movie.2020.1080p.SDH')).toMatchObject({ kind: 'subs', label: 'SDH' });
  });

  it('reports MULTI as multi-audio, not as a subtitle promise', () => {
    // MULTI denotes multiple AUDIO tracks in scene naming. It correlates with
    // subtitles but must not be labelled as them.
    const hint = detectSubtitleHint('Film.2021.MULTi.1080p.WEB-DL.x264');
    expect(hint).toMatchObject({ kind: 'multi', label: 'Multi' });
    expect(detectSubtitleHint('Show S01 Dual Audio 1080p')).toMatchObject({ kind: 'multi' });
  });

  it('prefers the more specific tag when a name carries both', () => {
    // MULTISUB contains MULTI; the subtitle reading must win.
    expect(detectSubtitleHint('Film.2021.MULTi.MULTISUB.1080p')).toMatchObject({ kind: 'subs', label: 'Multi-subs' });
  });

  it('separates hardcoded subs from selectable ones', () => {
    // HARDSUB contains "sub" — it must not be read as soft subs.
    expect(detectSubtitleHint('Movie.2022.HARDSUB.720p')).toMatchObject({ kind: 'hardcoded', label: 'Hardsub' });
    expect(detectSubtitleHint('Movie.2022.Hardcoded.720p')).toMatchObject({ kind: 'hardcoded' });
  });

  it('recognises fansub groups that always softsub', () => {
    expect(detectSubtitleHint('[Erai-raws] Show - 12 [1080p]')).toMatchObject({ kind: 'subs', label: 'Multi-subs' });
    expect(detectSubtitleHint('[SubsPlease] Show - 01 (1080p) [ABCD1234].mkv')).toMatchObject({ kind: 'subs' });
  });

  it('does not fire on names that merely contain the letters', () => {
    // These are the regressions that matter — each would wrongly float up the list.
    expect(detectSubtitleHint('Submarine.2010.1080p.BluRay.x264')).toBeNull();
    expect(detectSubtitleHint('The.Substitute.1996.720p')).toBeNull();
    expect(detectSubtitleHint('Multiplicity.1996.1080p.WEBRip')).toBeNull();
    expect(detectSubtitleHint('Suburbicon.2017.1080p.BluRay')).toBeNull();
    expect(detectSubtitleHint('Subservience.2024.2160p')).toBeNull();
  });

  it('returns null for an ordinary untagged release', () => {
    expect(detectSubtitleHint('Show.S01E02.2160p.WEB-DL.DDP5.1.HDR.H265-GROUP')).toBeNull();
    expect(detectSubtitleHint(null, undefined, '')).toBeNull();
  });

  it('searches every name it is given', () => {
    // The addon display name and the torrent filename differ; either may carry it.
    expect(detectSubtitleHint('Torrentio\n1080p', 'Show.S01E01.1080p.MULTISUB.mkv')).toMatchObject({ kind: 'subs' });
  });
});

describe('subtitleHintRank', () => {
  it('orders explicit subs above multi-audio above unknown', () => {
    expect(subtitleHintRank(detectSubtitleHint('x.MULTISUB.x'))).toBe(0);
    expect(subtitleHintRank(detectSubtitleHint('x.MULTi.x'))).toBe(1);
    expect(subtitleHintRank(null)).toBe(2);
  });

  it('does not promote hardcoded subs', () => {
    // Visible but not selectable or styleable — worth showing, not worth ranking up.
    expect(subtitleHintRank(detectSubtitleHint('x.HARDSUB.x'))).toBe(2);
  });
});
