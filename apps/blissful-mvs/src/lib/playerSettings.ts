import languageNames from './languageNames.json';

export type PlayerSettings = {
  subtitlesLanguage: string | null;
  subtitlesSizePx: number;
  subtitlesTextColor: string;
  subtitlesBackgroundColor: string;
  subtitlesOutlineColor: string;
  assSubtitlesStyling: boolean;
  audioLanguage: string | null;
  surroundSound: boolean;
  seekTimeDurationMs: number;
  seekShortTimeDurationMs: number;
  playInExternalPlayer: string;
  nextVideoNotificationDurationMs: number;
  bingeWatching: boolean;
  playInBackground: boolean;
  pauseOnMinimize: boolean;
  /** Streaming-server torrent cache size in bytes. `null` = unlimited. */
  streamingServerCacheSizeBytes: number | null;
};

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  subtitlesLanguage: null,
  subtitlesSizePx: 28,
  subtitlesTextColor: 'rgba(255, 255, 255, 1)',
  subtitlesBackgroundColor: 'rgba(0, 0, 0, 0)',
  subtitlesOutlineColor: 'rgba(0, 0, 0, 0.75)',
  assSubtitlesStyling: true,
  audioLanguage: null,
  surroundSound: false,
  seekTimeDurationMs: 10000,
  seekShortTimeDurationMs: 4000,
  playInExternalPlayer: 'none',
  nextVideoNotificationDurationMs: 30000,
  bingeWatching: true,
  playInBackground: false,
  pauseOnMinimize: true,
  // 100 GB default — high enough that the cache rarely trims on play.
  // The cache is a max ceiling, not a fixed allocation: only fills as
  // torrents are streamed.
  streamingServerCacheSizeBytes: 107374182400,
};

export const STREAMING_CACHE_SIZE_OPTIONS: Array<{
  value: number | null;
  label: string;
}> = [
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

const LANGUAGE_NAMES = languageNames as Record<string, string>;

const languageOptions = Object.entries(LANGUAGE_NAMES)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

export const PLAYER_LANGUAGE_OPTIONS = [{ value: null, label: 'None' }, ...languageOptions];

export const SUBTITLE_SIZE_OPTIONS_PX = [16, 20, 24, 28, 32, 36, 40, 48, 56, 64];

export const SEEK_TIME_DURATION_OPTIONS_MS = [5000, 10000, 15000, 20000, 30000, 45000, 60000];

export const SEEK_SHORT_TIME_DURATION_OPTIONS_MS = [1000, 2000, 3000, 4000, 5000, 7000, 10000];

export const NEXT_VIDEO_POPUP_OPTIONS_MS = [0, 5000, 10000, 15000, 20000, 30000, 45000, 60000];

export const EXTERNAL_PLAYER_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'vlc', label: 'VLC' },
  { value: 'download', label: 'Download playlist (.m3u)' },
];

const PLAYER_SETTINGS_KEY = 'blissful.playerSettings';

export function readStoredPlayerSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(PLAYER_SETTINGS_KEY);
    if (!raw) return DEFAULT_PLAYER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
    return { ...DEFAULT_PLAYER_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_PLAYER_SETTINGS;
  }
}

/** Live-update the streaming server's cache ceiling. The runtime's
 *  POST /settings accepts a partial body — only the field we change is
 *  applied.
 *
 *  IMPORTANT: stremio-service does NOT send CORS headers, so a direct
 *  fetch from the renderer (cross-origin: renderer:5175 → server:11470)
 *  fails preflight and dumps a CORS error in the console on every app
 *  start, regardless of try/catch (browsers log network errors before
 *  promise rejection). To keep the console quiet we skip the call here
 *  — the value still persists in localStorage via writeStoredPlayerSettings
 *  and the shell applies it at next boot when it spawns stremio-service.
 *  Live updates would need an IPC route through the shell; not wired
 *  yet. */
export async function applyStreamingServerCacheSize(
  _bytes: number | null,
): Promise<void> {
  // No-op for now (see block comment above).
}

export function writeStoredPlayerSettings(settings: PlayerSettings): void {
  try {
    localStorage.setItem(PLAYER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}
