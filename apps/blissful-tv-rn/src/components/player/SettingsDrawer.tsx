// Self-contained Audio | Subtitles settings drawer — a 1:1 port of the old web
// app's NativeMpvPlayer/SettingsPanel.tsx, rebuilt for react-native-tvos.
//
// SLIDES IN FROM THE RIGHT (spring), tabs as a rounded PILL GROUP + a round
// close X, a glass #101116 body. The Subtitles tab is a LANGUAGE list that
// DRILLS IN to per-language variants, with a sticky "Customize Appearance"
// footer that opens a Font Size / Color / Latency / Reset / Save sub-screen.
//
// Unlike the previous flat version (which the PlayerScreen drove via `selIdx`),
// this component OWNS its whole D-pad: its own useTVEventHandler maintains a flat
// ordered list of the currently-visible focusables + a focus index. Up/Down walk
// it (clamped, scroll into view), OK activates, LEFT or Back closes (onClose).
// The index re-seeds to the first content row on every view change (tab switch /
// drill in-out / appearance toggle). The PlayerScreen must early-return from its
// OWN useTVEventHandler while `open` so the two handlers never both act.

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from 'react-native';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { subtitleLangLabel } from '../../lib/subtitles';

const ACCENT = '#95a2ff';
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

export type SettingsTab = 'audio' | 'subtitles';

