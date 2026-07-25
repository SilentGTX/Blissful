// Language canonicalization tests. subtitleLangLabel is shared by the web
// player AND (via NativeMpvPlayer/subtitleHelpers' re-export) the desktop
// mpv player. The three spellings that reach it in production — mpv's
// verbatim MKV IETF tags ("en-US"), addon ISO-639 codes ("eng"), and full
// display names ("English") — must all fold onto one canonical label, or
// the subtitle picker splits a single language into several rows (the
// desktop "En-us" + "English" bug: embedded en-US tracks refused to merge
// with built-in OpenSubtitles results tagged eng).

import { describe, expect, it } from 'vitest';
import {
  langPriority,
  languageMatch,
  scoreSubtitleTrack,
  subtitleLangLabel,
  subtitleSyncScore,
} from './subtitleUtils';

// Auto-pick sync matching. The user this exists for cannot hear whether a
// subtitle is in sync (they don't speak the audio language), so the app has to
// decide from the only language-independent signal: how the subtitle's own
// runtime compares with the video's real duration.
describe('subtitleSyncScore', () => {
  const EP = 67 * 60; // a ~1:07 episode

  it('rewards a subtitle whose runtime matches the video', () => {
    expect(subtitleSyncScore(EP - 30, EP)).toBeGreaterThan(0);
    expect(subtitleSyncScore(EP, EP)).toBeGreaterThan(0);
  });

  it('rejects a subtitle timed for a different cut', () => {
    // 1:09 subs against a 1:07 episode, and a theatrical sub on a longer cut.
    expect(subtitleSyncScore(69 * 60, EP)).toBeLessThan(0);
    expect(subtitleSyncScore(163 * 60, 196 * 60)).toBeLessThan(0);
  });

  it('is neutral when either side is unknown, never punishing missing data', () => {
    expect(subtitleSyncScore(null, EP)).toBe(0);
    expect(subtitleSyncScore(EP, null)).toBe(0);
    expect(subtitleSyncScore(0, EP)).toBe(0);
  });
});

describe('scoreSubtitleTrack with a video duration', () => {
  const EP = 67 * 60;
  const track = (origin: string, runtimeSec: number | null) => ({
    origin, url: 'https://x/s.srt', runtimeSec,
  });

  it('prefers an in-sync subtitle over a better-sourced out-of-sync one', () => {
    const inSync = scoreSubtitleTrack(track('Bulgarian Subs', EP - 20), { videoDurationSec: EP });
    const outOfSync = scoreSubtitleTrack(track('OpenSubtitles', 90 * 60), { videoDurationSec: EP });
    expect(inSync).toBeGreaterThan(outOfSync);
  });

  it('falls back to provenance when no runtime is known', () => {
    const os = scoreSubtitleTrack(track('OpenSubtitles', null), { videoDurationSec: EP });
    const other = scoreSubtitleTrack(track('Some Addon', null), { videoDurationSec: EP });
    expect(os).toBeGreaterThan(other);
  });

  it('keeps working with no duration at all (early in playback)', () => {
    expect(scoreSubtitleTrack(track('OpenSubtitles', EP))).toBeGreaterThan(0);
  });
});

describe('subtitleLangLabel', () => {
  it('maps ISO codes and full names onto the canonical label', () => {
    expect(subtitleLangLabel('en')).toBe('English');
    expect(subtitleLangLabel('eng')).toBe('English');
    expect(subtitleLangLabel('English')).toBe('English');
    expect(subtitleLangLabel('ger')).toBe('German');
    expect(subtitleLangLabel('alb')).toBe('Albanian');
  });

  it('folds BCP-47 region/script tags onto the base language', () => {
    expect(subtitleLangLabel('en-US')).toBe('English');
    expect(subtitleLangLabel('en-us')).toBe('English');
    expect(subtitleLangLabel('es-419')).toBe('Spanish');
    expect(subtitleLangLabel('zh-Hans')).toBe('Chinese');
    expect(subtitleLangLabel('sr_Latn')).toBe('Serbian');
  });

  it('keeps explicitly-mapped multi-part tags intact', () => {
    expect(subtitleLangLabel('pt-br')).toBe('Portuguese (BR)');
    expect(subtitleLangLabel('pt')).toBe('Portuguese');
  });

  it('falls back to the capitalized raw tag for unknown languages', () => {
    expect(subtitleLangLabel('tlh')).toBe('TLH');
    expect(subtitleLangLabel('xx-klingon')).toBe('Xx-klingon');
    expect(subtitleLangLabel('')).toBe('Unknown');
  });
});

describe('languageMatch', () => {
  it('matches region-tagged codes against plain codes in both directions', () => {
    expect(languageMatch('eng', 'en-US')).toBe(true);
    expect(languageMatch('en-us', 'eng')).toBe(true);
    expect(languageMatch('es', 'es-419')).toBe(true);
  });

  it('keeps existing alias matches working', () => {
    expect(languageMatch('ger', 'de')).toBe(true);
    expect(languageMatch('en', 'eng')).toBe(true);
  });

  it('rejects different languages and empty input', () => {
    expect(languageMatch('spa', 'en-US')).toBe(false);
    expect(languageMatch(null, 'eng')).toBe(false);
    expect(languageMatch('eng', null)).toBe(false);
  });
});

describe('langPriority', () => {
  it('ranks every English spelling above other languages, below Local', () => {
    expect(langPriority('local')).toBe(2);
    expect(langPriority('en')).toBe(1);
    expect(langPriority('eng')).toBe(1);
    expect(langPriority('english')).toBe(1);
    expect(langPriority('en-US')).toBe(1);
    expect(langPriority('fr')).toBe(0);
  });
});
