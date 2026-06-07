import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, type View as RNView } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useRailOpen } from '../lib/railStore';
import { markContentFocus } from '../lib/focusBus';
import { useSelfTag } from '../lib/useSelfTag';
import { useAuth } from '../context/AuthContext';
import { NavRail } from '../components/NavRail';
import { TvSelect, TvSelectOverlay, type DropdownAnchor, type SelectOption } from '../components/TvSelect';
import { TvTextField } from '../components/settings/TvTextField';
import { TvToggle } from '../components/settings/TvToggle';
import { ColorSwatchRow } from '../components/settings/ColorSwatchRow';
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../lib/appInfo';
import {
  DEFAULT_TV_SETTINGS,
  NEXT_VIDEO_POPUP_OPTIONS_MS,
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

type Category = 'advanced' | 'player' | 'playback' | 'appearance' | 'account' | 'about';

const CATEGORIES: { key: Category; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'advanced', label: 'Advanced', icon: 'key-outline' },
  { key: 'player', label: 'Player', icon: 'play-circle-outline' },
  { key: 'playback', label: 'Playback', icon: 'repeat-outline' },
  { key: 'appearance', label: 'Appearance', icon: 'color-palette-outline' },
  { key: 'account', label: 'Account', icon: 'person-circle-outline' },
  { key: 'about', label: 'About', icon: 'information-circle-outline' },
];

const CATEGORY_TITLE: Record<Category, string> = {
  advanced: 'Advanced',
  player: 'Player',
  playback: 'Playback',
  appearance: 'Appearance',
  account: 'Account',
  about: 'About',
};

