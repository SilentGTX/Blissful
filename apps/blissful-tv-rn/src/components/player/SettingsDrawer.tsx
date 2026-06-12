// Self-contained Audio | Subtitles settings drawer — a 1:1 port of the old web
// app's NativeMpvPlayer/SettingsPanel.tsx, rebuilt for react-native-tvos.
//
// SLIDES IN FROM THE RIGHT (spring), tabs as a rounded PILL GROUP + a round
// close X, a glass #101116 body. The Subtitles tab is a LANGUAGE list that
// DRILLS IN to per-language variants, with a sticky "Customize Appearance"
// footer that opens a Font Size / Color / Latency / Reset / Save sub-screen.
//
// FOCUS MODEL — NATIVE, not a virtual index. Every control is a real focusable
// Pressable; the Android focus engine handles all geometry (Down=down,
// Right=right) so the 2D Customize grid behaves naturally — this is what fixed
// the old flat-index "Down moves right / X won't close" bugs. The whole panel
// is wrapped in a FocusTrap (TVFocusGuideView, all four directions) so the
// D-pad can never escape to the player behind it. OK fires the focused
// Pressable's onPress natively (so the X closes). LEFT closes the slide-in
// drawer in the vertical list views (matching the old drawer's dismiss
// gesture); in the Customize grid Left is left to the focus engine so it walks
// between swatches/steppers. Back closes via the PlayerScreen BackHandler.
//
// Mounted only while open (PlayerScreen renders it conditionally) so FocusTrap
// reliably claims focus on entry — the StreamPicker overlay pattern.

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from 'react-native';
import { colors, font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { subtitleLangLabel } from '../../lib/subtitles';
import { normColor } from '../../lib/colorUtils';
import { FocusTrap } from '../FocusTrap';

type M = ReturnType<typeof useMetrics>;

// ── Public data shapes ───────────────────────────────────────────────────────
/** One audio track. `id` is whatever the player keys playback on. */
export type DrawerAudioTrack = {
  id: string;
  label: string;
  /** Language code/name for the meta pill (uppercased in the row). */
  lang?: string | null;
  /** Codec for the meta pill (e.g. `eac3`). */
  codec?: string | null;
};

/** One subtitle variant (embedded engine track OR an addon-fetched .srt). */
export type DrawerSubtitleTrack = {
  id: string;
  /** Row label inside a language's variant list (addon name / origin). */
  label: string;
  /** Raw language code as reported (`eng`, `pt-br`, …). */
  lang?: string | null;
  /** True for engine-embedded tracks (shown with a lavender BUILT-IN badge). */
  embedded: boolean;
  /** Where it came from when not embedded (e.g. `OpenSubtitles`). */
  origin?: string | null;
};

// The 12 subtitle text-color swatches — ported verbatim (rgba) from the web
// SettingsPanel's SUBTITLE_COLOR_SWATCHES.
const SUBTITLE_COLOR_SWATCHES = [
  'rgba(255,255,255,1)',
  'rgba(255,84,112,1)',
  'rgba(189,189,189,1)',
  'rgba(200,255,225,1)',
  'rgba(140,40,230,1)',
  'rgba(230,40,40,1)',
  'rgba(40,210,140,1)',
  'rgba(255,180,40,1)',
  'rgba(255,200,210,1)',
  'rgba(80,160,235,1)',
  'rgba(30,60,140,1)',
  'rgba(245,224,170,1)',
];

const SIZE_MIN = 14;
const SIZE_MAX = 56;
const DELAY_MIN = -30;
const DELAY_MAX = 30;

export type SettingsTab = 'releases' | 'audio' | 'subtitles';

/** One switchable release (torrent) shown in the Releases tab. */
export type DrawerRelease = {
  key: string;
  /** Addon/quality left-label (e.g. "Torrentio 4k"). */
  quality: string;
  /** Torrent name. */
  title: string;
  /** "💾 10.69 GB   👤 1540" or null. */
  meta: string | null;
  bucket: '4K' | '1080p' | '720p' | 'SD' | 'Other';
  isRd: boolean;
  /** Playable url, or null (infoHash-only → not selectable). */
  url: string | null;
};

const RELEASE_BUCKET_ORDER: DrawerRelease['bucket'][] = ['4K', '1080p', '720p', 'SD', 'Other'];
// Cap rows per bucket — the drawer ScrollView isn't virtualized, and the user
// picks from the top anyway (best-ranked first).
const RELEASE_BUCKET_CAP = 20;

export type SettingsDrawerProps = {
  /** Which tab to show when the drawer opens. */
  initialTab: SettingsTab;
  onClose: () => void;

  // Releases (switch torrent)
  releases: DrawerRelease[];
  releasesLoading: boolean;
  currentReleaseUrl: string | null;
  onSelectRelease: (url: string) => void;

  // Audio
  audioTracks: DrawerAudioTrack[];
  currentAudioId: string | null;
  /** Apply an audio track (id) — the player switches + closes are up to us. */
  onApplyAudio: (id: string) => void;

  // Subtitles
  subtitleTracks: DrawerSubtitleTrack[];
  /** Currently-applied subtitle track id, or null for Off. */
  currentSubtitleId: string | null;
  /** Apply a subtitle track id, or null to turn subtitles off. */
  onApplySubtitle: (id: string | null) => void;

  // Subtitle appearance (controlled by the parent; the drawer only steps them)
  subtitleSizePx: number;
  onSubtitleSizePxChange: (px: number) => void;
  subtitleColor: string;
  onSubtitleColorChange: (color: string) => void;
  subtitleDelay: number;
  onSubtitleDelayChange: (value: number) => void;
  /** Persist the current appearance to the account/local store, then close. */
  onSaveAppearance: () => void;
  /** Defaults used by the Reset row (size + color; delay always resets to 0). */
  defaultSubtitleSizePx: number;
  defaultSubtitleColor: string;
};

export function SettingsDrawer(props: SettingsDrawerProps) {
  const {
    initialTab,
    onClose,
    releases,
    releasesLoading,
    currentReleaseUrl,
    onSelectRelease,
    audioTracks,
    currentAudioId,
    onApplyAudio,
    subtitleTracks,
    currentSubtitleId,
    onApplySubtitle,
    subtitleSizePx,
    onSubtitleSizePxChange,
    subtitleColor,
    onSubtitleColorChange,
    subtitleDelay,
    onSubtitleDelayChange,
    onSaveAppearance,
    defaultSubtitleSizePx,
    defaultSubtitleColor,
  } = props;

  const m = useMetrics();
  const W = m.s(420);
  const offX = W + m.s(32);
  const tx = useRef(new Animated.Value(offX)).current;
  const dim = useRef(new Animated.Value(0)).current;

  const hasAudio = audioTracks.length > 0;
  const hasReleases = releases.length > 0 || releasesLoading;
  const [tab, setTab] = useState<SettingsTab>(
    initialTab === 'audio' && !hasAudio ? 'subtitles' : initialTab,
  );
  const [view, setView] = useState<'list' | 'appearance'>('list');
  const [drilledLang, setDrilledLang] = useState<string | null>(null);

  // Releases → Top picks (best 4K + best 1080p, pinned) + per-quality accordions
  // (start collapsed), exactly like the Detail-page StreamPicker. Rows arrive
  // ranked best-first; buckets are capped (the ScrollView isn't virtualized).
  const [openBuckets, setOpenBuckets] = useState<Set<DrawerRelease['bucket']>>(new Set());
  const toggleBucket = (b: DrawerRelease['bucket']) =>
    setOpenBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  const { nowPlaying, pinned, releaseBuckets } = useMemo(() => {
    const by: Record<DrawerRelease['bucket'], DrawerRelease[]> = { '4K': [], '1080p': [], '720p': [], SD: [], Other: [] };
    for (const r of releases) if (r.url) by[r.bucket].push(r);
    // The currently-playing release gets its own "Continue watching" section and
    // is pulled out of Top picks + the accordions so it never appears twice.
    const playing = currentReleaseUrl ? releases.find((r) => r.url === currentReleaseUrl) ?? null : null;
    const pinnedRows = ([by['4K'][0], by['1080p'][0]].filter(Boolean) as DrawerRelease[]).filter((r) => r.key !== playing?.key);
    const hide = new Set(pinnedRows.map((p) => p.key));
    if (playing) hide.add(playing.key);
    const buckets = RELEASE_BUCKET_ORDER.map((b) => {
      const rows = by[b].filter((r) => !hide.has(r.key));
      return { bucket: b, rows: rows.slice(0, RELEASE_BUCKET_CAP), total: rows.length };
    }).filter((g) => g.rows.length > 0);
    return { nowPlaying: playing, pinned: pinnedRows, releaseBuckets: buckets };
  }, [releases, currentReleaseUrl]);

  // Slide + fade IN on mount (unmounts on close — no exit animation needed).
  useEffect(() => {
    Animated.spring(tx, { toValue: 0, stiffness: 280, damping: 32, mass: 0.85, useNativeDriver: true }).start();
    Animated.timing(dim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [tx, dim]);

  // LEFT closes the right-anchored drawer in the vertical list views (the old
  // dismiss gesture). In the Customize grid Left walks swatches/steppers, so
  // hand it to the focus engine there. (Refs keep the closure fresh.)
  const viewRef = useRef(view);
  viewRef.current = view;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useTVEventHandler((evt) => {
    const t = evt?.eventType;
    if (t !== 'left' && t !== 'rewind') return;
    if (tabRef.current === 'subtitles' && viewRef.current === 'appearance') return;
    onClose();
  });

  // ── Subtitle language grouping (by canonical label) ────────────────────────
  const { languageRows, variantsByLang } = useMemo(() => {
    const order: string[] = [];
    const byCanon = new Map<
      string,
      { canon: string; rawLang: string; embedded: boolean; count: number }
    >();
    const variants = new Map<string, DrawerSubtitleTrack[]>();
    for (const t of subtitleTracks) {
      const raw = (t.lang ?? 'unknown').toLowerCase();
      const canon = subtitleLangLabel(raw);
      const existing = byCanon.get(canon);
      if (existing) {
        existing.count += 1;
        existing.embedded = existing.embedded || t.embedded;
      } else {
        byCanon.set(canon, { canon, rawLang: raw, embedded: t.embedded, count: 1 });
        order.push(canon);
      }
      const list = variants.get(canon);
      if (list) list.push(t);
      else variants.set(canon, [t]);
    }
    return {
      languageRows: order.map((c) => byCanon.get(c)!),
      variantsByLang: variants,
    };
  }, [subtitleTracks]);

  // Which canonical language is actually playing (drives the lavender highlight).
  const activeCanon = useMemo(() => {
    if (currentSubtitleId == null) return null;
    const t = subtitleTracks.find((x) => x.id === currentSubtitleId);
    if (!t) return null;
    return subtitleLangLabel((t.lang ?? 'unknown').toLowerCase());
  }, [currentSubtitleId, subtitleTracks]);

  const drilledVariants = drilledLang ? variantsByLang.get(drilledLang) ?? [] : [];

  // Re-seed focus to the first content row whenever the visible list changes.
  // FocusTrap's autoFocus pulls the cursor back inside when the focused node
  // unmounts (tab switch / drill in-out / appearance toggle), so we don't track
  // an index — we just give the *first* content row hasTVPreferredFocus per view.
  const showAppearance = tab === 'subtitles' && view === 'appearance';
  const showLangList = tab === 'subtitles' && view === 'list' && drilledLang == null;
  const showVariants = tab === 'subtitles' && view === 'list' && drilledLang != null;

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: dim,
          zIndex: 200,
          backgroundColor: 'rgba(0,0,0,0.3)',
          alignItems: 'flex-end',
          paddingTop: m.s(112),
          paddingBottom: m.s(112),
          paddingHorizontal: m.s(32),
        },
      ]}
    >
      <Animated.View style={{ transform: [{ translateX: tx }], width: W, maxHeight: '100%' }}>
        <FocusTrap style={{ gap: m.s(12) }}>
          {/* Tabs + close row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: m.s(8) }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: m.s(4),
                borderRadius: 999,
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: m.s(4),
              }}
            >
              {hasReleases ? (
                <PillTab m={m} label="Releases" active={tab === 'releases'} onPress={() => setTab('releases')} />
              ) : null}
              {hasAudio ? (
                <PillTab m={m} label="Audio" active={tab === 'audio'} onPress={() => setTab('audio')} />
              ) : null}
              <PillTab m={m} label="Subtitles" active={tab === 'subtitles'} onPress={() => setTab('subtitles')} />
            </View>
            <RoundButton m={m} onPress={onClose}>
              <Ionicons name="close" size={m.s(18)} color="#fff" />
            </RoundButton>
          </View>

          {/* Content panel */}
          <View
            style={{
              flexShrink: 1,
              overflow: 'hidden',
              borderRadius: m.s(24),
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.1)',
              backgroundColor: 'rgba(16,17,22,0.95)',
              shadowColor: '#000',
              shadowOpacity: 0.5,
              shadowRadius: m.s(24),
              shadowOffset: { width: 0, height: m.s(12) },
            }}
          >
            <ScrollView
              contentContainerStyle={{ padding: m.s(12), gap: m.s(4) }}
              showsVerticalScrollIndicator={false}
            >
              {/* RELEASES TAB — Top picks + per-quality accordions (Detail picker). */}
              {tab === 'releases' ? (
                releasesLoading && releases.length === 0 ? (
                  <View style={{ paddingVertical: m.s(40), alignItems: 'center' }}>
                    <ActivityIndicator color={colors.accent} size="large" />
                  </View>
                ) : pinned.length === 0 && releaseBuckets.length === 0 ? (
                  <EmptyRow m={m} text="No other releases" />
                ) : (
                  (() => {
                    let claimed = false;
                    const claimAutoFocus = () => { if (claimed) return false; claimed = true; return true; };
                    return (
                      <>
                        {nowPlaying ? (
                          <>
                            <ReleaseEyebrow m={m} label="Continue watching" accent />
                            <ReleaseRow
                              key={`cw-${nowPlaying.key}`}
                              m={m}
                              release={nowPlaying}
                              active
                              autoFocus={claimAutoFocus()}
                              onPress={() => nowPlaying.url && onSelectRelease(nowPlaying.url)}
                            />
                          </>
                        ) : null}
                        {pinned.length ? (
                          <>
                            <ReleaseEyebrow m={m} label="Top picks" />
                            {pinned.map((r) => (
                              <ReleaseRow
                                key={`pick-${r.key}`}
                                m={m}
                                release={r}
                                active={!!currentReleaseUrl && r.url === currentReleaseUrl}
                                autoFocus={claimAutoFocus()}
                                onPress={() => r.url && onSelectRelease(r.url)}
                              />
                            ))}
                          </>
                        ) : null}
                        {releaseBuckets.map((g) => {
                          const expanded = openBuckets.has(g.bucket);
                          return (
                            <View key={`bk-${g.bucket}`}>
                              <BucketHeader
                                m={m}
                                bucket={g.bucket}
                                count={g.total}
                                expanded={expanded}
                                autoFocus={claimAutoFocus()}
                                onPress={() => toggleBucket(g.bucket)}
                              />
                              {expanded
                                ? g.rows.map((r) => (
                                    <ReleaseRow
                                      key={r.key}
                                      m={m}
                                      release={r}
                                      active={!!currentReleaseUrl && r.url === currentReleaseUrl}
                                      onPress={() => r.url && onSelectRelease(r.url)}
                                    />
                                  ))
                                : null}
                            </View>
                          );
                        })}
                      </>
                    );
                  })()
                )
              ) : null}

              {/* AUDIO TAB */}
              {tab === 'audio' ? (
                audioTracks.length === 0 ? (
                  <EmptyRow m={m} text="No audio tracks" />
                ) : (
                  audioTracks.map((t, i) => {
                    const active = t.id === currentAudioId;
                    const meta = [t.lang, t.codec].filter(Boolean).join(' · ');
                    return (
                      <TrackRow
                        key={`a-${t.id}`}
                        m={m}
                        label={t.label}
                        meta={meta || null}
                        active={active}
                        autoFocus={i === 0}
                        onPress={() => { onApplyAudio(t.id); onClose(); }}
                      />
                    );
                  })
                )
              ) : null}

              {/* SUBTITLES — appearance sub-screen */}
              {showAppearance ? (
                <AppearanceScreen
                  m={m}
                  sizePx={subtitleSizePx}
                  color={subtitleColor}
                  delay={subtitleDelay}
                  onSizeChange={onSubtitleSizePxChange}
                  onColorChange={onSubtitleColorChange}
                  onDelayChange={onSubtitleDelayChange}
                  onBack={() => setView('list')}
                  onReset={() => {
                    onSubtitleSizePxChange(defaultSubtitleSizePx);
                    onSubtitleColorChange(defaultSubtitleColor);
                    onSubtitleDelayChange(0);
                  }}
                  onSave={onSaveAppearance}
                />
              ) : null}

              {/* SUBTITLES — language list */}
              {showLangList ? (
                <>
                  <SubRow
                    m={m}
                    label="Off"
                    rightPill="No Subtitles"
                    active={currentSubtitleId == null}
                    autoFocus
                    onPress={() => { onApplySubtitle(null); onClose(); }}
                  />
                  {languageRows.map((row) => (
                    <LanguageRow
                      key={`lang-${row.canon}`}
                      m={m}
                      canon={row.canon}
                      embedded={row.embedded}
                      variants={row.count}
                      active={activeCanon != null && activeCanon === row.canon}
                      onPress={() => setDrilledLang(row.canon)}
                    />
                  ))}
                  {languageRows.length === 0 ? <EmptyRow m={m} text="No subtitles available" /> : null}
                </>
              ) : null}

              {/* SUBTITLES — variants of the drilled language */}
              {showVariants ? (
                <>
                  <BackRow m={m} label={drilledLang ?? ''} autoFocus onPress={() => setDrilledLang(null)} />
                  {drilledVariants.map((v) => {
                    const active = currentSubtitleId === v.id;
                    const tag = v.embedded ? 'Built-in' : v.origin || 'Subtitle';
                    return (
                      <VariantRow
                        key={`v-${v.id}`}
                        m={m}
                        label={v.embedded ? (drilledLang ?? '') : v.label || v.origin || 'Subtitle'}
                        tag={tag}
                        embedded={v.embedded}
                        active={active}
                        onPress={() => { onApplySubtitle(v.id); onClose(); }}
                      />
                    );
                  })}
                  {drilledVariants.length === 0 ? <EmptyRow m={m} text="No variants found" /> : null}
                </>
              ) : null}
            </ScrollView>

            {/* Sticky footer — Customize Appearance row (subtitles list only) */}
            {showLangList ? (
              <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', backgroundColor: '#101116', padding: m.s(12) }}>
                <CustomizeRow m={m} onPress={() => setView('appearance')} />
              </View>
            ) : null}
          </View>
        </FocusTrap>
      </Animated.View>
    </Animated.View>
  );
}

