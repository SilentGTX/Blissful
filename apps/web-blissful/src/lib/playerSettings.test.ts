import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLAYER_SETTINGS,
  PINNED_LANGUAGE_CODES,
  PLAYER_LANGUAGE_OPTIONS,
  effectiveAudioLanguage,
  kitsuAudioPreference,
  readStoredPlayerSettings,
} from './playerSettings';
import { hasKitsuAddon, isKitsuAddon, isKitsuId } from './animeKitsu';

describe('PLAYER_LANGUAGE_OPTIONS ordering', () => {
  it('leads with None, then English, then Bulgarian', () => {
    expect(PLAYER_LANGUAGE_OPTIONS[0].value).toBeNull();
    expect(PLAYER_LANGUAGE_OPTIONS.slice(1, 3).map((o) => o.value)).toEqual(['eng', 'bul']);
  });

  it('keeps the remaining languages alphabetical by label', () => {
    const rest = PLAYER_LANGUAGE_OPTIONS.slice(1 + PINNED_LANGUAGE_CODES.length).map((o) => o.label);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it('does not duplicate or drop any language', () => {
    const values = PLAYER_LANGUAGE_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('effectiveAudioLanguage', () => {
  it('lands Anime Kitsu content on Japanese by default', () => {
    expect(effectiveAudioLanguage(DEFAULT_PLAYER_SETTINGS, 'kitsu:244')).toBe('jpn');
    expect(effectiveAudioLanguage(DEFAULT_PLAYER_SETTINGS, 'kitsu:244:3')).toBe('jpn');
    expect(effectiveAudioLanguage({ audioLanguage: 'eng', kitsuAudioLanguage: 'jpn' }, 'kitsu:244')).toBe('jpn');
  });

  it('treats a profile saved before the option existed as the Japanese default, not "same as default"', () => {
    // No key at all — what every stored profile looks like on first load after
    // the upgrade (the backend keeps the object it was given).
    expect(effectiveAudioLanguage({ audioLanguage: 'eng' }, 'kitsu:244')).toBe('jpn');
    expect(kitsuAudioPreference({})).toBe('jpn');
  });

  it('leaves everything that is not Kitsu on the profile default', () => {
    expect(effectiveAudioLanguage({ audioLanguage: 'eng' }, 'tt0434665')).toBe('eng');
    expect(effectiveAudioLanguage({ audioLanguage: 'eng' }, 'tt0434665:1:2')).toBe('eng');
    expect(effectiveAudioLanguage({ audioLanguage: 'eng' }, 'mal:1735')).toBe('eng');
    expect(effectiveAudioLanguage({ audioLanguage: 'eng' }, null)).toBe('eng');
    expect(effectiveAudioLanguage({ audioLanguage: null }, 'tt0434665')).toBeNull();
  });

  it('honours an explicit Kitsu language over the profile default', () => {
    expect(effectiveAudioLanguage({ audioLanguage: 'eng', kitsuAudioLanguage: 'bul' }, 'kitsu:244')).toBe('bul');
    expect(effectiveAudioLanguage({ audioLanguage: 'eng', kitsuAudioLanguage: 'bul' }, 'tt0434665')).toBe('eng');
  });

  it('"same as default" (null) falls through to the profile default for Kitsu content', () => {
    expect(kitsuAudioPreference({ kitsuAudioLanguage: null })).toBeNull();
    expect(kitsuAudioPreference({ kitsuAudioLanguage: '' })).toBeNull();
    expect(effectiveAudioLanguage({ audioLanguage: 'eng', kitsuAudioLanguage: null }, 'kitsu:244')).toBe('eng');
    expect(effectiveAudioLanguage({ audioLanguage: null, kitsuAudioLanguage: null }, 'kitsu:244')).toBeNull();
  });

  it('survives the localStorage round trip: absent key → default, stored null → same as default', () => {
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true });
    store.set('blissful.playerSettings', JSON.stringify({ audioLanguage: 'eng' }));
    expect(effectiveAudioLanguage(readStoredPlayerSettings(), 'kitsu:244')).toBe('jpn');
    store.set('blissful.playerSettings', JSON.stringify({ audioLanguage: 'eng', kitsuAudioLanguage: null }));
    expect(effectiveAudioLanguage(readStoredPlayerSettings(), 'kitsu:244')).toBe('eng');
  });
});

describe('isKitsuId', () => {
  it('matches Kitsu show and episode ids only', () => {
    expect(isKitsuId('kitsu:244')).toBe(true);
    expect(isKitsuId('kitsu:244:3')).toBe(true);
    expect(isKitsuId('KITSU:244')).toBe(true);
    expect(isKitsuId('tt0434665')).toBe(false);
    expect(isKitsuId('mal:1735')).toBe(false);
    expect(isKitsuId('')).toBe(false);
    expect(isKitsuId(null)).toBe(false);
    expect(isKitsuId(undefined)).toBe(false);
  });
});

describe('isKitsuAddon / hasKitsuAddon', () => {
  const kitsu = {
    transportUrl: 'https://anime-kitsu.strem.fun/manifest.json',
    manifest: { id: 'community.anime.kitsu', name: 'Anime Kitsu' },
  };
  const torrentio = {
    transportUrl: 'https://torrentio.strem.fun/manifest.json',
    manifest: { id: 'com.stremio.torrentio.addon', name: 'Torrentio' },
  };

  it('recognises the addon by URL, manifest id or name', () => {
    expect(isKitsuAddon(kitsu)).toBe(true);
    expect(isKitsuAddon({ transportUrl: 'https://example.com/m.json', manifest: { name: 'Anime Kitsu' } })).toBe(true);
    expect(isKitsuAddon({ transportUrl: 'https://example.com/m.json', manifest: { id: 'x.kitsu' } })).toBe(true);
    expect(isKitsuAddon({ transportUrl: 'https://my-host.example/kitsu/manifest.json' })).toBe(true);
    expect(isKitsuAddon(torrentio)).toBe(false);
  });

  it('reports whether the installed set includes it', () => {
    expect(hasKitsuAddon([torrentio, kitsu])).toBe(true);
    expect(hasKitsuAddon([torrentio])).toBe(false);
    expect(hasKitsuAddon([])).toBe(false);
  });
});
