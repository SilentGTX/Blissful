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
  effectiveTrackLanguage,
  isImageSubtitleCodec,
  langPriority,
  languageFromTitle,
  languageMatch,
  isPartialSubtitleTrack,
  scoreSubtitleTrack,
  subtitleLangLabel,
  subtitleSyncScore,
  subtitleTrackLabel,
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
  // Fixed household order: English, then Bulgarian, ahead of everything else.
  // ("Off" isn't a language — each player renders it above the list.)
  it('puts every English spelling first', () => {
    for (const l of ['en', 'eng', 'english', 'en-US']) {
      expect(langPriority(l)).toBeGreaterThan(langPriority('bul'));
    }
  });

  it('puts Bulgarian second, above local and the alphabetical rest', () => {
    for (const l of ['bg', 'bul', 'bulgarian']) {
      expect(langPriority(l)).toBeGreaterThan(langPriority('local'));
      expect(langPriority(l)).toBeGreaterThan(langPriority('fr'));
    }
  });

  it('keeps local above the unpinned languages', () => {
    expect(langPriority('local')).toBeGreaterThan(langPriority('fr'));
    expect(langPriority('fr')).toBe(langPriority('spa'));
  });
});

// Embedded tracks whose container tag lies. A fansub batch mux tags every
// text track `eng` and puts the real language in the title; before this the
// picker showed ten "English" rows, nine of them not English, and the
// auto-pick took whichever the muxer listed first.
describe('languageFromTitle', () => {
  it('reads the language out of a track title', () => {
    expect(languageFromTitle('Bulgarian')).toBe('bul');
    expect(languageFromTitle('Português (Brasil)')).toBe('pob');
    expect(languageFromTitle('русский')).toBe('rus');
  });

  it('prefers the more specific language', () => {
    expect(languageFromTitle('Portuguese (Brazil)')).toBe('pob');
    expect(languageFromTitle('Malayalam')).toBe('mal');
  });

  it('says nothing for a title that names no language', () => {
    expect(languageFromTitle('Signs & Songs')).toBeNull();
    expect(languageFromTitle('')).toBeNull();
    expect(languageFromTitle(null)).toBeNull();
  });
});

describe('effectiveTrackLanguage', () => {
  it('lets the title override a generic tag', () => {
    expect(effectiveTrackLanguage('eng', 'Bulgarian')).toBe('bul');
    expect(effectiveTrackLanguage('und', 'Japanese')).toBe('jpn');
    expect(effectiveTrackLanguage(null, 'Français')).toBe('fra');
  });

  it('trusts a specific tag over the title', () => {
    expect(effectiveTrackLanguage('fra', 'English signs')).toBe('fra');
    expect(effectiveTrackLanguage('bul', 'Bulgarian')).toBe('bul');
  });

  it('keeps the tag when the title names nothing', () => {
    expect(effectiveTrackLanguage('eng', 'Signs & Songs')).toBe('eng');
    expect(effectiveTrackLanguage(null, null)).toBe('und');
  });
});

describe('subtitleTrackLabel', () => {
  it('keeps the title when it says more than the language', () => {
    expect(subtitleTrackLabel('eng', 'Signs & Songs')).toBe('English – Signs & Songs');
    expect(subtitleTrackLabel('eng', 'English (SDH)')).toBe('English (SDH)');
  });

  it('drops a title that only restates the language', () => {
    expect(subtitleTrackLabel('bul', 'Bulgarian')).toBe('Bulgarian');
    expect(subtitleTrackLabel('eng', null)).toBe('English');
  });
});

// Bitmap subs can't take the viewer's colour / size — mpv draws the release's
// own picture. The picker labels them so "I picked green and got white" has a
// visible answer, and the auto-pick prefers a text track when there is one.
describe('isImageSubtitleCodec', () => {
  it('knows the bitmap formats', () => {
    expect(isImageSubtitleCodec('hdmv_pgs_subtitle')).toBe(true);
    expect(isImageSubtitleCodec('dvd_subtitle')).toBe(true);
    expect(isImageSubtitleCodec('DVB_SUBTITLE')).toBe(true);
  });

  it('leaves text formats alone', () => {
    expect(isImageSubtitleCodec('ass')).toBe(false);
    expect(isImageSubtitleCodec('subrip')).toBe(false);
    expect(isImageSubtitleCodec('mov_text')).toBe(false);
    expect(isImageSubtitleCodec(null)).toBe(false);
  });
});

// Regression: the 2026-09-22 Bleach 120 report — subtitles over the opening,
// then nothing for 14 minutes after pressing skip-intro. The release embedded
// BOTH an "English Subs" dialogue track (252 cues) and a "Signs & Songs" track
// (31 cues, empty from 7.0m to 21.4m), and auto-pick took the signs one.
describe('isPartialSubtitleTrack', () => {
  it('flags signs/songs and forced tracks', () => {
    for (const label of [
      'English – Signs & Songs',
      'English - Signs/Songs',
      'Signs and Songs',
      'Signs',
      'English (forced)',
      'French (forced)',
      'S&S',
    ]) {
      expect(isPartialSubtitleTrack(label), label).toBe(true);
    }
  });

  it('leaves full dialogue tracks alone', () => {
    for (const label of [
      'English Subs',
      'English',
      'English (hearingimpaired)',
      'Spanish',
      'Portuguese',
      'Bulgarian Subs',
    ]) {
      expect(isPartialSubtitleTrack(label), label).toBe(false);
    }
  });

  it('does not match "signs" inside another word', () => {
    expect(isPartialSubtitleTrack('Designs')).toBe(false);
  });

  it('treats a missing label as full', () => {
    expect(isPartialSubtitleTrack(null)).toBe(false);
    expect(isPartialSubtitleTrack(undefined)).toBe(false);
  });
});

describe('scoreSubtitleTrack demotes partial tracks', () => {
  const embedded = (label: string, track: number) => ({
    origin: 'Embedded',
    url: `/extract-subtitle.vtt?url=https%3A%2F%2Frd%2Ffile.mkv&track=${track}`,
    label,
  });
  // The two real tracks, exactly as the player builds them.
  const signs = embedded('English – Signs & Songs', 3);
  const dialogue = embedded('English Subs', 4);

  it('ranks the dialogue track above the signs track', () => {
    expect(scoreSubtitleTrack(dialogue)).toBeGreaterThan(scoreSubtitleTrack(signs));
  });

  it('still loses to dialogue even when the signs track syncs perfectly', () => {
    // A signs track IS perfectly synced — its last cue lands near the end of
    // the episode — so without the penalty every signal rates it ideal.
    const EP = 1464;
    const syncedSigns = { ...signs, runtimeSec: 1419 };
    const unmeasuredDialogue = { ...dialogue, runtimeSec: null };
    expect(
      scoreSubtitleTrack(unmeasuredDialogue, { videoDurationSec: EP })
    ).toBeGreaterThan(scoreSubtitleTrack(syncedSigns, { videoDurationSec: EP }));
  });

  it('survives the alphabetical tiebreak that caused the bug', () => {
    // Same sort the player uses. The composed en-dash label sorts FIRST, so a
    // score tie hands the viewer the signs track.
    expect('English Subs'.localeCompare('English – Signs & Songs')).toBeGreaterThan(0);
    const picked = [signs, dialogue]
      .slice()
      .sort((a, b) => {
        const d = scoreSubtitleTrack(b) - scoreSubtitleTrack(a);
        if (d !== 0) return d;
        return a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label);
      })[0];
    expect(picked.label).toBe('English Subs');
  });
});