// ── Focus treatment ──────────────────────────────────────────────────────────
// Lavender ring (borderWidth m.s(2)), a white tint bg, scale 1.06. ALWAYS pass
// transform:[{scale}] — toggling it to undefined crashes the New Arch.
function focusStyle(m: M, focused: boolean) {
  return {
    borderWidth: m.s(2),
    borderColor: focused ? colors.accent : 'transparent',
    transform: [{ scale: focused ? 1.06 : 1 }],
  } as const;
}

// ── Row primitives (each owns its native focus state) ────────────────────────

function PillTab({ m, label, active, onPress }: { m: M; label: string; active: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        borderRadius: 999,
        paddingHorizontal: m.s(16),
        paddingVertical: m.s(6),
        backgroundColor: focused ? 'rgba(255,255,255,0.12)' : active ? 'rgba(255,255,255,0.15)' : 'transparent',
        ...focusStyle(m, focused),
      }}
    >
      <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(12), color: active ? '#fff' : 'rgba(255,255,255,0.6)' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function RoundButton({ m, onPress, children }: { m: M; onPress: () => void; children: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        width: m.s(36),
        height: m.s(36),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.6)',
        ...focusStyle(m, focused),
      }}
    >
      {children}
    </Pressable>
  );
}

function MetaPill({ m, text }: { m: M; text: string }) {
  return (
    <View style={{ borderRadius: m.s(4), backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: m.s(8), paddingVertical: m.s(2) }}>
      <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(10), letterSpacing: m.s(0.5), color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>
        {text}
      </Text>
    </View>
  );
}