// A focusable row in the left category list. Active = accent tint + ring baked
// in; focused = lavender ring (mirrors the desktop nav). Each is at the row's
// left edge, so D-pad Left opens the nav rail.
function CategoryItem({
  label,
  icon,
  active,
  autoFocus,
  m,
  onFocusSelect,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  autoFocus: boolean;
  m: M;
  onFocusSelect: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<RNView>(null);
  const selfTag = useSelfTag(ref, true);
  return (
    <Pressable
      ref={ref}
      hasTVPreferredFocus={autoFocus}
      nextFocusLeft={selfTag}
      onFocus={() => {
        setFocused(true);
        markContentFocus(true);
        // Selecting on focus matches the desktop feel: arrowing the list swaps
        // the detail panel immediately (OK is still wired for screen readers).
        onFocusSelect();
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
        style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: active || focused ? colors.accent : colors.textDim }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// A glass card wrapper for a settings group (matches the desktop
// rounded-2xl border-white/10 bg-white/5 panels).
function Card({ title, m, children }: { title?: string; m: M; children: React.ReactNode }) {
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

export function SettingsScreen() {
  const m = useMetrics();
  const railOpen = useRailOpen();
  const { token, user } = useAuth();

  const [category, setCategory] = useState<Category>('advanced');
  const [settings, setSettings] = useState<TvSettings>(() => readTvSettings());
  const [dropdown, setDropdown] = useState<DropdownAnchor | null>(null);

  // Fold whatever the cloud already has (currently the Real-Debrid key) into the
  // local settings on launch / sign-in. The read is best-effort; local stays
  // authoritative for fields the read-only RN storage client doesn't return.
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

  // Single mutate path: update local state + persist to MMKV. See tvSettings.ts
  // for the cloud-save follow-up (no write endpoint in @blissful/core yet).
  const update = (next: Partial<TvSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      writeTvSettings(merged);
      return merged;
    });
  };

  const languageItems = useMemo<SelectOption[]>(
    () => TV_LANGUAGE_OPTIONS.map((o) => ({ key: o.value ?? 'none', label: o.label })),
    [],
  );
  const sizeItems = useMemo<SelectOption[]>(
    () => SUBTITLE_SIZE_OPTIONS_PX.map((px) => ({ key: String(px), label: `${px}px` })),
    [],
  );
  const popupItems = useMemo<SelectOption[]>(
    () =>
      NEXT_VIDEO_POPUP_OPTIONS_MS.map((ms) => ({
        key: String(ms),
        label: ms === 0 ? 'Disabled' : `${Math.round(ms / 1000)} sec`,
      })),
    [],
  );

  // Width of the left category column (echoes the desktop clamp(200,18vw,260)).
  const listW = Math.min(m.s(300), Math.max(m.s(220), m.width * 0.18));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <NavRail active="Settings" />

      {/* One container flips non-focusable while the rail is open, trapping
          focus in the rail (cascades to the category list + detail panel). */}
      <View
        isTVSelectable={!railOpen}
        style={{ position: 'absolute', left: m.contentLeft, top: m.safeY, right: m.safeX, bottom: 0 }}
      >
        <Text style={{ fontFamily: font.serif, fontSize: m.s(40), color: colors.text, marginBottom: m.s(18) }}>
          Settings
        </Text>

        <View style={{ flex: 1, flexDirection: 'row', gap: m.s(24) }}>
          {/* Left: category list (focusable; leftmost edge opens the rail). */}
          <View style={{ width: listW }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: m.s(8), paddingBottom: m.s(40) }}>
              {CATEGORIES.map((c, i) => (
                <CategoryItem
                  key={c.key}
                  label={c.label}
                  icon={c.icon}
                  active={category === c.key}
                  autoFocus={i === 0}
                  m={m}
                  onFocusSelect={() => setCategory(c.key)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Right: detail panel for the active category. */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: font.serif, fontSize: m.s(28), color: colors.text, marginBottom: m.s(16) }}>
              {CATEGORY_TITLE[category]}
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: m.s(18), paddingBottom: m.s(60) }}>
              {category === 'advanced' ? (
                <Card title="API keys" m={m}>
                  <TvTextField
                    label="Real-Debrid API key"
                    hint="All torrent streams resolve through Real-Debrid for instant playback. Get your key at real-debrid.com/apitoken."
                    value={settings.realDebridApiKey}
                    placeholder="paste your Real-Debrid API key"
                    onChange={(v) => update({ realDebridApiKey: v.trim() })}
                    secureMask
                    m={m}
                  />
                  <TvTextField
                    label="TMDB API key"
                    hint="Rating fallback for posters IMDb hasn't rated yet. Free key at themoviedb.org/settings/api. Leave blank to disable."
                    value={settings.tmdbApiKey}
                    placeholder="paste your TMDB v3 API key"
                    onChange={(v) => update({ tmdbApiKey: v.trim() })}
                    secureMask
                    m={m}
                  />
                </Card>
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
                        onOpen={setDropdown}
                      />
                    </View>
                    <View>
                      <FieldLabel label="Text color" m={m} />
                      <ColorSwatchRow
                        presets={TV_COLOR_PRESETS}
                        value={settings.subtitlesTextColor}
                        m={m}
                        onChange={(hex) => update({ subtitlesTextColor: hex })}
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
                        onOpen={setDropdown}
                      />
                    </View>
                  </Card>
                </>
              ) : null}

              {category === 'playback' ? (
                <Card title="Auto play" m={m}>
                  <TvToggle
                    label="Auto play next video"
                    hint="Automatically play the next episode when the current one ends."
                    value={settings.bingeWatching}
                    m={m}
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
                      onOpen={setDropdown}
                    />
                  </View>
                </Card>
              ) : null}

              {category === 'appearance' ? (
                <>
                  <Card title="Accent color" m={m}>
                    <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost, lineHeight: m.s(21) }}>
                      Used by progress bars, focus rings and badges across the app.
                    </Text>
                    <ColorSwatchRow
                      presets={TV_COLOR_PRESETS}
                      value={settings.accentColor}
                      m={m}
                      onChange={(hex) => update({ accentColor: hex })}
                    />
                  </Card>
                  <Card title="Surface color" m={m}>
                    <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost, lineHeight: m.s(21) }}>
                      Tints the glass behind menus, the nav rail and overlays. Dark presets only, so text stays legible.
                    </Text>
                    <ColorSwatchRow
                      presets={SURFACE_COLOR_PRESETS}
                      value={settings.surfaceColor}
                      m={m}
                      onChange={(hex) => update({ surfaceColor: hex })}
                    />
                  </Card>
                </>
              ) : null}

              {category === 'account' ? (
                user ? (
                  <Card title="Profile" m={m}>
                    <View>
                      <FieldLabel label="Username" m={m} />
                      <View
                        style={{
                          minHeight: m.s(52),
                          borderRadius: radius.field,
                          borderWidth: 1,
                          borderColor: colors.hairline,
                          backgroundColor: colors.surface,
                          paddingHorizontal: m.s(16),
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: colors.textDim }}>
                          @{user.username ?? 'unset'}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost, marginTop: m.s(8), lineHeight: m.s(21) }}>
                        Your public handle — friends find you by it. Username changes are managed on the web app.
                      </Text>
                    </View>
                    <View>
                      <FieldLabel label="Display name" m={m} />
                      <View
                        style={{
                          minHeight: m.s(52),
                          borderRadius: radius.field,
                          borderWidth: 1,
                          borderColor: colors.hairline,
                          backgroundColor: colors.surface,
                          paddingHorizontal: m.s(16),
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: colors.text }}>
                          {user.displayName ?? '—'}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost, marginTop: m.s(8), lineHeight: m.s(21) }}>
                        Shown in friends, chat and watch parties.
                      </Text>
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

              {category === 'about' ? (
                <Card m={m}>
                  <Text style={{ fontFamily: font.serif, fontSize: m.s(34), color: colors.text }}>{APP_NAME}</Text>
                  <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: colors.textDim }}>{APP_TAGLINE}</Text>
                  <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: colors.textGhost }}>v{APP_VERSION}</Text>
                </Card>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </View>

      {dropdown ? <TvSelectOverlay anchor={dropdown} onClose={() => setDropdown(null)} m={m} /> : null}
    </View>
  );
}
