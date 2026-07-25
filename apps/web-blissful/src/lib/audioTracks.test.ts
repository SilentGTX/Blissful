import { describe, it, expect } from 'vitest';
import { pickPreferredAudioTrack, type ProbedAudioTrack } from './audioTracks';

const t = (i: number, lang: string | null, title: string | null, channels = 6): ProbedAudioTrack => ({
  i,
  lang,
  title,
  channels,
  codec: 'ac3',
});

describe('pickPreferredAudioTrack', () => {
  // The real-world case: a French release whose FIRST track is French, played
  // by a profile that prefers English. Track 0 used to win unconditionally.
  const frenchRelease = [
    t(0, 'fre', 'VFF AC3 5.1 @448kbps'),
    t(1, 'fre', 'VFQ AC3 5.1 @448kbps'),
    t(2, 'eng', 'VO AC3 5.1 @640kbps'),
  ];

  it('picks the English track out of a French-first release', () => {
    expect(pickPreferredAudioTrack(frenchRelease, 'eng')).toBe(2);
  });

  it('matches code variants (en, en-US, english) against the eng tag', () => {
    expect(pickPreferredAudioTrack(frenchRelease, 'en')).toBe(2);
    expect(pickPreferredAudioTrack([t(0, 'en-US', 'Main')], 'eng')).toBe(0);
    expect(pickPreferredAudioTrack([t(0, 'fra', 'VF'), t(1, 'english', 'VO')], 'eng')).toBe(1);
  });

  it('honours a non-English preference too', () => {
    expect(pickPreferredAudioTrack(frenchRelease, 'fre')).toBe(0);
    expect(pickPreferredAudioTrack(frenchRelease, 'fra')).toBe(0);
  });

  it('prefers the highest channel count among same-language matches', () => {
    const tracks = [t(0, 'eng', 'Stereo', 2), t(1, 'eng', 'Surround', 6)];
    expect(pickPreferredAudioTrack(tracks, 'eng')).toBe(1);
  });

  it('returns null when nothing matches, so the caller keeps its selection', () => {
    expect(pickPreferredAudioTrack([t(0, 'fre', 'VFF'), t(1, 'ger', 'DE')], 'eng')).toBeNull();
  });

  it('never guesses from scene-shorthand titles', () => {
    // "VO" is the French label for the original (here English) audio, but it is
    // not a language code — an untagged track must not be treated as a match.
    expect(pickPreferredAudioTrack([t(0, null, 'VO'), t(1, null, 'VFF')], 'eng')).toBeNull();
  });

  it('returns null for no preference / no tracks', () => {
    expect(pickPreferredAudioTrack(frenchRelease, null)).toBeNull();
    expect(pickPreferredAudioTrack(frenchRelease, '')).toBeNull();
    expect(pickPreferredAudioTrack([], 'eng')).toBeNull();
  });
});
