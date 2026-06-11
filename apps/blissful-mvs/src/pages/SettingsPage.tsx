import { useEffect, useMemo, useState } from 'react';
import { ScrollShadow } from '@heroui/react';
import { BlissSelect } from '../components/base';
import { ChromePicker, type ColorResult } from 'react-color';
import { useAuth } from '../context/AuthProvider';
import { useStorage } from '../context/StorageProvider';
import { useUI } from '../context/UIProvider';
import { parseColor, buildRgba, hexToRgb } from '../lib/colorUtils';
import { SettingsStremioPanel } from '../components/SettingsStremioPanel';
import { notifySuccess } from '../lib/toastQueues';
import {
  EXTERNAL_PLAYER_OPTIONS,
  NEXT_VIDEO_POPUP_OPTIONS_MS,
  PLAYER_LANGUAGE_OPTIONS,
  SEEK_SHORT_TIME_DURATION_OPTIONS_MS,
  SEEK_TIME_DURATION_OPTIONS_MS,
  STREAMING_CACHE_SIZE_OPTIONS,
  SUBTITLE_SIZE_OPTIONS_PX,
  type PlayerSettings,
} from '../lib/playerSettings';

const USERNAME_RE = /^[a-z0-9_-]{3,50}$/;

export default function SettingsPage() {
  const { uiStyle, setUiStyle } = useUI();
  const { playerSettings, savePlayerSettings } = useStorage();
  const { user, updateProfile } = useAuth();
  const [colorModal, setColorModal] = useState<'text' | 'bg' | 'outline' | 'accent' | null>(null);

  // Username edit. Seeded from the live user, reset whenever the
  // server-side username changes (after a successful save or
  // /auth/me hydration). `usernameError` carries the server's
  // rejection message (validation, "already taken").
  const currentUsername = user?.username ?? '';
  const [usernameDraft, setUsernameDraft] = useState(currentUsername);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaving, setUsernameSaving] = useState(false);
  useEffect(() => {
    setUsernameDraft(currentUsername);
    setUsernameError(null);
  }, [currentUsername]);

  const draftLower = usernameDraft.trim().toLowerCase();
  const usernameDirty = draftLower !== currentUsername && draftLower.length > 0;
  const usernameValid = USERNAME_RE.test(draftLower);
  const usernameSaveDisabled = !usernameDirty || !usernameValid || usernameSaving;

  const handleSaveUsername = async () => {
    if (usernameSaveDisabled) return;
    setUsernameError(null);
    setUsernameSaving(true);
    try {
      await updateProfile({ username: draftLower });
      notifySuccess('Username updated', `You're now @${draftLower}.`);
    } catch (err: unknown) {
      setUsernameError(err instanceof Error ? err.message : 'Failed to update username');
    } finally {
      setUsernameSaving(false);
    }
  };

  // Display name edit. Free-form (anything goes), capped at 60 chars
  // server-side. No uniqueness — two users can share a display name.
  const currentDisplayName = user?.displayName ?? '';
  const [displayNameDraft, setDisplayNameDraft] = useState(currentDisplayName);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  useEffect(() => {
    setDisplayNameDraft(currentDisplayName);
    setDisplayNameError(null);
  }, [currentDisplayName]);

  const displayNameTrimmed = displayNameDraft.trim();
  const displayNameDirty =
    displayNameTrimmed !== currentDisplayName && displayNameTrimmed.length > 0;
  const displayNameSaveDisabled = !displayNameDirty || displayNameSaving;

  const handleSaveDisplayName = async () => {
    if (displayNameSaveDisabled) return;
    setDisplayNameError(null);
    setDisplayNameSaving(true);
    try {
      await updateProfile({ displayName: displayNameTrimmed });
      notifySuccess('Display name updated', `You're shown as ${displayNameTrimmed}.`);
    } catch (err: unknown) {
      setDisplayNameError(err instanceof Error ? err.message : 'Failed to update display name');
    } finally {
      setDisplayNameSaving(false);
    }
  };

  const updateSettings = (next: Partial<PlayerSettings>) => {
    void savePlayerSettings({ ...playerSettings, ...next });
  };

  const seekLabel = useMemo(
    () => (value: number) => `${Math.round(value / 1000)} sec`,
    []
  );

  const languageItems = useMemo(
    () =>
      [{ key: 'none', label: 'None' }].concat(
        PLAYER_LANGUAGE_OPTIONS.filter((opt) => opt.value).map((opt) => ({
          key: String(opt.value),
          label: opt.label,
        }))
      ),
    []
  );

  const sizeItems = useMemo(
    () => SUBTITLE_SIZE_OPTIONS_PX.map((size) => ({ key: String(size), label: `${size}px` })),
    []
  );

  const seekItems = useMemo(
    () =>
      SEEK_TIME_DURATION_OPTIONS_MS.map((value) => ({
        key: String(value),
        label: seekLabel(value),
      })),
    [seekLabel]
  );

  const seekShiftItems = useMemo(
    () =>
      SEEK_SHORT_TIME_DURATION_OPTIONS_MS.map((value) => ({
        key: String(value),
        label: seekLabel(value),
      })),
    [seekLabel]
  );

  const nextPopupItems = useMemo(
    () =>
      NEXT_VIDEO_POPUP_OPTIONS_MS.map((value) => ({
        key: String(value),
        label: value === 0 ? 'Disabled' : seekLabel(value),
      })),
    [seekLabel]
  );

  const externalPlayerItems = useMemo(
    () => EXTERNAL_PLAYER_OPTIONS.map((opt) => ({ key: opt.value, label: opt.label })),
    []
  );

  // `null` is a valid cache size (= unlimited) so we map it to the
  // string 'unlimited' for the select key. 0 stays as '0' (no caching).
  const cacheSizeItems = useMemo(
    () =>
      STREAMING_CACHE_SIZE_OPTIONS.map((opt) => ({
        key: opt.value === null ? 'unlimited' : String(opt.value),
        label: opt.label,
      })),
    []
  );

  const subtitleTextColor = parseColor(playerSettings.subtitlesTextColor);
  const subtitleBgColor = parseColor(playerSettings.subtitlesBackgroundColor);
  const subtitleOutlineColor = parseColor(playerSettings.subtitlesOutlineColor);
  const accentColor = parseColor(playerSettings.accentColor ?? '#95a2ff');

  const activeColor = colorModal === 'text'
    ? subtitleTextColor
    : colorModal === 'bg'
      ? subtitleBgColor
      : colorModal === 'outline'
        ? subtitleOutlineColor
        : colorModal === 'accent'
          ? accentColor
          : null;

  const updateColor = (key: 'text' | 'bg' | 'outline' | 'accent', hex: string, alpha: number) => {
    const rgba = buildRgba(hex, alpha);
    if (key === 'text') updateSettings({ subtitlesTextColor: rgba });
    if (key === 'bg') updateSettings({ subtitlesBackgroundColor: rgba });
    if (key === 'outline') updateSettings({ subtitlesOutlineColor: rgba });
    // Accent is intentionally hex-only (no alpha) — applying a
    // semi-transparent --bliss-accent would dim every chip / focus ring
    // on the site, which isn't what the user wants when they pick a
    // new accent. The picker still shows an alpha slider for parity
    // with the subtitle pickers but we discard it here.
    if (key === 'accent') updateSettings({ accentColor: hex });
  };

  return (
    <>
      <div className="mt-4">
        <div className="solid-surface rounded-[28px] bg-white/6 p-6 ">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-[Instrument_Serif] text-2xl font-semibold">Settings</div>
              <div className="text-sm text-foreground/60">Customize your experience</div>
            </div>
          </div>

          <ScrollShadow className="mt-6 max-h-[calc(100vh-14rem)] space-y-6 pr-1" hideScrollBar>
            <div>
              <div className="text-lg font-semibold mb-3">Style</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  className={
                    'rounded-2xl border px-4 py-4 text-left transition ' +
                    (uiStyle === 'classic'
                      ? 'border-white bg-white/15 text-white'
                      : 'border-white/10 bg-white/5 text-foreground/70 hover:bg-white/10')
                  }
                  onClick={() => setUiStyle('classic')}
                >
                  <div className="text-sm font-semibold">Classic</div>
                  <div className="mt-1 text-xs text-foreground/60">
                    Solid surfaces with simple layout.
                  </div>
                </button>
                <button
                  type="button"
                  className={
                    'rounded-2xl border px-4 py-4 text-left transition ' +
                    (uiStyle === 'netflix'
                      ? 'border-white bg-white/15 text-white'
                      : 'border-white/10 bg-white/5 text-foreground/70 hover:bg-white/10')
                  }
                  onClick={() => setUiStyle('netflix')}
                >
                  <div className="text-sm font-semibold">Kecflix</div>
                  <div className="mt-1 text-xs text-foreground/60">
                    Dark UI with Kecflix-style navigation and rails.
                  </div>
                </button>
                <button
                  type="button"
                  className={
                    'rounded-2xl border px-4 py-4 text-left transition ' +
                    (uiStyle === 'modern'
                      ? 'border-white bg-white/15 text-white'
                      : 'border-white/10 bg-white/5 text-foreground/70 hover:bg-white/10')
                  }
                  onClick={() => setUiStyle('modern')}
                >
                  <div className="text-sm font-semibold">Modern</div>
                  <div className="mt-1 text-xs text-foreground/60">
                    Coverflow carousel with hero detail panel.
                  </div>
                </button>
              </div>
            </div>

            <div className="text-sm text-foreground/60">
              Solid colors only (background gradients removed).
            </div>

            <div>
              <div className="text-lg font-semibold mb-3">Accent color</div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">Site accent</div>
                    <div className="mt-1 text-xs text-foreground/60">
                      Used by progress bars, focus rings, badges, the loading spinner — anywhere the
                      default teal shows up. Syncs to your account.
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      aria-label="Pick accent color"
                      className="h-10 w-10 cursor-pointer rounded-full border border-white/20 shadow-inner"
                      style={{ background: accentColor.hex }}
                      onClick={() => setColorModal('accent')}
                    />
                    <button
                      type="button"
                      className="cursor-pointer rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-foreground/80 hover:bg-white/15"
                      onClick={() => updateSettings({ accentColor: '#95a2ff' })}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="text-lg font-semibold mb-3">Player</div>
              <div className="space-y-6">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Subtitles</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Language</div>
                      <BlissSelect
                        ariaLabel="Subtitles language"
                        selectedKey={playerSettings.subtitlesLanguage ?? 'none'}
                        onSelectionChange={(key) => {
                          updateSettings({ subtitlesLanguage: key === 'none' ? null : String(key) });
                        }}
                        items={languageItems}
                        triggerClassName="h-9"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Size</div>
                      <BlissSelect
                        ariaLabel="Subtitles size"
                        selectedKey={String(playerSettings.subtitlesSizePx)}
                        onSelectionChange={(key) => {
                          updateSettings({ subtitlesSizePx: Number.parseInt(String(key), 10) });
                        }}
                        items={sizeItems}
                        triggerClassName="h-9"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Text color</div>
                      <button
                        type="button"
                        className="flex w-full items-center justify-end rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
                        onClick={() => setColorModal('text')}
                      >
                        {subtitleTextColor.alpha === 0 ? (
                          <span className="text-xs text-foreground/70">transparent</span>
                        ) : (
                          <span
                            className="h-5 w-full rounded-full border border-white/20"
                            style={{ background: subtitleTextColor.hex }}
                          />
                        )}
                      </button>
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Background color</div>
                      <button
                        type="button"
                        className="flex w-full items-center justify-end rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
                        onClick={() => setColorModal('bg')}
                      >
                        {subtitleBgColor.alpha === 0 ? (
                          <span className="text-xs text-foreground/70">transparent</span>
                        ) : (
                          <span
                            className="h-5 w-full rounded-full border border-white/20"
                            style={{ background: subtitleBgColor.hex }}
                          />
                        )}
                      </button>
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Outline color</div>
                      <button
                        type="button"
                        className="flex w-full items-center justify-end rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
                        onClick={() => setColorModal('outline')}
                      >
                        {subtitleOutlineColor.alpha === 0 ? (
                          <span className="text-xs text-foreground/70">transparent</span>
                        ) : (
                          <span
                            className="h-5 w-full rounded-full border border-white/20"
                            style={{ background: subtitleOutlineColor.hex }}
                          />
                        )}
                      </button>
                    </div>

                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Audio</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Default audio track</div>
                      <BlissSelect
                        ariaLabel="Audio language"
                        selectedKey={playerSettings.audioLanguage ?? 'none'}
                        onSelectionChange={(key) => {
                          updateSettings({ audioLanguage: key === 'none' ? null : String(key) });
                        }}
                        items={languageItems}
                        triggerClassName="h-9"
                      />
                    </div>

                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Controls</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Seek key</div>
                      <BlissSelect
                        ariaLabel="Seek key"
                        selectedKey={String(playerSettings.seekTimeDurationMs)}
                        onSelectionChange={(key) => {
                          updateSettings({ seekTimeDurationMs: Number.parseInt(String(key), 10) });
                        }}
                        items={seekItems}
                        triggerClassName="h-9"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Seek key + Shift</div>
                      <BlissSelect
                        ariaLabel="Seek key shift"
                        selectedKey={String(playerSettings.seekShortTimeDurationMs)}
                        onSelectionChange={(key) => {
                          updateSettings({ seekShortTimeDurationMs: Number.parseInt(String(key), 10) });
                        }}
                        items={seekShiftItems}
                        triggerClassName="h-9"
                      />
                    </div>

                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Auto Play</div>

                  {/* Master enable/disable. Drives the "Auto next" toggle
                      inside the player's episode drawer too — both
                      surfaces read/write this same field. When off, the
                      Up Next overlay never surfaces and playback ends
                      cleanly without rolling into the next episode. */}
                  <label className="flex cursor-pointer select-none items-center justify-between gap-3 py-1">
                    <span className="flex flex-col">
                      <span className="text-sm text-foreground/85">Auto play next video</span>
                      <span className="text-xs text-foreground/55">
                        Automatically play the next episode when the current one ends.
                      </span>
                    </span>
                    <span
                      role="switch"
                      aria-checked={playerSettings.bingeWatching}
                      tabIndex={0}
                      className={
                        'relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition ' +
                        (playerSettings.bingeWatching
                          ? 'bg-[var(--bliss-accent)]'
                          : 'bg-white/15')
                      }
                      onClick={() =>
                        updateSettings({ bingeWatching: !playerSettings.bingeWatching })
                      }
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          updateSettings({ bingeWatching: !playerSettings.bingeWatching });
                        }
                      }}
                    >
                      <span
                        className={
                          'absolute top-0.5 h-5 w-5 rounded-full bg-white transition ' +
                          (playerSettings.bingeWatching ? 'left-5' : 'left-0.5')
                        }
                      />
                    </span>
                  </label>

                  <div
                    className={
                      'mt-4 border-t border-white/10 pt-4 transition-opacity ' +
                      (playerSettings.bingeWatching ? '' : 'pointer-events-none opacity-50')
                    }
                  >
                    <div className="text-xs text-foreground/60 mb-2">Next video popup</div>
                    <BlissSelect
                      ariaLabel="Next video popup"
                      isDisabled={!playerSettings.bingeWatching}
                      selectedKey={String(playerSettings.nextVideoNotificationDurationMs)}
                      onSelectionChange={(key) => {
                        updateSettings({
                          nextVideoNotificationDurationMs: Number.parseInt(String(key), 10),
                        });
                      }}
                      items={nextPopupItems}
                      triggerClassName="h-9"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Streaming server</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Cache size</div>
                      <BlissSelect
                        ariaLabel="Cache size"
                        selectedKey={
                          playerSettings.streamingServerCacheSizeBytes === null
                            ? 'unlimited'
                            : String(playerSettings.streamingServerCacheSizeBytes)
                        }
                        onSelectionChange={(key) => {
                          if (typeof key !== 'string') return;
                          const next =
                            key === 'unlimited' ? null : Number.parseInt(key, 10);
                          if (key !== 'unlimited' && !Number.isFinite(next)) return;
                          updateSettings({
                            streamingServerCacheSizeBytes:
                              key === 'unlimited' ? null : (next as number),
                          });
                        }}
                        items={cacheSizeItems}
                        triggerClassName="h-9"
                      />
                      <div className="mt-2 text-xs text-foreground/50">
                        Maximum disk space the torrent cache may grow to.
                        Only fills as you stream. Larger values reduce
                        cache trims at playback start.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Advanced</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Play in external player</div>
                      <BlissSelect
                        ariaLabel="External player"
                        selectedKey={playerSettings.playInExternalPlayer}
                        onSelectionChange={(key) => {
                          if (typeof key === 'string') updateSettings({ playInExternalPlayer: key });
                        }}
                        items={externalPlayerItems}
                        triggerClassName="h-9"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <div className="text-xs text-foreground/60 mb-2">Real-Debrid API key</div>
                      <input
                        type="text"
                        value={playerSettings.realDebridApiKey ?? ''}
                        onChange={(e) => updateSettings({ realDebridApiKey: e.target.value.trim() })}
                        placeholder="paste your Real-Debrid API key"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-foreground/40 focus:border-[var(--bliss-accent)] focus:outline-none"
                      />
                      <div className="mt-2 text-xs text-foreground/50">
                        All torrent streams will be resolved through
                        Real-Debrid for instant playback. Non-RD
                        Torrentio results are hidden when a key is
                        set. Get your key at{' '}
                        <a
                          href="https://real-debrid.com/apitoken"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--bliss-accent)] underline-offset-2 hover:underline"
                        >
                          real-debrid.com/apitoken
                        </a>
                        .
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <div className="text-xs text-foreground/60 mb-2">TMDB API key</div>
                      <input
                        type="text"
                        value={playerSettings.tmdbApiKey}
                        onChange={(e) => updateSettings({ tmdbApiKey: e.target.value.trim() })}
                        placeholder="paste your TMDB v3 API key"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-foreground/40 focus:border-[var(--bliss-accent)] focus:outline-none"
                      />
                      <div className="mt-2 text-xs text-foreground/50">
                        Used as a rating fallback for posters where
                        IMDB doesn't have a rating yet (typically new
                        releases under IMDB's vote threshold). Free
                        key at{' '}
                        <a
                          href="https://www.themoviedb.org/settings/api"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--bliss-accent)] underline-offset-2 hover:underline"
                        >
                          themoviedb.org/settings/api
                        </a>
                        . Leave blank to disable.
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </div>

            {user ? (
              <div>
                <div className="text-lg font-semibold mb-3">Account</div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-semibold mb-3">Profile</div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <div className="text-xs text-foreground/60 mb-2">Username</div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <input
                            type="text"
                            value={usernameDraft}
                            onChange={(e) => {
                              setUsernameDraft(e.target.value.toLowerCase());
                              setUsernameError(null);
                            }}
                            maxLength={50}
                            placeholder="3-50 chars: a-z 0-9 _ -"
                            autoComplete="off"
                            spellCheck={false}
                            className={
                              'min-w-0 flex-1 rounded-xl border bg-white/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-foreground/40 focus:outline-none ' +
                              (usernameError || (usernameDirty && !usernameValid)
                                ? 'border-danger focus:border-danger'
                                : 'border-white/10 focus:border-[var(--bliss-accent)]')
                            }
                          />
                          <button
                            type="button"
                            onClick={() => { void handleSaveUsername(); }}
                            disabled={usernameSaveDisabled}
                            className={
                              'h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition ' +
                              (usernameSaveDisabled
                                ? 'cursor-not-allowed bg-white/10 text-foreground/40'
                                : 'cursor-pointer bg-white text-black hover:bg-white/90')
                            }
                          >
                            {usernameSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                        <div className="mt-2 text-xs text-foreground/50">
                          {usernameError
                            ? <span className="text-danger">{usernameError}</span>
                            : usernameDirty && !usernameValid
                              ? <span className="text-danger">3-50 chars: lowercase a-z, 0-9, _ -</span>
                              : <>
                                  Used to log in to Blissful and as your public handle
                                  (<span className="text-foreground/80">@{currentUsername || 'unset'}</span>)
                                  — friends find you by it. Display name is separate and
                                  can be anything.
                                </>}
                        </div>
                      </div>

                      <div className="md:col-span-2">
                        <div className="text-xs text-foreground/60 mb-2">Display name</div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <input
                            type="text"
                            value={displayNameDraft}
                            onChange={(e) => {
                              setDisplayNameDraft(e.target.value);
                              setDisplayNameError(null);
                            }}
                            maxLength={60}
                            placeholder="how friends see you"
                            autoComplete="off"
                            className={
                              'min-w-0 flex-1 rounded-xl border bg-white/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-foreground/40 focus:outline-none ' +
                              (displayNameError
                                ? 'border-danger focus:border-danger'
                                : 'border-white/10 focus:border-[var(--bliss-accent)]')
                            }
                          />
                          <button
                            type="button"
                            onClick={() => { void handleSaveDisplayName(); }}
                            disabled={displayNameSaveDisabled}
                            className={
                              'h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition ' +
                              (displayNameSaveDisabled
                                ? 'cursor-not-allowed bg-white/10 text-foreground/40'
                                : 'cursor-pointer bg-white text-black hover:bg-white/90')
                            }
                          >
                            {displayNameSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                        <div className="mt-2 text-xs text-foreground/50">
                          {displayNameError
                            ? <span className="text-danger">{displayNameError}</span>
                            : <>
                                Shown in friends, chat, and watch parties. Can be anything
                                — spaces, emoji, capitals all fine. Up to 60 characters.
                              </>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div>
              <div className="text-lg font-semibold mb-3">Linked accounts</div>
              <div className="space-y-6">
                <SettingsStremioPanel />
              </div>
            </div>
          </ScrollShadow>
        </div>
      </div>
      {colorModal && activeColor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="solid-surface w-full max-w-sm rounded-[24px] bg-black/70 p-6 text-center">
            <div className="text-lg font-semibold">Pick color</div>

            <div className="mt-4 flex justify-center">
              <ChromePicker
                color={{
                  ...hexToRgb(activeColor.hex),
                  a: activeColor.alpha,
                }}
              onChange={(color: ColorResult) => updateColor(colorModal, color.hex, color.rgb.a ?? 1)}
                disableAlpha={colorModal === 'accent'}
              />
            </div>
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                className="rounded-full bg-white/10 px-4 py-2 text-sm text-white"
                onClick={() => setColorModal(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
