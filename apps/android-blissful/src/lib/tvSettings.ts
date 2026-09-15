// TV settings store — the source of truth for the SettingsScreen.
//
// The shared web app persists player/appearance settings to the
// blissful-storage backend (StorageProvider.savePlayerSettings -> POST
// /settings). The RN core client is currently READ-ONLY
// (blissfulStorageApi.fetchStoredSettings reads `playerSettings.realDebridApiKey`
// from /settings but never writes), so until a write path exists in
// @blissful/core we persist locally to MMKV under a bliss* key. On launch we
// merge whatever the cloud already has for the signed-in user (currently just
// the Real-Debrid key) so the TV box reflects what the desktop/web app saved.
//
// FOLLOW-UP (cloud save): add a writeStoredSettings(token, settings) to
// apps/shared/blissful-core/src/blissfulStorageApi.ts (POST /settings, mirroring
// the desktop storageApi.ts), then call it from saveTvSettings() below. The
// local store stays as the offline fallback.
import { fetchStoredSettings } from '@blissful/core';
import { isKitsuId } from './animeKitsu';
import { toRgba } from './colorUtils';
import { kv } from './storage';

const SETTINGS_KEY = 'bliss:tvSettings';

// Mirrors the fields the desktop SettingsPage exposes that make sense on a TV
// remote. Colors are stored as hex (the swatch presets) — the web app stores
// rgba for subtitles, but on TV we only offer opaque preset swatches.
export type TvSettings = {
  // Advanced
  realDebridApiKey: string;
  tmdbApiKey: string;
  playInExternalPlayer: string;
  // Player
  subtitlesSizePx: number;
  subtitlesTextColor: string; // rgba (matches the account/desktop format)
  subtitlesBackgroundColor: string; // rgba (alpha 0 = transparent)
  subtitlesOutlineColor: string; // rgba
  subtitlesLanguage: string | null;
  audioLanguage: string | null;
  /** Default audio language for Anime Kitsu content (`kitsu:` ids) — anime is
   *  usually wanted in its original Japanese while the rest of the library stays
   *  on `audioLanguage`. `null` = same as `audioLanguage`. Offered in Settings
   *  only while the Anime Kitsu addon is installed, but applied by content id,
   *  so a Kitsu show already in Continue Watching keeps its language. A profile
   *  saved before this existed has no key at all and reads as the Japanese
   *  default — only an explicit null means "defer to the default".
   *  Mirrors playerSettings.kitsuAudioLanguage on web/desktop, which stores the
   *  ISO code ('jpn'); tvLanguageFromStored/ToStored bridge the two formats. */
  kitsuAudioLanguage: string | null;
  seekTimeDurationMs: number;
  seekShortTimeDurationMs: number;
  // Playback
  bingeWatching: boolean;
  nextVideoNotificationDurationMs: number;
  // Streaming
  streamingServerCacheSizeBytes: number | null; // null = unlimited
  // Appearance
  accentColor: string; // hex
  surfaceColor: string; // hex
};

export const DEFAULT_TV_SETTINGS: TvSettings = {
  realDebridApiKey: '',
  tmdbApiKey: '',
  playInExternalPlayer: 'none',
  subtitlesSizePx: 28,
  subtitlesTextColor: 'rgba(255,255,255,1)',
  subtitlesBackgroundColor: 'rgba(0,0,0,0)', // transparent
  subtitlesOutlineColor: 'rgba(0,0,0,0.75)',
  subtitlesLanguage: 'English',
  audioLanguage: 'English',
  kitsuAudioLanguage: 'Japanese',
  seekTimeDurationMs: 10000,
  seekShortTimeDurationMs: 4000,
  bingeWatching: true,
  nextVideoNotificationDurationMs: 30000,
  streamingServerCacheSizeBytes: 5368709120, // 5 GB default (overridden by the account value when signed in)
  accentColor: '#95a2ff',
  surfaceColor: '#282f40',
};

