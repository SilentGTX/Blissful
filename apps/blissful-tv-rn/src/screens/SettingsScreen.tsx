import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { findNodeHandle, Pressable, ScrollView, Text, TVFocusGuideView, View, type View as RNView } from 'react-native';
import { updateCurrentBlissfulUser } from '@blissful/core';
import { colors, font } from '../theme/colors';
import { useTheme } from '../theme/ThemeProvider';
import { SettingsLeftTargetContext } from '../lib/settingsLeftTarget';
import { useMetrics } from '../theme/metrics';
import { useRailOpen } from '../lib/railStore';
import { markContentFocus } from '../lib/focusBus';
import { useSelfTag } from '../lib/useSelfTag';
import { useAuth } from '../context/AuthContext';
import { NavRail } from '../components/NavRail';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import { TvSelect, TvSelectOverlay, type DropdownAnchor, type SelectOption } from '../components/TvSelect';
import { TvTextField } from '../components/settings/TvTextField';
import { TvToggle } from '../components/settings/TvToggle';
import { ColorSwatchRow } from '../components/settings/ColorSwatchRow';
import { PillButton } from '../components/settings/PillButton';
import { SettingsStremioPanel } from '../components/settings/SettingsStremioPanel';
import { SettingsTraktPanel } from '../components/settings/SettingsTraktPanel';
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../lib/appInfo';
import {
  EXTERNAL_PLAYER_OPTIONS,
  NEXT_VIDEO_POPUP_OPTIONS_MS,
  SEEK_SHORT_TIME_DURATION_OPTIONS_MS,
  SEEK_TIME_DURATION_OPTIONS_MS,
  STREAMING_CACHE_SIZE_OPTIONS,
  SUBTITLE_SIZE_OPTIONS_PX,
  SURFACE_COLOR_PRESETS,
  TV_COLOR_PRESETS,
  TV_LANGUAGE_OPTIONS,
  hydrateTvSettingsFromCloud,
  readTvSettings,
  writeTvSettings,
  type TvSettings,
} from '../lib/tvSettings';

type M = ReturnType<typeof useMetrics>;

// Category order mirrors apps/blissful-mvs/src/pages/SettingsPage.tsx CATEGORIES
// 1:1. The desktop "Style" picker inside Appearance is omitted on TV (the web
// app hides it under isTvMode() — only the Classic layout ships on TV).
type Category =
  | 'appearance'
  | 'player'
  | 'playback'
  | 'streaming'
  | 'account'
  | 'linked'
  | 'advanced'
  | 'about';

const CATEGORIES: { key: Category; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'appearance', label: 'Appearance', icon: 'color-palette-outline' },
  { key: 'player', label: 'Player', icon: 'play-circle-outline' },
  { key: 'playback', label: 'Playback', icon: 'repeat-outline' },
  { key: 'streaming', label: 'Streaming', icon: 'server-outline' },
  { key: 'account', label: 'Account', icon: 'person-circle-outline' },
  { key: 'linked', label: 'Linked Accounts', icon: 'link-outline' },
  { key: 'advanced', label: 'Advanced', icon: 'key-outline' },
  { key: 'about', label: 'About', icon: 'information-circle-outline' },
];

const CATEGORY_TITLE: Record<Category, string> = {
  appearance: 'Appearance',
  player: 'Player',
  playback: 'Playback',
  streaming: 'Streaming',
  account: 'Account',
  linked: 'Linked Accounts',
  advanced: 'Advanced',
  about: 'About',
};

const USERNAME_RE = /^[a-z0-9_-]{3,50}$/;

