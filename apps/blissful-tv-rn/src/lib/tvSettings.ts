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
// packages/blissful-core/src/blissfulStorageApi.ts (POST /settings, mirroring
// the desktop storageApi.ts), then call it from saveTvSettings() below. The
// local store stays as the offline fallback.
import { fetchStoredSettings } from '@blissful/core';
import { kv } from './storage';

const SETTINGS_KEY = 'bliss:tvSettings';

// Mirrors the fields the desktop SettingsPage exposes that make sense on a TV
// remote. Colors are stored as hex (the swatch presets) — the web app stores
// rgba for subtitles, but on TV we only offer opaque preset swatches.
export type TvSettings = {
  // Advanced
  realDebridApiKey: string;
  tmdbApiKey: string;
  // Player
  subtitlesSizePx: number;
  subtitlesTextColor: string; // hex
  subtitlesLanguage: string | null;
  audioLanguage: string | null;
  // Playback
  bingeWatching: boolean;
  nextVideoNotificationDurationMs: number;
  // Appearance
  accentColor: string; // hex
  surfaceColor: string; // hex
};

export const DEFAULT_TV_SETTINGS: TvSettings = {
  realDebridApiKey: '',
  tmdbApiKey: '',
  subtitlesSizePx: 28,
  subtitlesTextColor: '#ffffff',
  subtitlesLanguage: 'English',
  audioLanguage: null,
  bingeWatching: true,
  nextVideoNotificationDurationMs: 30000,
  accentColor: '#95a2ff',
  surfaceColor: '#282f40',
};

export function readTvSettings(): TvSettings {
  try {
    const raw = kv.get(SETTINGS_KEY);
    if (!raw) return DEFAULT_TV_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<TvSettings>;
    return { ...DEFAULT_TV_SETTINGS, ...parsed };
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
    const remote = await fetchStoredSettings(token);
    if (!remote) return local;
    const merged: TvSettings = {
      ...local,
      realDebridApiKey: remote.realDebridApiKey ?? local.realDebridApiKey,
    };
    writeTvSettings(merged);
    return merged;
  } catch {
    return local;
  }
}

// --- Option catalogues (mirror apps/blissful-mvs/src/lib/playerSettings.ts) ---

export const SUBTITLE_SIZE_OPTIONS_PX = [16, 20, 24, 28, 32, 36, 40, 48, 56, 64];

export const NEXT_VIDEO_POPUP_OPTIONS_MS = [0, 5000, 10000, 15000, 20000, 30000, 45000, 60000];

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
