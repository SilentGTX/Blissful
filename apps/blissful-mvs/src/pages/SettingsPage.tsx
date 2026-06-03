import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollShadow } from '@heroui/react';
import { ChromePicker, type ColorResult } from 'react-color';
import { useAuth } from '../context/AuthProvider';
import { useStorage } from '../context/StorageProvider';
import { useUI } from '../context/UIProvider';
import { parseColor, buildRgba, hexToRgb } from '../lib/colorUtils';
import { SettingsStremioPanel } from '../components/SettingsStremioPanel';
import { SettingsTraktPanel } from '../components/SettingsTraktPanel';
import { notifySuccess } from '../lib/toastQueues';
import { FocusableButton } from '../spatial/FocusableButton';
import { TvSelect } from '../spatial/TvSelect';
import { TvTextInput } from '../spatial/TvTextInput';
import { useTvFocusable } from '../spatial/useTvFocusable';
import { isTvMode } from '../lib/platform';
import { desktop, isNativeShell } from '../lib/desktop';
import {
  SettingsGearIcon,
  AppearanceIcon,
  PlayerIcon,
  PlaybackIcon,
  StreamingIcon,
  AccountIcon,
  LinkedAccountsIcon,
  AdvancedIcon,
  AboutIcon,
} from '../icons/SettingsCategoryIcons';
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

const triggerClassName = 'bg-white/10 border border-white/10 rounded-full';