// A focusable row in the left category list. Active = accent tint + ring;
// focused = lavender ring. Selecting on focus swaps the detail panel (matches
// the desktop feel). Each sits at the row's left edge so D-pad Left opens the
// nav rail.
function CategoryItem({
  label,
  icon,
  active,
  autoFocus,
  nextFocusRight,
  onTag,
  m,
  onFocusSelect,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  autoFocus: boolean;
  nextFocusRight?: number;
  onTag?: (tag?: number) => void;
  m: M;
  onFocusSelect: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<RNView>(null);
  const selfTag = useSelfTag(ref, true);
  // Report this row's node so the panel can route D-pad Left back to the active
  // category (only the active row is handed an onTag).
  useEffect(() => { onTag?.(selfTag); }, [onTag, selfTag]);
  return (
    <Pressable
      ref={ref}
      hasTVPreferredFocus={autoFocus}
      nextFocusLeft={selfTag}
      nextFocusRight={nextFocusRight}
      // Switch the panel on OK/press ONLY — never on focus. Switching on focus
      // while hasTVPreferredFocus follows the category is a feedback loop (focus
      // -> setCategory -> focus re-grab -> ...), which is what froze the nav
      // oscillating between two rows. This mirrors the old app (FocusableButton
      // onPress={() => setCategory(key)}).
      onFocus={() => {
        setFocused(true);
        markContentFocus(true);
      }}
      onBlur={() => setFocused(false)}
      onPress={onFocusSelect}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(14),
        height: m.s(56),
        paddingHorizontal: m.s(16),
        borderRadius: m.s(18),
        borderWidth: 1,
        borderColor: focused ? colors.accent : active ? 'rgba(149,162,255,0.5)' : 'transparent',
        backgroundColor: active || focused ? 'rgba(149,162,255,0.14)' : 'transparent',
      }}
    >
      <Ionicons name={icon} size={m.s(24)} color={active || focused ? colors.accent : colors.textDim} />
      <Text
        numberOfLines={1}
        style={{ fontFamily: font.bodySemi, fontSize: m.s(19), color: active || focused ? colors.accent : colors.textDim }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// Glass card wrapper (rounded-2xl border-white/10 bg-white/5 panel).
function Card({ title, m, children }: { title?: string; m: M; children: ReactNode }) {
  return (
    <View
      style={{
        borderRadius: m.s(20),
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: colors.surface,
        padding: m.s(18),
        gap: m.s(18),
      }}
    >
      {title ? (
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: colors.text }}>{title}</Text>
      ) : null}
      {children}
    </View>
  );
}

function FieldLabel({ label, m }: { label: string; m: M }) {
  return <Text style={{ fontFamily: font.body, fontSize: m.s(17), color: colors.textDim, marginBottom: m.s(8) }}>{label}</Text>;
}

function Hint({ children, m, danger }: { children: ReactNode; m: M; danger?: boolean }) {
  return (
    <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: danger ? colors.danger : colors.textGhost, marginTop: m.s(8), lineHeight: m.s(21) }}>
      {children}
    </Text>
  );
}