function EmptyRow({ m, text }: { m: M; text: string }) {
  return (
    <View style={{ borderRadius: m.s(12), backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: m.s(16), paddingVertical: m.s(12) }}>
      <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: 'rgba(255,255,255,0.6)' }}>{text}</Text>
    </View>
  );
}

function rowBg(active: boolean, focused: boolean): string {
  if (focused) return 'rgba(255,255,255,0.12)';
  if (active) return 'rgba(149,162,255,0.15)';
  return 'rgba(255,255,255,0.04)';
}

// Section eyebrow ("Continue watching" / "Top picks") — non-focusable. The
// accent variant marks the currently-playing section (mirrors the web).
function ReleaseEyebrow({ m, label, accent }: { m: M; label: string; accent?: boolean }) {
  return (
    <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(13), letterSpacing: m.s(1), textTransform: 'uppercase', color: accent ? 'rgba(149,162,255,0.85)' : 'rgba(255,255,255,0.5)', paddingHorizontal: m.s(6), paddingTop: m.s(10), paddingBottom: m.s(2) }}>
      {label}
    </Text>
  );
}

// A collapsible quality-bucket header: name + count + chevron (rotates open).
function BucketHeader({ m, bucket, count, expanded, autoFocus, onPress }: { m: M; bucket: string; count: number; expanded: boolean; autoFocus?: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(8),
        borderRadius: m.s(12),
        paddingHorizontal: m.s(14),
        paddingVertical: m.s(11),
        marginTop: m.s(6),
        backgroundColor: focused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
        ...focusStyle(m, focused),
      }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: 'rgba(255,255,255,0.9)' }}>{bucket}</Text>
      <View style={{ borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: m.s(8), paddingVertical: m.s(1) }}>
        <Text style={{ fontFamily: font.body, fontSize: m.s(12), color: 'rgba(255,255,255,0.6)' }}>{count}</Text>
      </View>
      <View style={{ flex: 1 }} />
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={m.s(18)} color="rgba(255,255,255,0.6)" />
    </Pressable>
  );
}