export type SettingsDrawerProps = {
  open: boolean;
  /** Which tab to show when the drawer opens. */
  initialTab: SettingsTab;
  onClose: () => void;

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

// ── Internal flat-focus model ────────────────────────────────────────────────
// Every visible focusable is one entry. `run()` is what OK fires. The header
// tabs + close are always first; then the body rows in render order; then any
// footer. The view signature re-seeds focus to the first BODY row on change.
type FocusItem = {
  key: string;
  /** false for header tabs/close — used to seed focus onto the first body row. */
  body: boolean;
  run: () => void;
};

export function SettingsDrawer(props: SettingsDrawerProps) {
  const {
    open,
    initialTab,
    onClose,
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
  const opacity = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  // ── Internal navigation state ──────────────────────────────────────────────
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [view, setView] = useState<'list' | 'appearance'>('list');
  const [drilledLang, setDrilledLang] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);

  const hasAudio = audioTracks.length > 0;

  // Reset internal navigation each time the drawer is (re)opened.
  useEffect(() => {
    if (!open) return;
    setTab(hasAudio ? initialTab : 'subtitles');
    setView('list');
    setDrilledLang(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Slide + fade. Always mounted; animates off-screen when closed.
  useEffect(() => {
    Animated.spring(tx, {
      toValue: open ? 0 : offX,
      stiffness: 280,
      damping: 32,
      mass: 0.85,
      useNativeDriver: true,
    }).start();
    Animated.timing(opacity, {
      toValue: open ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [open, offX, tx, opacity]);

  // ── Subtitle language grouping (by canonical label) ────────────────────────
  // Embedded + addon tracks both flow through subtitleTracks; group by canonical
  // language so "eng"/"en"/"english" collapse into one row. Order = first
  // appearance. Each group remembers whether it has an embedded variant + count.
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

  // ── Build the flat focusable list for the current view ─────────────────────
  // Header tabs/close first (body:false), then body rows (body:true), then
  // footer. OK on a row calls its run(). Memoised so the handler reads a stable
  // array via a ref.
  const focusItems = useMemo<FocusItem[]>(() => {
    const items: FocusItem[] = [];
    if (hasAudio) items.push({ key: 'tab-audio', body: false, run: () => setTab('audio') });
    items.push({ key: 'tab-subs', body: false, run: () => setTab('subtitles') });
    items.push({ key: 'close', body: false, run: onClose });

    if (tab === 'audio') {
      for (const t of audioTracks) {
        items.push({
          key: `a-${t.id}`,
          body: true,
          run: () => {
            onApplyAudio(t.id);
            onClose();
          },
        });
      }
    } else if (view === 'appearance') {
      // Font size: minus / value (noop) / plus
      items.push({
        key: 'size-minus',
        body: true,
        run: () => onSubtitleSizePxChange(Math.max(SIZE_MIN, subtitleSizePx - 1)),
      });
      items.push({ key: 'size-value', body: true, run: () => {} });
      items.push({
        key: 'size-plus',
        body: true,
        run: () => onSubtitleSizePxChange(Math.min(SIZE_MAX, subtitleSizePx + 1)),
      });
      // Color swatches
      for (const c of SUBTITLE_COLOR_SWATCHES) {
        items.push({ key: `c-${c}`, body: true, run: () => onSubtitleColorChange(c) });
      }
      // Latency: -0.5 / reset-to-0 / +0.5
      items.push({
        key: 'delay-minus',
        body: true,
        run: () => onSubtitleDelayChange(Math.max(DELAY_MIN, +(subtitleDelay - 0.5).toFixed(1))),
      });
      items.push({ key: 'delay-value', body: true, run: () => onSubtitleDelayChange(0) });
      items.push({
        key: 'delay-plus',
        body: true,
        run: () => onSubtitleDelayChange(Math.min(DELAY_MAX, +(subtitleDelay + 0.5).toFixed(1))),
      });
      // Reset / Save / Back
      items.push({
        key: 'reset',
        body: true,
        run: () => {
          onSubtitleSizePxChange(defaultSubtitleSizePx);
          onSubtitleColorChange(defaultSubtitleColor);
          onSubtitleDelayChange(0);
        },
      });
      items.push({ key: 'save', body: true, run: onSaveAppearance });
      items.push({ key: 'appearance-back', body: true, run: () => setView('list') });
    } else if (drilledLang == null) {
      // Subtitle language list
      items.push({ key: 'off', body: true, run: () => { onApplySubtitle(null); onClose(); } });
      for (const row of languageRows) {
        items.push({
          key: `lang-${row.canon}`,
          body: true,
          run: () => setDrilledLang(row.canon),
        });
      }
      // Sticky footer
      items.push({ key: 'customize', body: true, run: () => setView('appearance') });
    } else {
      // Variant list for the drilled language
      items.push({ key: 'drill-back', body: true, run: () => setDrilledLang(null) });
      for (const v of drilledVariants) {
        items.push({
          key: `v-${v.id}`,
          body: true,
          run: () => { onApplySubtitle(v.id); onClose(); },
        });
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasAudio,
    tab,
    view,
    drilledLang,
    audioTracks,
    languageRows,
    drilledVariants,
    subtitleSizePx,
    subtitleColor,
    subtitleDelay,
  ]);

  const focusItemsRef = useRef(focusItems);
  focusItemsRef.current = focusItems;
  const firstBodyIdx = Math.max(0, focusItems.findIndex((it) => it.body));

  // Re-seed focus to the first body row whenever the view changes (tab switch,
  // drill in/out, appearance toggle, fresh open) so the cursor never strands on
  // a node that just unmounted.
  const viewSig = `${tab}|${view}|${drilledLang ?? ''}`;
  useEffect(() => {
    if (!open) return;
    setFocusIdx(firstBodyIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewSig]);

  // Keep the index in range if the list shrinks (e.g. tracks load in).
  useEffect(() => {
    setFocusIdx((i) => Math.min(i, Math.max(0, focusItems.length - 1)));
  }, [focusItems.length]);

  // Tracks arrive async (the player polls every 400ms) — the body is often empty
  // on first open. When the first body row appears, advance the cursor onto it so
  // it never strands on a header tab (old SettingsPanel re-ran focusFirst timers).
  const hasBody = focusItems.some((it) => it.body);
  useEffect(() => {
    if (!open || !hasBody) return;
    setFocusIdx((i) => (i < firstBodyIdx ? firstBodyIdx : i));
  }, [open, hasBody, firstBodyIdx]);

  // ── Self-contained D-pad ───────────────────────────────────────────────────
  // Acts ONLY while open. Up/Down walk (clamped), OK activates, Left/Back close.
  const lastOk = useRef(0);
  useTVEventHandler((evt) => {
    if (!open) return;
    const type = evt?.eventType;
    if (!type) return;
    const list = focusItemsRef.current;
    switch (type) {
      case 'down':
        setFocusIdx((i) => Math.min(list.length - 1, i + 1));
        break;
      case 'up':
        setFocusIdx((i) => Math.max(0, i - 1));
        break;
      case 'left':
      case 'rewind':
        onClose();
        break;
      case 'select': {
        const now = Date.now();
        if (now - lastOk.current < 300) break;
        lastOk.current = now;
        setFocusIdx((i) => {
          list[i]?.run();
          return i;
        });
        break;
      }
      default:
        break;
    }
  });

  // Scroll the focused row into view (rough — header is ~2 rows tall).
  useEffect(() => {
    if (!open) return;
    const rowH = m.s(56);
    const offsetRows = Math.max(0, focusIdx - firstBodyIdx - 1);
    scrollRef.current?.scrollTo({ y: offsetRows * rowH, animated: true });
  }, [focusIdx, firstBodyIdx, open, m]);

  const isFocused = (key: string) => {
    const it = focusItems[focusIdx];
    return it != null && it.key === key;
  };

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity,
          backgroundColor: 'rgba(0,0,0,0.3)',
          alignItems: 'flex-end',
          paddingTop: m.s(112),
          paddingBottom: m.s(112),
          paddingHorizontal: m.s(32),
        },
      ]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      <Animated.View style={{ transform: [{ translateX: tx }], width: W, maxHeight: '100%', gap: m.s(12) }}>
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
            {hasAudio ? (
              <PillTab m={m} label="Audio" active={tab === 'audio'} focused={isFocused('tab-audio')} />
            ) : null}
            <PillTab m={m} label="Subtitles" active={tab === 'subtitles'} focused={isFocused('tab-subs')} />
          </View>
          <RoundButton m={m} focused={isFocused('close')}>
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
            ref={scrollRef}
            contentContainerStyle={{ padding: m.s(12), gap: m.s(4) }}
            showsVerticalScrollIndicator={false}
          >
            {/* AUDIO TAB */}
            {tab === 'audio' ? (
              audioTracks.length === 0 ? (
                <EmptyRow m={m} text="No audio tracks" />
              ) : (
                audioTracks.map((t) => {
                  const active = t.id === currentAudioId;
                  const meta = [t.lang, t.codec].filter(Boolean).join(' · ');
                  return (
                    <TrackRow
                      key={`a-${t.id}`}
                      m={m}
                      label={t.label}
                      meta={meta || null}
                      active={active}
                      focused={isFocused(`a-${t.id}`)}
                    />
                  );
                })
              )
            ) : null}

            {/* SUBTITLES — appearance sub-screen */}
            {tab === 'subtitles' && view === 'appearance' ? (
              <AppearanceScreen
                m={m}
                sizePx={subtitleSizePx}
                color={subtitleColor}
                delay={subtitleDelay}
                isFocused={isFocused}
              />
            ) : null}

            {/* SUBTITLES — language list */}
            {tab === 'subtitles' && view === 'list' && drilledLang == null ? (
              <>
                <SubRow
                  m={m}
                  label="Off"
                  rightPill="No Subtitles"
                  active={currentSubtitleId == null}
                  focused={isFocused('off')}
                />
                {languageRows.map((row) => (
                  <LanguageRow
                    key={`lang-${row.canon}`}
                    m={m}
                    canon={row.canon}
                    embedded={row.embedded}
                    variants={row.count}
                    active={activeCanon != null && activeCanon === row.canon}
                    focused={isFocused(`lang-${row.canon}`)}
                  />
                ))}
                {languageRows.length === 0 ? <EmptyRow m={m} text="No subtitles available" /> : null}
              </>
            ) : null}

            {/* SUBTITLES — variants of the drilled language */}
            {tab === 'subtitles' && view === 'list' && drilledLang != null ? (
              <>
                <BackRow m={m} label={drilledLang} focused={isFocused('drill-back')} />
                {drilledVariants.map((v) => {
                  const active = currentSubtitleId === v.id;
                  const tag = v.embedded ? 'Built-in' : v.origin || 'Subtitle';
                  return (
                    <VariantRow
                      key={`v-${v.id}`}
                      m={m}
                      label={v.embedded ? drilledLang : v.label || v.origin || 'Subtitle'}
                      tag={tag}
                      embedded={v.embedded}
                      active={active}
                      focused={isFocused(`v-${v.id}`)}
                    />
                  );
                })}
                {drilledVariants.length === 0 ? <EmptyRow m={m} text="No variants found" /> : null}
              </>
            ) : null}
          </ScrollView>

          {/* Sticky footer — Customize Appearance row (subtitles list only) */}
          {tab === 'subtitles' && view === 'list' && drilledLang == null ? (
            <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', backgroundColor: '#101116', padding: m.s(12) }}>
              <CustomizeRow m={m} focused={isFocused('customize')} />
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ── Row primitives ───────────────────────────────────────────────────────────
// All use the same focus treatment: lavender ring (borderWidth m.s(2)), a white
// tint bg, and scale 1.06. ALWAYS pass transform:[{scale}] — toggling it to
// undefined crashes the New Arch ("forEach of null").

function focusStyle(m: M, focused: boolean) {
  return {
    borderWidth: m.s(2),
    borderColor: focused ? ACCENT : 'transparent',
    transform: [{ scale: focused ? 1.06 : 1 }],
  } as const;
}

function PillTab({ m, label, active, focused }: { m: M; label: string; active: boolean; focused: boolean }) {
  return (
    <View
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
    </View>
  );
}

function RoundButton({ m, focused, children }: { m: M; focused: boolean; children: React.ReactNode }) {
  return (
    <View
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
    </View>
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
  if (active) return 'rgba(149,162,255,0.15)';
  if (focused) return 'rgba(255,255,255,0.12)';
  return 'rgba(255,255,255,0.04)';
}

// Audio track row: label + meta pill + checkmark.
function TrackRow({ m, label, meta, active, focused }: { m: M; label: string; meta: string | null; active: boolean; focused: boolean }) {
  return (
    <View
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
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(16), color: active ? ACCENT : 'rgba(255,255,255,0.9)' }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
        {meta ? <MetaPill m={m} text={meta} /> : null}
        {active ? <Ionicons name="checkmark" size={m.s(20)} color={ACCENT} /> : null}
      </View>
    </View>
  );
}

// Subtitles "Off" row: label + a right meta pill.
function SubRow({ m, label, rightPill, active, focused }: { m: M; label: string; rightPill: string; active: boolean; focused: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: m.s(12),
        paddingHorizontal: m.s(16),
        paddingVertical: m.s(12),
        backgroundColor: active ? 'rgba(255,255,255,0.1)' : focused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
        ...focusStyle(m, focused),
      }}
    >
      <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: active ? '#fff' : 'rgba(255,255,255,0.9)' }}>{label}</Text>
      <MetaPill m={m} text={rightPill} />
    </View>
  );
}

// One language row: canonical name + BUILT-IN badge + "N VARIANTS" pill + chevron.
function LanguageRow({ m, canon, embedded, variants, active, focused }: { m: M; canon: string; embedded: boolean; variants: number; active: boolean; focused: boolean }) {
  return (
    <View
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
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(16), color: active ? ACCENT : 'rgba(255,255,255,0.9)' }}>
        {canon}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
        {embedded ? (
          <View style={{ borderRadius: m.s(4), backgroundColor: 'rgba(149,162,255,0.2)', paddingHorizontal: m.s(8), paddingVertical: m.s(2) }}>
            <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(10), letterSpacing: m.s(0.5), color: ACCENT, textTransform: 'uppercase' }}>Built-in</Text>
          </View>
        ) : null}
        {variants > 1 ? <MetaPill m={m} text={`${variants} Variants`} /> : null}
        <Text style={{ fontFamily: font.body, fontSize: m.s(20), color: 'rgba(255,255,255,0.4)' }}>{'›'}</Text>
      </View>
    </View>
  );
}

// One subtitle variant row inside a drilled language.
function VariantRow({ m, label, tag, embedded, active, focused }: { m: M; label: string; tag: string; embedded: boolean; active: boolean; focused: boolean }) {
  return (
    <View
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
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(16), color: active ? ACCENT : 'rgba(255,255,255,0.9)' }}>
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
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(10), letterSpacing: m.s(0.5), color: embedded ? ACCENT : 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>
          {tag}
        </Text>
      </View>
    </View>
  );
}

// A "‹ <Label>" back row (drill-out).
function BackRow({ m, label, focused }: { m: M; label: string; focused: boolean }) {
  return (
    <View
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
    </View>
  );
}

// Sticky-footer "Customize Appearance" row: gear + label + chevron.
function CustomizeRow({ m, focused }: { m: M; focused: boolean }) {
  return (
    <View
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
    </View>
  );
}

// ── Appearance sub-screen ────────────────────────────────────────────────────
function AppearanceScreen({
  m,
  sizePx,
  color,
  delay,
  isFocused,
}: {
  m: M;
  sizePx: number;
  color: string;
  delay: number;
  isFocused: (key: string) => boolean;
}) {
  return (
    <View style={{ gap: m.s(12) }}>
      <BackRow m={m} label="Back to Subtitles" focused={isFocused('appearance-back')} />

      {/* Font Size */}
      <View style={cardStyle(m)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: m.s(8) }}>
          <Text style={cardTitle(m)}>Font Size</Text>
          <Text style={cardValue(m)}>{sizePx}px</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: m.s(8) }}>
          <Stepper m={m} label="-" focused={isFocused('size-minus')} />
          <Stepper m={m} label={`${sizePx}px`} focused={isFocused('size-value')} />
          <Stepper m={m} label="+" focused={isFocused('size-plus')} />
        </View>
      </View>

      {/* Color */}
      <View style={cardStyle(m)}>
        <Text style={[cardTitle(m), { marginBottom: m.s(12) }]}>Color</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(8) }}>
          {SUBTITLE_COLOR_SWATCHES.map((c) => {
            const focused = isFocused(`c-${c}`);
            const selected = color === c;
            return (
              <View
                key={c}
                style={{
                  flexBasis: '15%',
                  flexGrow: 1,
                  height: m.s(36),
                  borderRadius: m.s(8),
                  backgroundColor: c,
                  borderWidth: selected || focused ? m.s(2) : 1,
                  borderColor: focused ? ACCENT : selected ? '#fff' : 'rgba(255,255,255,0.1)',
                  transform: [{ scale: focused ? 1.06 : 1 }],
                }}
              />
            );
          })}
        </View>
      </View>

      {/* Latency */}
      <View style={cardStyle(m)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: m.s(12) }}>
          <Text style={cardTitle(m)}>Latency</Text>
          <Text style={cardValue(m)}>{`${delay >= 0 ? '+' : ''}${delay.toFixed(1)}s`}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: m.s(8) }}>
          <Stepper m={m} label="-0.5s" focused={isFocused('delay-minus')} />
          <Stepper m={m} label={delay.toFixed(1)} focused={isFocused('delay-value')} />
          <Stepper m={m} label="+0.5s" focused={isFocused('delay-plus')} />
        </View>
      </View>

      {/* Reset */}
      <FooterButton m={m} label="Reset" focused={isFocused('reset')} variant="ghost" />
      {/* Save */}
      <FooterButton m={m} label="Save to account" focused={isFocused('save')} variant="accent" />
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
  return { fontFamily: font.bodySemi, fontSize: m.s(16), color: ACCENT } as const;
}

// A focusable -/value/+ stepper cell (1/3 width via flex:1).
function Stepper({ m, label, focused }: { m: M; label: string; focused: boolean }) {
  return (
    <View
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
    </View>
  );
}

function FooterButton({ m, label, focused, variant }: { m: M; label: string; focused: boolean; variant: 'ghost' | 'accent' }) {
  const accent = variant === 'accent';
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: m.s(12),
        paddingVertical: m.s(12),
        backgroundColor: accent ? ACCENT : focused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
        ...focusStyle(m, focused),
      }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), color: accent ? '#000' : 'rgba(255,255,255,0.85)' }}>{label}</Text>
    </View>
  );
}