export function SettingsScreen() {
  const m = useMetrics();
  const railOpen = useRailOpen();
  const toast = useToast();
  const { setTheme } = useTheme();
  const { token, user, updateProfile } = useAuth();

  const [category, setCategory] = useState<Category>('appearance');
  const [settings, setSettings] = useState<TvSettings>(() => readTvSettings());
  const [dropdown, setDropdown] = useState<DropdownAnchor | null>(null);
  // When a TvSelect overlay closes, the tvos focus engine reclaims focus onto the
  // first category row (Appearance) — which would switch the panel back. Suppress
  // the focus-driven category switch briefly after a close so the panel stays put.
  const dropdownClosedAt = useRef(0);
  const switchCategory = (key: Category) => {
    if (Date.now() - dropdownClosedAt.current > 700) setCategory(key);
  };
  // Route D-pad Right from the category list straight into the detail panel (a
  // focus guide that autoFocuses its first control) — otherwise the engine picks
  // the up-right TopBar search instead of the panel.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const panelRef = useRef<any>(null); // TVFocusGuideView ref (View & FocusGuideMethods)
  const [panelTag, setPanelTag] = useState<number | undefined>(undefined);
  // The active category row's node — panel controls route D-pad Left here (via
  // SettingsLeftTargetContext) instead of opening the global nav rail.
  const [activeCatTag, setActiveCatTag] = useState<number | undefined>(undefined);
  useEffect(() => {
    const id = setTimeout(() => {
      const tag = panelRef.current ? findNodeHandle(panelRef.current) : null;
      if (tag) setPanelTag(tag);
    }, 300);
    return () => clearTimeout(id);
  }, []);

  // Fold whatever the cloud already has (currently the Real-Debrid key) into
  // local settings on launch / sign-in. Local stays authoritative.
  useEffect(() => {
    let cancelled = false;
    hydrateTvSettingsFromCloud(token)
      .then((merged) => {
        if (!cancelled) setSettings(merged);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  const update = (next: Partial<TvSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      writeTvSettings(merged);
      return merged;
    });
    // Apply accent / surface live (retints the whole app + the bg gradient).
    if (next.accentColor !== undefined || next.surfaceColor !== undefined) {
      setTheme({ accent: next.accentColor ?? undefined, surface: next.surfaceColor ?? undefined });
    }
  };

  // --- Account: username edit (mirrors the desktop validation). ----------
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
    if (usernameSaveDisabled || !token) return;
    setUsernameError(null);
    setUsernameSaving(true);
    try {
      // DECISION: AuthContext.updateProfile only accepts displayName/avatar, so
      // call core's updateCurrentBlissfulUser directly for the username (it does
      // accept it). The context user refreshes on the next /auth/me hydration;
      // the draft + toast give immediate feedback. FOLLOW-UP: widen
      // AuthContext.updateProfile to accept `username` so the context updates
      // synchronously (it would also keep the NavRail/profile in sync).
      await updateCurrentBlissfulUser(token, { username: draftLower });
      toast.show(`Username updated — you're now @${draftLower}`);
    } catch (err: unknown) {
      setUsernameError(err instanceof Error ? err.message : 'Failed to update username');
    } finally {
      setUsernameSaving(false);
    }
  };

  // --- Account: display name edit (free-form, <= 60 chars). --------------
  const currentDisplayName = user?.displayName ?? '';
  const [displayNameDraft, setDisplayNameDraft] = useState(currentDisplayName);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  useEffect(() => {
    setDisplayNameDraft(currentDisplayName);
    setDisplayNameError(null);
  }, [currentDisplayName]);

  const displayNameTrimmed = displayNameDraft.trim();
  const displayNameDirty = displayNameTrimmed !== currentDisplayName && displayNameTrimmed.length > 0;
  const displayNameSaveDisabled = !displayNameDirty || displayNameSaving;

  const handleSaveDisplayName = async () => {
    if (displayNameSaveDisabled) return;
    setDisplayNameError(null);
    setDisplayNameSaving(true);
    try {
      await updateProfile({ displayName: displayNameTrimmed });
      toast.show(`Display name updated — you're shown as ${displayNameTrimmed}`);
    } catch (err: unknown) {
      setDisplayNameError(err instanceof Error ? err.message : 'Failed to update display name');
    } finally {
      setDisplayNameSaving(false);
    }
  };

  // --- Select option catalogues. -----------------------------------------
  const seekLabel = (value: number) => `${Math.round(value / 1000)} sec`;

  const languageItems = useMemo<SelectOption[]>(
    () => TV_LANGUAGE_OPTIONS.map((o) => ({ key: o.value ?? 'none', label: o.label })),
    [],
  );
  const sizeItems = useMemo<SelectOption[]>(
    () => SUBTITLE_SIZE_OPTIONS_PX.map((px) => ({ key: String(px), label: `${px}px` })),
    [],
  );
  const seekItems = useMemo<SelectOption[]>(
    () => SEEK_TIME_DURATION_OPTIONS_MS.map((v) => ({ key: String(v), label: seekLabel(v) })),
    [],
  );
  const seekShiftItems = useMemo<SelectOption[]>(
    () => SEEK_SHORT_TIME_DURATION_OPTIONS_MS.map((v) => ({ key: String(v), label: seekLabel(v) })),
    [],
  );
  const popupItems = useMemo<SelectOption[]>(
    () =>
      NEXT_VIDEO_POPUP_OPTIONS_MS.map((ms) => ({
        key: String(ms),
        label: ms === 0 ? 'Disabled' : seekLabel(ms),
      })),
    [],
  );
  const externalPlayerItems = useMemo<SelectOption[]>(
    () => EXTERNAL_PLAYER_OPTIONS.map((o) => ({ key: o.value, label: o.label })),
    [],
  );
  const cacheSizeItems = useMemo<SelectOption[]>(
    () =>
      STREAMING_CACHE_SIZE_OPTIONS.map((o) => ({
        key: o.value === null ? 'unlimited' : String(o.value),
        label: o.label,
      })),
    [],
  );

  // Width of the left category column (echoes the desktop clamp(200,18vw,260)).
  const listW = Math.min(m.s(300), Math.max(m.s(220), m.width * 0.18));

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <NavRail active="Settings" />
      <TopBar />

      <View
        isTVSelectable={!railOpen}
        style={{ position: 'absolute', left: m.contentLeft, top: m.contentTop, right: m.safeX, bottom: 0 }}
      >
        <Text style={{ fontFamily: font.serif, fontSize: m.s(40), color: colors.text, marginBottom: m.s(18) }}>
          Settings
        </Text>

        <View style={{ flex: 1, flexDirection: 'row', gap: m.s(24) }}>
          {/* Left: category list. */}
          <View style={{ width: listW }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: m.s(8), paddingBottom: m.s(40) }}>
              {CATEGORIES.map((c, index) => (
                <CategoryItem
                  key={c.key}
                  label={c.label}
                  icon={c.icon}
                  active={category === c.key}
                  // STABLE mount-only focus on the first row. Must NOT follow the
                  // live category — hasTVPreferredFocus that tracks focus-updated
                  // state re-grabs focus every switch and loops (the crash).
                  autoFocus={index === 0}
                  nextFocusRight={panelTag}
                  onTag={category === c.key ? setActiveCatTag : undefined}
                  m={m}
                  onFocusSelect={() => switchCategory(c.key)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Right: detail panel for the active category. A focus guide so D-pad
              Right from the category list lands on the panel's first control; the
              provider routes the controls' D-pad Left back to the active category. */}
          <SettingsLeftTargetContext.Provider value={activeCatTag}>
          <TVFocusGuideView ref={panelRef} autoFocus style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: font.serif, fontSize: m.s(28), color: colors.text, marginBottom: m.s(16) }}>
              {CATEGORY_TITLE[category]}
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: m.s(18), paddingBottom: m.s(80) }}>
              {category === 'appearance' ? (
                <>
                  <Card title="Accent color" m={m}>
                    {/* DECISION: keep the exact desktop sub-label + copy ("Syncs to your
                        account.") for 1:1 parity; tvSettings is local-only today (noted). */}
                    <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(17), color: colors.text }}>Site accent</Text>
                    <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost, lineHeight: m.s(21) }}>
                      Used by progress bars, focus rings, badges, the loading spinner — anywhere the default teal shows up. Syncs to your account.
                    </Text>
                    <ColorSwatchRow
                      presets={TV_COLOR_PRESETS}
                      value={settings.accentColor}
                      m={m}
                      atRowStart
                      onChange={(hex) => update({ accentColor: hex })}
                    />
                    <PillButton label="Reset" m={m} onPress={() => update({ accentColor: '#95a2ff' })} />
                  </Card>
                  <Card title="Surface color" m={m}>
                    <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(17), color: colors.text }}>Glass surface</Text>
                    <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost, lineHeight: m.s(21) }}>
                      Tints the glass behind menus, dropdowns, popovers and the nav rail. Dark presets only, so text stays legible. Syncs to your account.
                    </Text>
                    <ColorSwatchRow
                      presets={SURFACE_COLOR_PRESETS}
                      value={settings.surfaceColor}
                      m={m}
                      atRowStart
                      onChange={(hex) => update({ surfaceColor: hex })}
                    />
                    <PillButton label="Reset" m={m} onPress={() => update({ surfaceColor: '#282f40' })} />
                  </Card>
                </>
              ) : null}

              {category === 'player' ? (
                <>
                  <Card title="Subtitles" m={m}>
                    <View>
                      <FieldLabel label="Language" m={m} />
                      <TvSelect
                        iconName="language-outline"
                        options={languageItems}
                        value={settings.subtitlesLanguage ?? 'none'}
                        onChange={(k) => update({ subtitlesLanguage: k === 'none' ? null : k })}
                        m={m}
                        minWidth={m.s(260)}
                        atRowStart
                        onOpen={setDropdown}
                      />
                    </View>
                    <View>
                      <FieldLabel label="Size" m={m} />
                      <TvSelect
                        iconName="text-outline"
                        options={sizeItems}
                        value={String(settings.subtitlesSizePx)}
                        onChange={(k) => update({ subtitlesSizePx: Number.parseInt(k, 10) })}
                        m={m}
                        minWidth={m.s(200)}
                        atRowStart
                        onOpen={setDropdown}
                      />
                    </View>
                    <View>
                      <FieldLabel label="Text color" m={m} />
                      <ColorSwatchRow
                        presets={TV_COLOR_PRESETS}
                        value={settings.subtitlesTextColor}
                        m={m}
                        size={m.s(34)}
                        atRowStart
                        onChange={(hex) => update({ subtitlesTextColor: hex })}
                      />
                    </View>
                    <View>
                      <FieldLabel label="Background color" m={m} />
                      <ColorSwatchRow
                        presets={TV_COLOR_PRESETS}
                        value={settings.subtitlesBackgroundColor}
                        m={m}
                        size={m.s(34)}
                        atRowStart
                        onChange={(hex) => update({ subtitlesBackgroundColor: hex })}
                      />
                    </View>
                    <View>
                      <FieldLabel label="Outline color" m={m} />
                      <ColorSwatchRow
                        presets={TV_COLOR_PRESETS}
                        value={settings.subtitlesOutlineColor}
                        m={m}
                        size={m.s(34)}
                        atRowStart
                        onChange={(hex) => update({ subtitlesOutlineColor: hex })}
                      />
                    </View>
                  </Card>

                  <Card title="Audio" m={m}>
                    <View>
                      <FieldLabel label="Default audio track" m={m} />
                      <TvSelect
                        iconName="volume-high-outline"
                        options={languageItems}
                        value={settings.audioLanguage ?? 'none'}
                        onChange={(k) => update({ audioLanguage: k === 'none' ? null : k })}
                        m={m}
                        minWidth={m.s(260)}
                        atRowStart
                        onOpen={setDropdown}
                      />
                    </View>
                  </Card>

                  <Card title="Controls" m={m}>
                    <View>
                      <FieldLabel label="Seek key" m={m} />
                      <TvSelect
                        iconName="play-forward-outline"
                        options={seekItems}
                        value={String(settings.seekTimeDurationMs)}
                        onChange={(k) => update({ seekTimeDurationMs: Number.parseInt(k, 10) })}
                        m={m}
                        minWidth={m.s(200)}
                        atRowStart
                        onOpen={setDropdown}
                      />
                    </View>
                    <View>
                      <FieldLabel label="Seek key + Shift" m={m} />
                      <TvSelect
                        iconName="play-forward-outline"
                        options={seekShiftItems}
                        value={String(settings.seekShortTimeDurationMs)}
                        onChange={(k) => update({ seekShortTimeDurationMs: Number.parseInt(k, 10) })}
                        m={m}
                        minWidth={m.s(200)}
                        atRowStart
                        onOpen={setDropdown}
                      />
                    </View>
                  </Card>
                </>
              ) : null}

              {category === 'playback' ? (
                <Card title="Auto Play" m={m}>
                  <TvToggle
                    label="Auto play next video"
                    hint="Automatically play the next episode when the current one ends."
                    value={settings.bingeWatching}
                    m={m}
                    atRowStart
                    onToggle={() => update({ bingeWatching: !settings.bingeWatching })}
                  />
                  <View style={{ opacity: settings.bingeWatching ? 1 : 0.5 }}>
                    <FieldLabel label="Next video popup" m={m} />
                    <TvSelect
                      iconName="timer-outline"
                      options={popupItems}
                      value={String(settings.nextVideoNotificationDurationMs)}
                      onChange={(k) => update({ nextVideoNotificationDurationMs: Number.parseInt(k, 10) })}
                      m={m}
                      minWidth={m.s(220)}
                      atRowStart
                      onOpen={setDropdown}
                    />
                  </View>
                </Card>
              ) : null}

              {category === 'streaming' ? (
                <Card title="Streaming server" m={m}>
                  <View>
                    <FieldLabel label="Cache size" m={m} />
                    <TvSelect
                      iconName="save-outline"
                      options={cacheSizeItems}
                      value={settings.streamingServerCacheSizeBytes === null ? 'unlimited' : String(settings.streamingServerCacheSizeBytes)}
                      onChange={(k) => update({ streamingServerCacheSizeBytes: k === 'unlimited' ? null : Number.parseInt(k, 10) })}
                      m={m}
                      minWidth={m.s(220)}
                      atRowStart
                      onOpen={setDropdown}
                    />
                    <Hint m={m}>
                      Maximum disk space the torrent cache may grow to. Only fills as you stream. Larger values reduce cache trims at playback start.
                    </Hint>
                  </View>
                </Card>
              ) : null}

              {category === 'account' ? (
                user ? (
                  <Card title="Profile" m={m}>
                    <View>
                      <TvTextField
                        label="Username"
                        value={usernameDraft}
                        placeholder="3-50 chars: a-z 0-9 _ -"
                        onChange={(v) => {
                          setUsernameDraft(v.toLowerCase());
                          setUsernameError(null);
                        }}
                        onSubmit={() => void handleSaveUsername()}
                        invalid={Boolean(usernameError) || (usernameDirty && !usernameValid)}
                        m={m}
                        atRowStart
                      />
                      <View style={{ flexDirection: 'row', marginTop: m.s(10) }}>
                        <PillButton
                          label={usernameSaving ? 'Saving...' : 'Save'}
                          m={m}
                          primary
                          disabled={usernameSaveDisabled}
                          busy={usernameSaving}
                          onPress={() => void handleSaveUsername()}
                        />
                      </View>
                      {usernameError ? (
                        <Hint m={m} danger>{usernameError}</Hint>
                      ) : usernameDirty && !usernameValid ? (
                        <Hint m={m} danger>3-50 chars: lowercase a-z, 0-9, _ -</Hint>
                      ) : (
                        <Hint m={m}>
                          Used to log in to Blissful and as your public handle (@{currentUsername || 'unset'}) — friends find you by it. Display name is separate and can be anything.
                        </Hint>
                      )}
                    </View>

                    <View>
                      <TvTextField
                        label="Display name"
                        value={displayNameDraft}
                        placeholder="how friends see you"
                        onChange={(v) => {
                          setDisplayNameDraft(v);
                          setDisplayNameError(null);
                        }}
                        onSubmit={() => void handleSaveDisplayName()}
                        invalid={Boolean(displayNameError)}
                        m={m}
                        atRowStart
                      />
                      <View style={{ flexDirection: 'row', marginTop: m.s(10) }}>
                        <PillButton
                          label={displayNameSaving ? 'Saving...' : 'Save'}
                          m={m}
                          primary
                          disabled={displayNameSaveDisabled}
                          busy={displayNameSaving}
                          onPress={() => void handleSaveDisplayName()}
                        />
                      </View>
                      {displayNameError ? (
                        <Hint m={m} danger>{displayNameError}</Hint>
                      ) : (
                        <Hint m={m}>
                          Shown in friends, chat, and watch parties. Can be anything — spaces, emoji, capitals all fine. Up to 60 characters.
                        </Hint>
                      )}
                    </View>
                  </Card>
                ) : (
                  <Card m={m}>
                    <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: colors.textDim }}>
                      Sign in to manage your account.
                    </Text>
                  </Card>
                )
              ) : null}

              {category === 'linked' ? (
                <>
                  <SettingsStremioPanel m={m} />
                  <SettingsTraktPanel m={m} />
                </>
              ) : null}

              {category === 'advanced' ? (
                <Card title="Advanced" m={m}>
                  <View>
                    <FieldLabel label="Play in external player" m={m} />
                    <TvSelect
                      iconName="open-outline"
                      options={externalPlayerItems}
                      value={settings.playInExternalPlayer}
                      onChange={(k) => update({ playInExternalPlayer: k })}
                      m={m}
                      minWidth={m.s(260)}
                      atRowStart
                      onOpen={setDropdown}
                    />
                  </View>
                  <TvTextField
                    label="Real-Debrid API key"
                    hint="All torrent streams resolve through Real-Debrid for instant playback. Non-RD Torrentio results are hidden when a key is set. Get your key at real-debrid.com/apitoken."
                    value={settings.realDebridApiKey}
                    placeholder="paste your Real-Debrid API key"
                    onChange={(v) => update({ realDebridApiKey: v.trim() })}
                    secureMask
                    m={m}
                    atRowStart
                  />
                  <TvTextField
                    label="TMDB API key"
                    hint="Rating fallback for posters where IMDb doesn't have a rating yet (typically new releases). Free key at themoviedb.org/settings/api. Leave blank to disable."
                    value={settings.tmdbApiKey}
                    placeholder="paste your TMDB v3 API key"
                    onChange={(v) => update({ tmdbApiKey: v.trim() })}
                    secureMask
                    m={m}
                    atRowStart
                  />
                </Card>
              ) : null}

              {category === 'about' ? (
                <Card title="About" m={m}>
                  <Text style={{ fontFamily: font.serif, fontSize: m.s(34), color: colors.text }}>{APP_NAME}</Text>
                  <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: colors.textDim }}>{APP_TAGLINE}</Text>
                  <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: colors.textGhost }}>v{APP_VERSION}</Text>
                </Card>
              ) : null}
            </ScrollView>
          </TVFocusGuideView>
          </SettingsLeftTargetContext.Provider>
        </View>
      </View>

      {dropdown ? (
        <TvSelectOverlay
          anchor={dropdown}
          onClose={() => {
            const refocus = dropdown.requestFocus;
            dropdownClosedAt.current = Date.now();
            setDropdown(null);
            // Return focus to the trigger AFTER the overlay unmounts + the engine's
            // reclaim, so it lands on the cache select, not the first category.
            setTimeout(() => refocus(), 50);
          }}
          m={m}
        />
      ) : null}
    </View>
  );
}