// One switchable release row: torrent title + RD badge + size/seeders + check.
function ReleaseRow({ m, release, active, autoFocus, onPress }: { m: M; release: DrawerRelease; active: boolean; autoFocus?: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        borderRadius: m.s(12),
        paddingHorizontal: m.s(14),
        paddingVertical: m.s(10),
        marginTop: m.s(4),
        backgroundColor: rowBg(active, focused),
        ...focusStyle(m, focused),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: m.s(8) }}>
        <Text numberOfLines={2} style={{ flex: 1, fontFamily: font.bodyMed, fontSize: m.s(15), lineHeight: m.s(20), color: active ? colors.accent : 'rgba(255,255,255,0.9)' }}>{release.title}</Text>
        {active ? <Ionicons name="checkmark" size={m.s(18)} color={colors.accent} /> : null}
      </View>
      {(release.isRd || release.meta) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8), marginTop: m.s(5) }}>
          {release.isRd ? (
            <View style={{ borderRadius: m.s(4), backgroundColor: 'rgba(149,162,255,0.2)', paddingHorizontal: m.s(6), paddingVertical: m.s(1) }}>
              <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(10), letterSpacing: m.s(0.5), color: colors.accent }}>RD</Text>
            </View>
          ) : null}
          {release.meta ? <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(12), color: 'rgba(255,255,255,0.55)' }}>{release.meta}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// Audio track row: label + meta pill + checkmark.