export function readTvSettings(): TvSettings {
  try {
    const raw = kv.get(SETTINGS_KEY);
    if (!raw) return DEFAULT_TV_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<TvSettings>;
    const merged = { ...DEFAULT_TV_SETTINGS, ...parsed };
    // Normalise subtitle colours to rgba so a value cached as hex (pre-rgba
    // builds) still matches its swatch and renders in the preview.
    merged.subtitlesTextColor = toRgba(merged.subtitlesTextColor);
    merged.subtitlesBackgroundColor = toRgba(merged.subtitlesBackgroundColor);
    merged.subtitlesOutlineColor = toRgba(merged.subtitlesOutlineColor);
    return merged;
  } catch {
    return DEFAULT_TV_SETTINGS;
  }
}

export function writeTvSettings(settings: TvSettings): void {
  try {
    kv.set(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore — local cache, best-effort
  }
}

// Pull whatever the cloud already has for this user and fold it into the local
// settings. Today the read-only RN storage client only returns the Real-Debrid
// key; we merge it so the TV box matches the desktop without clobbering local
// fields the cloud doesn't track yet. Returns the merged settings (already
// written back to MMKV) or the local settings unchanged on any failure.
export async function hydrateTvSettingsFromCloud(token: string | null): Promise<TvSettings> {
  const local = readTvSettings();
  if (!token) return local;
  try {
    // The backend returns the FULL playerSettings (the desktop saves every field);
    // the typed return is a subset, so read it broadly. Field names match TvSettings
    // 1:1, so pull every TV field the cloud has (use !== undefined so 0/null/'' are
    // honoured).
    const remote = (await fetchStoredSettings(token)) as Record<string, unknown> | null;
    if (!remote) return local;
    const merged: TvSettings = { ...local };
    (Object.keys(DEFAULT_TV_SETTINGS) as (keyof TvSettings)[]).forEach((k) => {
      if (remote[k] !== undefined) (merged as Record<string, unknown>)[k] = remote[k];
    });
    // The account stores languages as ISO codes; map them to the TV's English
    // names so the Player dropdowns show the saved value rather than a blank.
    merged.subtitlesLanguage = tvLanguageFromStored(merged.subtitlesLanguage);
    merged.audioLanguage = tvLanguageFromStored(merged.audioLanguage);
    // Absent in the cloud (a profile saved before the option existed) keeps the
    // local Japanese default — the merge loop above only copies !== undefined,
    // which is exactly the web's kitsuAudioPreference() rule. An explicit null
    // travels through as null = "same as the default audio track".
    merged.kitsuAudioLanguage = tvLanguageFromStored(merged.kitsuAudioLanguage);
    // Subtitle colours come from the account as rgba (the desktop format).
    // Normalise to rgba so the picker can show them (and any custom colour still
    // renders in the live preview even if it isn't one of the swatches).
    merged.subtitlesTextColor = toRgba(merged.subtitlesTextColor);
    merged.subtitlesBackgroundColor = toRgba(merged.subtitlesBackgroundColor);
    merged.subtitlesOutlineColor = toRgba(merged.subtitlesOutlineColor);
    writeTvSettings(merged);
    return merged;
  } catch {
    return local;
  }
}

// --- Option catalogues (mirror apps/web-blissful/src/lib/playerSettings.ts) ---

export const SUBTITLE_SIZE_OPTIONS_PX = [16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 120];

export const NEXT_VIDEO_POPUP_OPTIONS_MS = [0, 5000, 10000, 15000, 20000, 30000, 45000, 60000];

// Mirrors SEEK_TIME_DURATION_OPTIONS_MS / SEEK_SHORT_TIME_DURATION_OPTIONS_MS
// from apps/web-blissful/src/lib/playerSettings.ts.
export const SEEK_TIME_DURATION_OPTIONS_MS = [5000, 10000, 15000, 20000, 30000, 45000, 60000];

export const SEEK_SHORT_TIME_DURATION_OPTIONS_MS = [1000, 2000, 3000, 4000, 5000, 7000, 10000];

// Streaming-server torrent cache ceiling. `null` = unlimited (mapped to the
// 'unlimited' select key). Verbatim from STREAMING_CACHE_SIZE_OPTIONS.
export const STREAMING_CACHE_SIZE_OPTIONS: { value: number | null; label: string }[] = [
  { value: 0, label: 'No caching' },
  { value: 2147483648, label: '2 GB' },
  { value: 5368709120, label: '5 GB' },
  { value: 10737418240, label: '10 GB' },
  { value: 21474836480, label: '20 GB' },
  { value: 53687091200, label: '50 GB' },
  { value: 107374182400, label: '100 GB' },
  { value: 214748364800, label: '200 GB' },
  { value: null, label: 'Unlimited' },
];

// Verbatim from EXTERNAL_PLAYER_OPTIONS.
export const EXTERNAL_PLAYER_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'vlc', label: 'VLC' },
  { value: 'download', label: 'Download playlist (.m3u)' },
];