// Preset accent / subtitle color swatches for the TV remote, which cannot
// drive the react-color ChromePicker. Mirrors the default Blissful accent
// plus a spread of common subtitle colors (white/black/yellow + a few hues).
const TV_COLOR_PRESETS = [
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

// Surface (glass) color presets — DARK, muted tints ONLY. The surface is a
// translucent dark base sitting behind light text, so bright/light colors
// would blind the user and make text unreadable. Every entry here stays dark
// enough that the existing light text remains legible. First entry = default.
const SURFACE_COLOR_PRESETS = [
  '#282f40', // default — cool dark slate (the original glass)
  '#2c2c2c', // neutral charcoal
  '#1b1d29', // midnight blue-black
  '#1f2937', // slate
  '#16302e', // deep teal
  '#2a2140', // deep indigo
  '#1e2a1c', // deep green
  '#321e26', // deep maroon
];

type SettingsCategory =
  | 'appearance'
  | 'player'
  | 'playback'
  | 'streaming'
  | 'account'
  | 'linked'
  | 'advanced'
  | 'about';

// Sidebar nav definition. Order matches the mockup. The icon component takes a
// className so the active accent color cascades through `currentColor`.
const CATEGORIES: {
  key: SettingsCategory;
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
}[] = [
  { key: 'appearance', label: 'Appearance', Icon: AppearanceIcon },
  { key: 'player', label: 'Player', Icon: PlayerIcon },
  { key: 'playback', label: 'Playback', Icon: PlaybackIcon },
  { key: 'streaming', label: 'Streaming', Icon: StreamingIcon },
  { key: 'account', label: 'Account', Icon: AccountIcon },
  { key: 'linked', label: 'Linked Accounts', Icon: LinkedAccountsIcon },
  { key: 'advanced', label: 'Advanced', Icon: AdvancedIcon },
  { key: 'about', label: 'About', Icon: AboutIcon },
];

const CATEGORY_TITLES: Record<SettingsCategory, string> = {
  appearance: 'Appearance',
  player: 'Player',
  playback: 'Playback',
  streaming: 'Streaming',
  account: 'Account',
  linked: 'Linked Accounts',
  advanced: 'Advanced',
  about: 'About',
};

// The role=switch auto-play toggle. Extracted so it can call useTvFocusable
// (hooks can't run inline in JSX/maps). Keeps the original onClick/onKeyDown
// so desktop behaviour is unchanged; on TV the wrapper makes the span a
// D-pad focus stop that fires the same toggle on OK.
function BingeToggle({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void;
}) {
  const { ref } = useTvFocusable({ onPress: onToggle });
  return (
    <span
      ref={ref}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      className={
        'relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition ' +
        (checked ? 'bg-[var(--bliss-accent)]' : 'bg-white/15')
      }
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span
        className={
          'absolute top-0.5 h-5 w-5 rounded-full bg-white transition ' +
          (checked ? 'left-5' : 'left-0.5')
        }
      />
    </span>
  );
}

export default function SettingsPage() {
  const { uiStyle, setUiStyle } = useUI();
  const { playerSettings, savePlayerSettings } = useStorage();
  const { user, updateProfile } = useAuth();
  const [colorModal, setColorModal] = useState<
    'text' | 'bg' | 'outline' | 'accent' | 'surface' | null
  >(null);

  // Which category panel is shown in the right column. Defaults to Appearance
  // (the first nav item, which also claims TV focus on route entry).
  const [category, setCategory] = useState<SettingsCategory>('appearance');

  // App version for the About panel. Only available inside the native shell;
  // mirrors the DesktopNav fetch pattern (cancel-on-unmount guard).
  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => {
    if (!isNativeShell()) return;
    let cancelled = false;
    desktop
      .getAppVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
  // server-side. No uniqueness -- two users can share a display name.
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
  const surfaceColor = parseColor(playerSettings.surfaceColor ?? '#282f40');

  const activeColor = colorModal === 'text'
    ? subtitleTextColor
    : colorModal === 'bg'
      ? subtitleBgColor
      : colorModal === 'outline'
        ? subtitleOutlineColor
        : colorModal === 'accent'
          ? accentColor
          : colorModal === 'surface'
            ? surfaceColor
            : null;

  const updateColor = (
    key: 'text' | 'bg' | 'outline' | 'accent' | 'surface',
    hex: string,
    alpha: number,
  ) => {
    const rgba = buildRgba(hex, alpha);
    if (key === 'text') updateSettings({ subtitlesTextColor: rgba });
    if (key === 'bg') updateSettings({ subtitlesBackgroundColor: rgba });
    if (key === 'outline') updateSettings({ subtitlesOutlineColor: rgba });
    // Accent is intentionally hex-only (no alpha) -- applying a
    // semi-transparent --bliss-accent would dim every chip / focus ring
    // on the site, which isn't what the user wants when they pick a
    // new accent. The picker still shows an alpha slider for parity
    // with the subtitle pickers but we discard it here.
    if (key === 'accent') updateSettings({ accentColor: hex });
    // Surface is likewise hex-only -- the glass recipe bakes its own
    // alphas (0.97 / 0.985), so a translucent surface hex would let page
    // content bleed through every menu/modal. Discard alpha.
    if (key === 'surface') updateSettings({ surfaceColor: hex });
  };

  return (
    <>
      <div className="mt-4">
        <div className="solid-surface flex flex-col rounded-[28px] bg-white/6 lg:flex-row">
          {/* Left category sidebar: header + nav list. */}
          <aside className="shrink-0 border-b border-white/10 p-5 lg:w-[clamp(200px,18vw,260px)] lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]">
                <SettingsGearIcon className="h-5 w-5" />
              </span>
              <div>
                <div className="font-[Instrument_Serif] text-xl font-semibold leading-tight">
                  Settings
                </div>
                <div className="text-xs text-foreground/60">Customize your experience</div>
              </div>
            </div>

            <nav className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {CATEGORIES.map(({ key, label, Icon }, index) => {
                const active = category === key;
                return (
                  <FocusableButton
                    key={key}
                    autoFocusTv={index === 0}
                    onPress={() => setCategory(key)}
                    aria-current={active ? 'page' : undefined}
                    className={
                      'flex shrink-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium transition lg:w-full ' +
                      (active
                        ? 'bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)] shadow-[0_0_0_1px_var(--bliss-accent)] [text-shadow:0_0_12px_var(--bliss-accent)]'
                        : 'text-foreground/70 hover:bg-white/8 hover:text-foreground')
                    }
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="whitespace-nowrap">{label}</span>
                  </FocusableButton>
                );
              })}
            </nav>
          </aside>

          {/* Right content panel: renders only the selected category. */}
          <div className="min-w-0 flex-1 p-6">
            <div className="font-[Instrument_Serif] text-2xl font-semibold">
              {CATEGORY_TITLES[category]}
            </div>

            <ScrollShadow className="mt-5 max-h-[calc(100vh-16rem)] space-y-6 pr-1" hideScrollBar>
              {category === 'appearance' ? (
                <>
                  <div>
                    <h2 className="text-lg font-semibold mb-3">Style</h2>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <FocusableButton
                        className={
                          'rounded-2xl border px-4 py-4 text-left transition ' +
                          (uiStyle === 'classic'
                            ? 'border-white bg-white/15 text-white'
                            : 'border-white/10 bg-white/5 text-foreground/70 hover:bg-white/10')
                        }
                        onPress={() => setUiStyle('classic')}
                      >
                        <div className="text-sm font-semibold">Classic</div>
                        <div className="mt-1 text-xs text-foreground/60">
                          Solid surfaces with simple layout.
                        </div>
                      </FocusableButton>
                      <FocusableButton
                        className={
                          'rounded-2xl border px-4 py-4 text-left transition ' +
                          (uiStyle === 'netflix'
                            ? 'border-white bg-white/15 text-white'
                            : 'border-white/10 bg-white/5 text-foreground/70 hover:bg-white/10')
                        }
                        onPress={() => setUiStyle('netflix')}
                      >
                        <div className="text-sm font-semibold">Kecflix</div>
                        <div className="mt-1 text-xs text-foreground/60">
                          Dark UI with Kecflix-style navigation and rails.
                        </div>
                      </FocusableButton>
                      <FocusableButton
                        className={
                          'rounded-2xl border px-4 py-4 text-left transition ' +
                          (uiStyle === 'modern'
                            ? 'border-white bg-white/15 text-white'
                            : 'border-white/10 bg-white/5 text-foreground/70 hover:bg-white/10')
                        }
                        onPress={() => setUiStyle('modern')}
                      >
                        <div className="text-sm font-semibold">Modern</div>
                        <div className="mt-1 text-xs text-foreground/60">
                          Coverflow carousel with hero detail panel.
                        </div>
                      </FocusableButton>
                    </div>
                  </div>

                  <div className="text-sm text-foreground/60">
                    Solid colors only (background gradients removed).
                  </div>

                  <div>
                    <h2 className="text-lg font-semibold mb-3">Accent color</h2>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold">Site accent</div>
                          <div className="mt-1 text-xs text-foreground/60">
                            Used by progress bars, focus rings, badges, the loading spinner -- anywhere the
                            default teal shows up. Syncs to your account.
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {isTvMode() ? (
                            // The ChromePicker is unusable by remote -- offer a row of
                            // focusable preset swatches instead.
                            <div className="flex flex-wrap items-center gap-2">
                              {TV_COLOR_PRESETS.map((hex) => (
                                <FocusableButton
                                  key={hex}
                                  aria-label={`Set accent ${hex}`}
                                  className={
                                    'h-9 w-9 cursor-pointer rounded-full border shadow-inner ' +
                                    (accentColor.hex.toLowerCase() === hex.toLowerCase()
                                      ? 'border-white'
                                      : 'border-white/20')
                                  }
                                  style={{ background: hex }}
                                  onPress={() => updateSettings({ accentColor: hex })}
                                />
                              ))}
                            </div>
                          ) : (
                            <button
                              type="button"
                              aria-label="Pick accent color"
                              className="h-10 w-10 cursor-pointer rounded-full border border-white/20 shadow-inner"
                              style={{ background: accentColor.hex }}
                              onClick={() => setColorModal('accent')}
                            />
                          )}
                          <FocusableButton
                            className="cursor-pointer rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-foreground/80 hover:bg-white/15"
                            onPress={() => updateSettings({ accentColor: '#95a2ff' })}
                          >
                            Reset
                          </FocusableButton>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h2 className="text-lg font-semibold mb-3">Surface color</h2>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold">Glass surface</div>
                          <div className="mt-1 text-xs text-foreground/60">
                            Tints the glass behind menus, dropdowns, popovers, modals and the
                            nav rail. Leave on the default for the standard dark glass. Syncs
                            to your account.
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {/* Dark, legibility-safe presets only (no free color
                              picker) — a bright/white surface would blind the
                              user and hide the light text. Same on TV + desktop. */}
                          <div className="flex flex-wrap items-center gap-2">
                            {SURFACE_COLOR_PRESETS.map((hex) => (
                              <FocusableButton
                                key={hex}
                                aria-label={`Set surface ${hex}`}
                                className={
                                  'h-9 w-9 cursor-pointer rounded-full border shadow-inner ' +
                                  (surfaceColor.hex.toLowerCase() === hex.toLowerCase()
                                    ? 'border-white'
                                    : 'border-white/20')
                                }
                                style={{ background: hex }}
                                onPress={() => updateSettings({ surfaceColor: hex })}
                              />
                            ))}
                          </div>
                          <FocusableButton
                            className="cursor-pointer rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-foreground/80 hover:bg-white/15"
                            onPress={() => updateSettings({ surfaceColor: '#282f40' })}
                          >
                            Reset
                          </FocusableButton>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {category === 'player' ? (
                <>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <h2 className="text-sm font-semibold mb-3">Subtitles</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="text-xs text-foreground/60 mb-2">Language</div>
                        <TvSelect
                          ariaLabel="Subtitles language"
                          triggerClassName={triggerClassName}
                          value={playerSettings.subtitlesLanguage ?? 'none'}
                          options={languageItems}
                          onChange={(key) => {
                            updateSettings({ subtitlesLanguage: key === 'none' ? null : String(key) });
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-foreground/60 mb-2">Size</div>
                        <TvSelect
                          ariaLabel="Subtitles size"
                          triggerClassName={triggerClassName}
                          value={String(playerSettings.subtitlesSizePx)}
                          options={sizeItems}
                          onChange={(key) => {
                            updateSettings({ subtitlesSizePx: Number.parseInt(String(key), 10) });
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-foreground/60 mb-2">Text color</div>
                        {isTvMode() ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {TV_COLOR_PRESETS.map((hex) => (
                              <FocusableButton
                                key={hex}
                                aria-label={`Set text color ${hex}`}
                                className={
                                  'h-7 w-7 cursor-pointer rounded-full border shadow-inner ' +
                                  (subtitleTextColor.hex.toLowerCase() === hex.toLowerCase()
                                    ? 'border-white'
                                    : 'border-white/20')
                                }
                                style={{ background: hex }}
                                onPress={() => updateColor('text', hex, subtitleTextColor.alpha || 1)}
                              />
                            ))}
                          </div>
                        ) : (
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
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-foreground/60 mb-2">Background color</div>
                        {isTvMode() ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {TV_COLOR_PRESETS.map((hex) => (
                              <FocusableButton
                                key={hex}
                                aria-label={`Set background color ${hex}`}
                                className={
                                  'h-7 w-7 cursor-pointer rounded-full border shadow-inner ' +
                                  (subtitleBgColor.hex.toLowerCase() === hex.toLowerCase()
                                    ? 'border-white'
                                    : 'border-white/20')
                                }
                                style={{ background: hex }}
                                onPress={() => updateColor('bg', hex, subtitleBgColor.alpha || 1)}
                              />
                            ))}
                          </div>
                        ) : (
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
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-foreground/60 mb-2">Outline color</div>
                        {isTvMode() ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {TV_COLOR_PRESETS.map((hex) => (
                              <FocusableButton
                                key={hex}
                                aria-label={`Set outline color ${hex}`}
                                className={
                                  'h-7 w-7 cursor-pointer rounded-full border shadow-inner ' +
                                  (subtitleOutlineColor.hex.toLowerCase() === hex.toLowerCase()
                                    ? 'border-white'
                                    : 'border-white/20')
                                }
                                style={{ background: hex }}
                                onPress={() => updateColor('outline', hex, subtitleOutlineColor.alpha || 1)}
                              />
                            ))}
                          </div>
                        ) : (
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
                        )}
                      </div>

                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <h2 className="text-sm font-semibold mb-3">Audio</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="text-xs text-foreground/60 mb-2">Default audio track</div>
                        <TvSelect
                          ariaLabel="Audio language"
                          triggerClassName={triggerClassName}
                          value={playerSettings.audioLanguage ?? 'none'}
                          options={languageItems}
                          onChange={(key) => {
                            updateSettings({ audioLanguage: key === 'none' ? null : String(key) });
                          }}
                        />
                      </div>

                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <h2 className="text-sm font-semibold mb-3">Controls</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="text-xs text-foreground/60 mb-2">Seek key</div>
                        <TvSelect
                          ariaLabel="Seek key"
                          triggerClassName={triggerClassName}
                          value={String(playerSettings.seekTimeDurationMs)}
                          options={seekItems}
                          onChange={(key) => {
                            updateSettings({ seekTimeDurationMs: Number.parseInt(String(key), 10) });
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-foreground/60 mb-2">Seek key + Shift</div>
                        <TvSelect
                          ariaLabel="Seek key shift"
                          triggerClassName={triggerClassName}
                          value={String(playerSettings.seekShortTimeDurationMs)}
                          options={seekShiftItems}
                          onChange={(key) => {
                            updateSettings({ seekShortTimeDurationMs: Number.parseInt(String(key), 10) });
                          }}
                        />
                      </div>

                    </div>
                  </div>
                </>
              ) : null}

              {category === 'playback' ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h2 className="text-sm font-semibold mb-3">Auto Play</h2>

                  {/* Master enable/disable. Drives the "Auto next" toggle
                      inside the player's episode drawer too -- both
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
                    <BingeToggle
                      checked={playerSettings.bingeWatching}
                      onToggle={() =>
                        updateSettings({ bingeWatching: !playerSettings.bingeWatching })
                      }
                    />
                  </label>

                  <div
                    className={
                      'mt-4 border-t border-white/10 pt-4 transition-opacity ' +
                      (playerSettings.bingeWatching ? '' : 'pointer-events-none opacity-50')
                    }
                  >
                    <div className="text-xs text-foreground/60 mb-2">Next video popup</div>
                    <TvSelect
                      ariaLabel="Next video popup"
                      triggerClassName={triggerClassName}
                      value={String(playerSettings.nextVideoNotificationDurationMs)}
                      options={nextPopupItems}
                      onChange={(key) => {
                        updateSettings({
                          nextVideoNotificationDurationMs: Number.parseInt(String(key), 10),
                        });
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {category === 'streaming' ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h2 className="text-sm font-semibold mb-3">Streaming server</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Cache size</div>
                      <TvSelect
                        ariaLabel="Cache size"
                        triggerClassName={triggerClassName}
                        value={
                          playerSettings.streamingServerCacheSizeBytes === null
                            ? 'unlimited'
                            : String(playerSettings.streamingServerCacheSizeBytes)
                        }
                        options={cacheSizeItems}
                        onChange={(key) => {
                          const next =
                            key === 'unlimited' ? null : Number.parseInt(key, 10);
                          if (key !== 'unlimited' && !Number.isFinite(next)) return;
                          updateSettings({
                            streamingServerCacheSizeBytes:
                              key === 'unlimited' ? null : (next as number),
                          });
                        }}
                      />
                      <div className="mt-2 text-xs text-foreground/50">
                        Maximum disk space the torrent cache may grow to.
                        Only fills as you stream. Larger values reduce
                        cache trims at playback start.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {category === 'account' ? (
                user ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <h2 className="text-sm font-semibold mb-3">Profile</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <div className="text-xs text-foreground/60 mb-2">Username</div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <TvTextInput
                            type="text"
                            value={usernameDraft}
                            onChange={(v) => {
                              setUsernameDraft(v.toLowerCase());
                              setUsernameError(null);
                            }}
                            placeholder="3-50 chars: a-z 0-9 _ -"
                            ariaLabel="Username"
                            onSubmit={() => { void handleSaveUsername(); }}
                            className="min-w-0 flex-1"
                            inputClassName={
                              'min-w-0 w-full rounded-xl border bg-white/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-foreground/40 focus:outline-none ' +
                              (usernameError || (usernameDirty && !usernameValid)
                                ? 'border-danger focus:border-danger'
                                : 'border-white/10 focus:border-[var(--bliss-accent)]')
                            }
                          />
                          <FocusableButton
                            onPress={() => { void handleSaveUsername(); }}
                            disabled={usernameSaveDisabled}
                            focusableTv={!usernameSaveDisabled}
                            className={
                              'h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition ' +
                              (usernameSaveDisabled
                                ? 'cursor-not-allowed bg-white/10 text-foreground/40'
                                : 'cursor-pointer bg-white text-black hover:bg-white/90')
                            }
                          >
                            {usernameSaving ? 'Saving...' : 'Save'}
                          </FocusableButton>
                        </div>
                        <div className="mt-2 text-xs text-foreground/50">
                          {usernameError
                            ? <span className="text-danger">{usernameError}</span>
                            : usernameDirty && !usernameValid
                              ? <span className="text-danger">3-50 chars: lowercase a-z, 0-9, _ -</span>
                              : <>
                                  Used to log in to Blissful and as your public handle
                                  (<span className="text-foreground/80">@{currentUsername || 'unset'}</span>)
                                  -- friends find you by it. Display name is separate and
                                  can be anything.
                                </>}
                        </div>
                      </div>

                      <div className="md:col-span-2">
                        <div className="text-xs text-foreground/60 mb-2">Display name</div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <TvTextInput
                            type="text"
                            value={displayNameDraft}
                            onChange={(v) => {
                              setDisplayNameDraft(v);
                              setDisplayNameError(null);
                            }}
                            placeholder="how friends see you"
                            ariaLabel="Display name"
                            onSubmit={() => { void handleSaveDisplayName(); }}
                            className="min-w-0 flex-1"
                            inputClassName={
                              'min-w-0 w-full rounded-xl border bg-white/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-foreground/40 focus:outline-none ' +
                              (displayNameError
                                ? 'border-danger focus:border-danger'
                                : 'border-white/10 focus:border-[var(--bliss-accent)]')
                            }
                          />
                          <FocusableButton
                            onPress={() => { void handleSaveDisplayName(); }}
                            disabled={displayNameSaveDisabled}
                            focusableTv={!displayNameSaveDisabled}
                            className={
                              'h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition ' +
                              (displayNameSaveDisabled
                                ? 'cursor-not-allowed bg-white/10 text-foreground/40'
                                : 'cursor-pointer bg-white text-black hover:bg-white/90')
                            }
                          >
                            {displayNameSaving ? 'Saving...' : 'Save'}
                          </FocusableButton>
                        </div>
                        <div className="mt-2 text-xs text-foreground/50">
                          {displayNameError
                            ? <span className="text-danger">{displayNameError}</span>
                            : <>
                                Shown in friends, chat, and watch parties. Can be anything
                                -- spaces, emoji, capitals all fine. Up to 60 characters.
                              </>}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-foreground/60">
                    Sign in to manage your account.
                  </div>
                )
              ) : null}

              {category === 'linked' ? (
                <>
                  <SettingsStremioPanel />
                  <SettingsTraktPanel />
                </>
              ) : null}

              {category === 'advanced' ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h2 className="text-sm font-semibold mb-3">Advanced</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Play in external player</div>
                      <TvSelect
                        ariaLabel="External player"
                        triggerClassName={triggerClassName}
                        value={playerSettings.playInExternalPlayer}
                        options={externalPlayerItems}
                        onChange={(key) => {
                          updateSettings({ playInExternalPlayer: key });
                        }}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <div className="text-xs text-foreground/60 mb-2">Real-Debrid API key</div>
                      <TvTextInput
                        type="text"
                        value={playerSettings.realDebridApiKey ?? ''}
                        onChange={(v) => updateSettings({ realDebridApiKey: v.trim() })}
                        placeholder="paste your Real-Debrid API key"
                        ariaLabel="Real-Debrid API key"
                        inputClassName="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-foreground/40 focus:border-[var(--bliss-accent)] focus:outline-none"
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
                      <TvTextInput
                        type="text"
                        value={playerSettings.tmdbApiKey}
                        onChange={(v) => updateSettings({ tmdbApiKey: v.trim() })}
                        placeholder="paste your TMDB v3 API key"
                        ariaLabel="TMDB API key"
                        inputClassName="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-foreground/40 focus:border-[var(--bliss-accent)] focus:outline-none"
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
              ) : null}

              {category === 'about' ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h2 className="text-sm font-semibold mb-3">About</h2>
                  <div className="font-[Instrument_Serif] text-2xl font-semibold">Blissful</div>
                  <div className="mt-1 text-sm text-foreground/60">
                    A native Stremio client for movies and TV.
                  </div>
                  {appVersion ? (
                    <div className="mt-3 text-xs text-foreground/50">v{appVersion}</div>
                  ) : null}
                </div>
              ) : null}
            </ScrollShadow>
          </div>
        </div>
      </div>
      {colorModal && activeColor && !isTvMode() ? (
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
                disableAlpha={colorModal === 'accent' || colorModal === 'surface'}
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