function TrackRow({ m, label, meta, active, autoFocus, onPress }: { m: M; label: string; meta: string | null; active: boolean; autoFocus?: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: m.s(12),
        borderRadius: m.s(12),
        paddingHorizontal: m.s(16),
        paddingVertical: m.s(12),
        backgroundColor: rowBg(active, focused),
        ...focusStyle(m, focused),
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(16), color: active ? colors.accent : 'rgba(255,255,255,0.9)' }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
        {meta ? <MetaPill m={m} text={meta} /> : null}
        {active ? <Ionicons name="checkmark" size={m.s(20)} color={colors.accent} /> : null}
      </View>
    </Pressable>
  );
}

// Subtitles "Off" row: label + a right meta pill.
function SubRow({ m, label, rightPill, active, autoFocus, onPress }: { m: M; label: string; rightPill: string; active: boolean; autoFocus?: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: m.s(12),
        paddingHorizontal: m.s(16),
        paddingVertical: m.s(12),
        backgroundColor: focused ? 'rgba(255,255,255,0.12)' : active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
        ...focusStyle(m, focused),
      }}
    >
      <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: active ? '#fff' : 'rgba(255,255,255,0.9)' }}>{label}</Text>
      <MetaPill m={m} text={rightPill} />
    </Pressable>
  );
}