// A compact, remote-friendly subset of the desktop language list (the desktop
// list is the full ISO catalogue — far too long to scroll on a D-pad). Covers
// the languages a TV user is realistically picking for subs/audio defaults.
export const TV_LANGUAGE_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Italian', label: 'Italian' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Dutch', label: 'Dutch' },
  { value: 'Russian', label: 'Russian' },
  { value: 'Polish', label: 'Polish' },
  { value: 'Turkish', label: 'Turkish' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Hindi', label: 'Hindi' },
  { value: 'Japanese', label: 'Japanese' },
  { value: 'Korean', label: 'Korean' },
  { value: 'Chinese', label: 'Chinese' },
];

// The account/desktop stores subtitle + audio language as an ISO 639-2 code
// (the keys of apps/web-blissful/src/lib/languageNames.json — `eng`, `spa`, …),
// while the TV's TV_LANGUAGE_OPTIONS uses English names. Map both ways so a saved
// value DISPLAYS as a TV option (instead of a blank dropdown) and a TV change
// round-trips back to the account in the desktop's code format.
const TV_LANG_CODE_TO_NAME: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fra: 'French', fre: 'French', deu: 'German', ger: 'German',
  ita: 'Italian', por: 'Portuguese', nld: 'Dutch', dut: 'Dutch', rus: 'Russian', pol: 'Polish',
  tur: 'Turkish', ara: 'Arabic', hin: 'Hindi', jpn: 'Japanese', kor: 'Korean', zho: 'Chinese', chi: 'Chinese',
};
const TV_NAME_TO_LANG_CODE: Record<string, string> = {
  english: 'eng', spanish: 'spa', french: 'fra', german: 'deu', italian: 'ita', portuguese: 'por',
  dutch: 'nld', russian: 'rus', polish: 'pol', turkish: 'tur', arabic: 'ara', hindi: 'hin',
  japanese: 'jpn', korean: 'kor', chinese: 'zho',
};

/** Stored value (code / English name / null) → a TV_LANGUAGE_OPTIONS value so the
 *  dropdown can show it. Unknown names pass through (still displayed). */
export function tvLanguageFromStored(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  const byCode = TV_LANG_CODE_TO_NAME[s.toLowerCase()];
  if (byCode) return byCode;
  const opt = TV_LANGUAGE_OPTIONS.find((o) => o.value && o.value.toLowerCase() === s.toLowerCase());
  return opt?.value ?? s;
}

/** TV English name → the account's ISO code (so a TV change round-trips to the
 *  desktop format). Unknown names / null pass through. */
export function tvLanguageToStored(v: string | null): string | null {
  if (!v) return null;
  return TV_NAME_TO_LANG_CODE[v.toLowerCase()] ?? v;
}

// --- Preference resolution (mirrors web playerSettings.ts) -------------------

/** The Anime Kitsu audio preference, or `null` for "same as the default audio
 *  track". A settings object with no key at all (saved before the option
 *  existed) gets the Japanese default; only an explicit null defers. */