// One language row: canonical name + BUILT-IN badge + "N VARIANTS" pill + chevron.
function LanguageRow({ m, canon, embedded, variants, active, onPress }: { m: M; canon: string; embedded: boolean; variants: number; active: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: m.s(8),
        borderRadius: m.s(12),
        paddingHorizontal: m.s(16),
        paddingVertical: m.s(12),
        backgroundColor: rowBg(active, focused),
        ...focusStyle(m, focused),
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(16), color: active ? colors.accent : 'rgba(255,255,255,0.9)' }}>
        {canon}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
        {embedded ? (
          <View style={{ borderRadius: m.s(4), backgroundColor: 'rgba(149,162,255,0.2)', paddingHorizontal: m.s(8), paddingVertical: m.s(2) }}>
            <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(10), letterSpacing: m.s(0.5), color: colors.accent, textTransform: 'uppercase' }}>Built-in</Text>
          </View>
        ) : null}
        {variants > 1 ? <MetaPill m={m} text={`${variants} Variants`} /> : null}
        <Text style={{ fontFamily: font.body, fontSize: m.s(20), color: 'rgba(255,255,255,0.4)' }}>{'›'}</Text>
      </View>
    </Pressable>
  );
}

// One subtitle variant row inside a drilled language.
function VariantRow({ m, label, tag, embedded, active, onPress }: { m: M; label: string; tag: string; embedded: boolean; active: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: m.s(8),
        borderRadius: m.s(12),
        paddingHorizontal: m.s(16),
        paddingVertical: m.s(12),
        backgroundColor: rowBg(active, focused),
        ...focusStyle(m, focused),
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(16), color: active ? colors.accent : 'rgba(255,255,255,0.9)' }}>
        {label}
      </Text>
      <View
        style={{
          borderRadius: m.s(4),
          backgroundColor: embedded ? 'rgba(149,162,255,0.2)' : 'rgba(255,255,255,0.1)',
          paddingHorizontal: m.s(8),
          paddingVertical: m.s(2),
        }}
      >
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(10), letterSpacing: m.s(0.5), color: embedded ? colors.accent : 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>
          {tag}
        </Text>
      </View>
    </Pressable>
  );
}

// A "‹ <Label>" back row (drill-out / appearance-out).
function BackRow({ m, label, autoFocus, onPress }: { m: M; label: string; autoFocus?: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(8),
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: m.s(10),
        paddingVertical: m.s(6),
        backgroundColor: focused ? 'rgba(255,255,255,0.12)' : 'transparent',
        ...focusStyle(m, focused),
      }}
    >
      <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: 'rgba(255,255,255,0.8)' }}>{'‹'}</Text>
      <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: 'rgba(255,255,255,0.8)' }}>{label}</Text>
    </Pressable>
  );
}

// Sticky-footer "Customize Appearance" row: gear + label + chevron.
function CustomizeRow({ m, onPress }: { m: M; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: m.s(12),
        paddingHorizontal: m.s(16),
        paddingVertical: m.s(12),
        backgroundColor: focused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
        ...focusStyle(m, focused),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
        <Ionicons name="settings-outline" size={m.s(16)} color="rgba(255,255,255,0.85)" />
        <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: 'rgba(255,255,255,0.85)' }}>Customize Appearance</Text>
      </View>
      <Text style={{ fontFamily: font.body, fontSize: m.s(20), color: 'rgba(255,255,255,0.4)' }}>{'›'}</Text>
    </Pressable>
  );
}

// ── Appearance sub-screen ────────────────────────────────────────────────────
function AppearanceScreen({
  m,
  sizePx,
  color,
  delay,
  onSizeChange,
  onColorChange,
  onDelayChange,
  onBack,
  onReset,
  onSave,
}: {
  m: M;
  sizePx: number;
  color: string;
  delay: number;
  onSizeChange: (px: number) => void;
  onColorChange: (c: string) => void;
  onDelayChange: (v: number) => void;
  onBack: () => void;
  onReset: () => void;
  onSave: () => void;
}) {
  return (
    <View style={{ gap: m.s(12) }}>
      <BackRow m={m} label="Back to Subtitles" autoFocus onPress={onBack} />

      {/* Font Size */}
      <View style={cardStyle(m)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: m.s(8) }}>
          <Text style={cardTitle(m)}>Font Size</Text>
          <Text style={cardValue(m)}>{sizePx}px</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: m.s(8) }}>
          <Stepper m={m} label="-" onPress={() => onSizeChange(Math.max(SIZE_MIN, sizePx - 1))} />
          <ValueCell m={m} label={`${sizePx}px`} />
          <Stepper m={m} label="+" onPress={() => onSizeChange(Math.min(SIZE_MAX, sizePx + 1))} />
        </View>
      </View>

      {/* Color — the saved account colour is shown selected (white ring + check) */}
      <View style={cardStyle(m)}>
        <Text style={[cardTitle(m), { marginBottom: m.s(12) }]}>Color</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(8) }}>
          {SUBTITLE_COLOR_SWATCHES.map((c) => (
            <Swatch key={c} m={m} color={c} selected={normColor(color) === normColor(c)} onPress={() => onColorChange(c)} />
          ))}
        </View>
      </View>

      {/* Latency */}
      <View style={cardStyle(m)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: m.s(12) }}>
          <Text style={cardTitle(m)}>Latency</Text>
          <Text style={cardValue(m)}>{`${delay >= 0 ? '+' : ''}${delay.toFixed(1)}s`}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: m.s(8) }}>
          <Stepper m={m} label="-0.5s" onPress={() => onDelayChange(Math.max(DELAY_MIN, +(delay - 0.5).toFixed(1)))} />
          <Stepper m={m} label={delay.toFixed(1)} onPress={() => onDelayChange(0)} />
          <Stepper m={m} label="+0.5s" onPress={() => onDelayChange(Math.min(DELAY_MAX, +(delay + 0.5).toFixed(1)))} />
        </View>
      </View>

      <FooterButton m={m} label="Reset" variant="ghost" onPress={onReset} />
      <FooterButton m={m} label="Save to account" variant="accent" onPress={onSave} />
    </View>
  );
}