export function kitsuAudioPreference(
  settings: Pick<TvSettings, 'kitsuAudioLanguage'>,
): string | null {
  const value = settings.kitsuAudioLanguage;
  if (value === undefined) return DEFAULT_TV_SETTINGS.kitsuAudioLanguage;
  return value && value.trim() !== '' ? value : null;
}

/** The audio language the player should prefer for the content `id`: the Anime
 *  Kitsu preference for `kitsu:` shows/episodes, the profile default otherwise.
 *  `null` = no preference (leave the file's own default track alone). */
export function effectiveAudioLanguage(
  settings: Pick<TvSettings, 'audioLanguage' | 'kitsuAudioLanguage'>,
  id: string | null | undefined,
): string | null {
  if (isKitsuId(id)) {
    const kitsu = kitsuAudioPreference(settings);
    if (kitsu) return kitsu;
  }
  return settings.audioLanguage ?? null;
}

// Every spelling a track's `language` field may use for one of our preference
// names: ISO 639-2/T, 639-2/B where it differs, and 639-1. The player used to
// compare the preference NAME against the track code with a two-way
// startsWith, which quietly worked only where the code is a prefix of the
// English name ('english'/'eng', 'spanish'/'spa') and failed wherever they
// diverge — 'japanese' never matched a 'jpn' track, nor 'german' a 'deu',
// 'french' a 'fra', 'dutch' a 'nld', 'chinese' a 'zho'. Japanese is exactly
// what the Anime Kitsu default needs, so the matching is table-driven now.
const LANGUAGE_MATCH_TOKENS: Record<string, string[]> = {
  english: ['eng', 'en'],
  spanish: ['spa', 'es'],
  french: ['fra', 'fre', 'fr'],
  german: ['deu', 'ger', 'de'],
  italian: ['ita', 'it'],
  portuguese: ['por', 'pt'],
  dutch: ['nld', 'dut', 'nl'],
  russian: ['rus', 'ru'],
  polish: ['pol', 'pl'],
  turkish: ['tur', 'tr'],
  arabic: ['ara', 'ar'],
  hindi: ['hin', 'hi'],
  japanese: ['jpn', 'ja'],
  korean: ['kor', 'ko'],
  chinese: ['zho', 'chi', 'zh'],
};

/** Does a track's language/label satisfy the saved preference? `pref` is a TV
 *  option ('Japanese'), a raw ISO code passed through from the account, or
 *  null/'None' (never matches). Short codes must match exactly or as a tagged
 *  prefix ('pt-BR'), so 'ja' can't swallow 'jav'; full names may match loosely
 *  so a track labelled "Japanese (stereo)" still counts. */
export function languageMatches(
  trackLanguage: string | null | undefined,
  pref: string | null | undefined,
): boolean {
  const l = (trackLanguage ?? '').trim().toLowerCase();
  const p = (pref ?? '').trim().toLowerCase();
  if (!l || !p || p === 'none') return false;
  const tokens = [p, ...(LANGUAGE_MATCH_TOKENS[p] ?? [])];
  return tokens.some((t) =>
    l === t || l.startsWith(`${t}-`) || l.startsWith(`${t}_`) || (t.length >= 4 && l.includes(t)),
  );
}

// Accent / subtitle text color presets — the same set the desktop TV branch
// offers (TV_COLOR_PRESETS in SettingsPage.tsx). Remote-friendly opaque swatches.
export const TV_COLOR_PRESETS = [
  '#95a2ff',
  '#19f7d2',
  '#ffffff',
  '#000000',
  '#ffd60a',
  '#ff453a',
  '#32d74b',
  '#0a84ff',
  '#bf5af2',
  '#ff9f0a',
];

// Dark, legibility-safe surface (glass) presets — verbatim from the desktop
// SURFACE_COLOR_PRESETS. First entry is the default dark glass.
export const SURFACE_COLOR_PRESETS = [
  '#282f40',
  '#2c2c2c',
  '#1b1d29',
  '#1f2937',
  '#16302e',
  '#2a2140',
  '#1e2a1c',
  '#321e26',
];