function cardStyle(m: M) {
  return { borderRadius: m.s(16), backgroundColor: 'rgba(255,255,255,0.04)', padding: m.s(16) } as const;
}
function cardTitle(m: M) {
  return { fontFamily: font.bodyMed, fontSize: m.s(16), color: 'rgba(255,255,255,0.9)' } as const;
}
function cardValue(m: M) {
  return { fontFamily: font.bodySemi, fontSize: m.s(16), color: colors.accent } as const;
}

// Luminance pick so the selected-swatch checkmark stays legible on any colour.
function checkColorFor(rgba: string): string {
  const mm = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!mm) return '#000';
  const lum = 0.299 * Number(mm[1]) + 0.587 * Number(mm[2]) + 0.114 * Number(mm[3]);
  return lum > 140 ? '#000' : '#fff';
}

// A focusable colour swatch. Selected (= the saved account colour) gets a white
// ring + a contrast checkmark; focused gets the lavender ring.
function Swatch({ m, color, selected, onPress }: { m: M; color: string; selected: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexBasis: '15%',
        flexGrow: 1,
        height: m.s(36),
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: m.s(8),
        backgroundColor: color,
        borderWidth: selected || focused ? m.s(2) : 1,
        borderColor: focused ? colors.accent : selected ? '#fff' : 'rgba(255,255,255,0.1)',
        transform: [{ scale: focused ? 1.06 : 1 }],
      }}
    >
      {selected ? <Ionicons name="checkmark" size={m.s(18)} color={checkColorFor(color)} /> : null}
    </Pressable>
  );
}

// A focusable -/+ stepper cell (1/3 width via flex:1).
function Stepper({ m, label, onPress }: { m: M; label: string; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: m.s(12),
        paddingVertical: m.s(12),
        backgroundColor: focused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
        ...focusStyle(m, focused),
      }}
    >
      <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(14), color: '#fff' }}>{label}</Text>
    </Pressable>
  );
}

// Non-focusable centre value display flanked by steppers.
function ValueCell({ m, label }: { m: M; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: m.s(12),
        paddingVertical: m.s(12),
        borderWidth: m.s(2),
        borderColor: 'transparent',
        backgroundColor: 'rgba(255,255,255,0.03)',
      }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), color: colors.accent }}>{label}</Text>
    </View>
  );
}

function FooterButton({ m, label, variant, onPress }: { m: M; label: string; variant: 'ghost' | 'accent'; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const accent = variant === 'accent';
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: m.s(12),
        paddingVertical: m.s(12),
        backgroundColor: accent ? colors.accent : focused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
        opacity: accent && focused ? 0.9 : 1,
        ...focusStyle(m, focused),
      }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), color: accent ? '#000' : 'rgba(255,255,255,0.85)' }}>{label}</Text>
    </Pressable>
  );
}
