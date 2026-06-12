/**
 * AppearanceSettings (React Native)
 * ---------------------------------
 * Appearance settings screen for blissful-tv-rn:
 *   • Accent color picker  — live preview (spinner, progress, badge, focus ring)
 *   • Glass surface picker — live preview (frosted menu over content)
 * Refined swatches with clear selection (ring + contrast-aware check).
 *
 * Dependencies:
 *   react-native-svg          (required — icons + checkmark)
 *   expo-blur OR @react-native-community/blur   (optional — real glass blur;
 *                                                see GlassPreview note below)
 *
 * Usage (controlled — wire to your theme store):
 *   <AppearanceSettings
 *     accent={theme.accent}      onAccentChange={setAccent}
 *     surface={theme.surface}    onSurfaceChange={setSurface}
 *   />
 *
 * Usage (uncontrolled): <AppearanceSettings /> manages its own state.
 */

import React, { useRef, useEffect, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, Easing, ScrollView,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

/* ----------------------------- tokens ----------------------------- */
export const ACCENTS = [
  { name: 'Periwinkle', hex: '#8aa0ff' },
  { name: 'Teal',       hex: '#1ad1b0' },
  { name: 'White',      hex: '#ffffff' },
  { name: 'Black',      hex: '#0b0b0d' },
  { name: 'Yellow',     hex: '#f5c518' },
  { name: 'Red',        hex: '#f5402c' },
  { name: 'Green',      hex: '#22b14c' },
  { name: 'Blue',       hex: '#1577f2' },
  { name: 'Violet',     hex: '#c061f0' },
  { name: 'Orange',     hex: '#f59e0b' },
];
export const ACCENT_DEFAULT = '#1ad1b0';

export const SURFACES = [
  { name: 'Default', hex: '#0e1320' },
  { name: 'Taupe',   hex: '#33302a' },
  { name: 'Indigo',  hex: '#1b2138' },
  { name: 'Steel',   hex: '#1d2f44' },
  { name: 'Pine',    hex: '#16312c' },
  { name: 'Plum',    hex: '#2b2545' },
  { name: 'Moss',    hex: '#1e3020' },
  { name: 'Maroon',  hex: '#371f24' },
];
export const SURFACE_DEFAULT = '#0e1320';
const PAGE_BG = '#0a0e16';

/* ----------------------------- utils ----------------------------- */
function isLight(hex) {
  const h = hex.replace('#', '');
  const f = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(2)) + 0.0722 * lin(f(4)) > 0.5;
}
function rgba(hex, a) {
  const h = hex.replace('#', '');
  const f = (i) => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${f(0)},${f(2)},${f(4)},${a})`;
}

/* ----------------------------- icons ----------------------------- */
const CheckIcon = ({ color }) => (
  <Svg width={15} height={15} viewBox="0 0 24 24">
    <Path d="M5 13l4 4L19 7" fill="none" stroke={color} strokeWidth={3.5}
          strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const ResetIcon = ({ color }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24">
    <Path d="M3 12a9 9 0 1 0 3-6.7L3 8" fill="none" stroke={color} strokeWidth={2.2}
          strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M3 4v4h4" fill="none" stroke={color} strokeWidth={2.2}
          strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/* ----------------------------- swatch ----------------------------- */
function Swatch({ hex, name, selected, onPress }) {
  const light = isLight(hex);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      style={[st.ring, selected && st.ringActive]}
    >
      <View style={[st.dot, { backgroundColor: hex }]}>
        {selected && <CheckIcon color={light ? '#0b0b0d' : '#ffffff'} />}
      </View>
    </Pressable>
  );
}

function Palette({ value, onChange, items }) {
  return (
    <View style={st.palette}>
      {items.map((c) => (
        <Swatch key={c.hex} hex={c.hex} name={c.name}
                selected={value === c.hex} onPress={() => onChange(c.hex)} />
      ))}
    </View>
  );
}

/* --------------------------- accent preview --------------------------- */
function Spinner({ accent }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 850, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{
      width: 26, height: 26, borderRadius: 13, borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.12)', borderTopColor: accent, borderRightColor: accent,
      transform: [{ rotate }],
    }} />
  );
}

function AccentPreview({ accent }) {
  return (
    <View style={st.previewRow}>
      <Spinner accent={accent} />
      <View style={{ flex: 1, minWidth: 120 }}>
        <View style={st.progressTrack}>
          <View style={[st.progressFill, { backgroundColor: accent }]} />
        </View>
      </View>
      <View style={[st.badge, { backgroundColor: accent }]}>
        <Text style={[st.badgeTxt, { color: isLight(accent) ? '#0b0b0d' : '#fff' }]}>NEW</Text>
      </View>
      <View style={[st.focusBtn, { borderColor: accent, shadowColor: accent }]}>
        <Text style={st.focusTxt}>Focused</Text>
      </View>
    </View>
  );
}

/* --------------------------- glass preview --------------------------- */
function GlassPreview({ surface, accent }) {
  // NOTE: for a true frosted blur, replace the tinted <View> below with
  // <BlurView tint="dark" intensity={40} style={...}/> (expo-blur) and overlay
  // the rgba(surface) tint on top. The translucent View approximates it without a dep.
  const items = ['Play next', 'Add to queue', 'Share'];
  return (
    <View style={st.glassWrap}>
      <View style={st.glassBg} />
      <View style={[st.glassMenu, { backgroundColor: rgba(surface, 0.78) }]}>
        {items.map((m, i) => (
          <View key={m} style={[st.glassItem, i === 0 && st.glassItemActive]}>
            <View style={[st.glassDot, { backgroundColor: i === 0 ? accent : 'rgba(255,255,255,0.3)' }]} />
            <Text style={[st.glassTxt, { color: i === 0 ? '#fff' : 'rgba(255,255,255,0.74)',
              fontWeight: i === 0 ? '600' : '500' }]}>{m}</Text>
          </View>
        ))}
      </View>
      <Text style={st.previewTag}>PREVIEW</Text>
    </View>
  );
}

/* ----------------------------- pieces ----------------------------- */
function SectionHead({ kicker, title, desc }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={st.kicker}>{kicker}</Text>
      <Text style={st.cardTitle}>{title}</Text>
      <Text style={st.cardDesc}>{desc}</Text>
    </View>
  );
}

function ResetButton({ onPress }) {
  return (
    <Pressable onPress={onPress} style={st.reset}>
      <ResetIcon color="rgba(255,255,255,0.72)" />
      <Text style={st.resetTxt}>Reset</Text>
    </Pressable>
  );
}

function Card({ surface, children }) {
  return <View style={[st.card, { backgroundColor: rgba(surface, 0.6) }]}>{children}</View>;
}

/* ----------------------------- main ----------------------------- */
export default function AppearanceSettings({
  accent: accentProp, onAccentChange,
  surface: surfaceProp, onSurfaceChange,
}) {
  const [accentS, setAccentS] = useState('#8aa0ff');
  const [surfaceS, setSurfaceS] = useState(SURFACE_DEFAULT);
  const accent = accentProp ?? accentS;
  const surface = surfaceProp ?? surfaceS;
  const setAccent = (v) => { onAccentChange ? onAccentChange(v) : setAccentS(v); };
  const setSurface = (v) => { onSurfaceChange ? onSurfaceChange(v) : setSurfaceS(v); };

  return (
    <ScrollView style={st.page} contentContainerStyle={st.pageContent}>
      <Text style={st.h1}>Appearance</Text>

      <Card surface={surface}>
        <SectionHead kicker="ACCENT COLOR" title="Site accent"
          desc="Used by progress bars, focus rings, badges and the loading spinner — anywhere the default teal shows up. Syncs to your account." />
        <AccentPreview accent={accent} />
        <Palette items={ACCENTS} value={accent} onChange={setAccent} />
        <ResetButton onPress={() => setAccent(ACCENT_DEFAULT)} />
      </Card>

      <Card surface={surface}>
        <SectionHead kicker="SURFACE COLOR" title="Glass surface"
          desc="Tints the glass behind menus, dropdowns, popovers and the nav rail. Dark presets only, so text stays legible. Syncs to your account." />
        <GlassPreview surface={surface} accent={accent} />
        <Palette items={SURFACES} value={surface} onChange={setSurface} />
        <ResetButton onPress={() => setSurface(SURFACE_DEFAULT)} />
      </Card>
    </ScrollView>
  );
}

/* ----------------------------- styles ----------------------------- */
const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAGE_BG },
  pageContent: { padding: 24, paddingBottom: 48 },
  h1: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 22, letterSpacing: -0.3 },

  card: { borderRadius: 20, padding: 22, marginBottom: 22,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  kicker: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700',
    letterSpacing: 0.7, marginBottom: 12 },
  cardTitle: { color: '#fff', fontSize: 15.5, fontWeight: '700', marginBottom: 7 },
  cardDesc: { color: 'rgba(255,255,255,0.5)', fontSize: 13.5, lineHeight: 20 },

  /* accent preview */
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20,
    padding: 16, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', flexWrap: 'wrap' },
  progressTrack: { height: 6, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  progressFill: { width: '62%', height: '100%', borderRadius: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  focusBtn: { height: 34, paddingHorizontal: 16, borderRadius: 10, justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 2,
    shadowOpacity: 0.5, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  focusTxt: { color: '#fff', fontSize: 13, fontWeight: '600' },

  /* glass preview */
  glassWrap: { height: 156, borderRadius: 14, overflow: 'hidden', marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  glassBg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#1a2540' },
  glassMenu: { position: 'absolute', top: 18, left: 22, width: 184, borderRadius: 13, padding: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  glassItem: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 34,
    paddingHorizontal: 11, borderRadius: 8 },
  glassItemActive: { backgroundColor: 'rgba(255,255,255,0.1)' },
  glassDot: { width: 6, height: 6, borderRadius: 3 },
  glassTxt: { fontSize: 13 },
  previewTag: { position: 'absolute', top: 12, right: 16, fontSize: 10.5, letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.4)' },

  /* swatches */
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 13 },
  ring: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent' },
  ringActive: { borderColor: '#ffffff' },
  dot: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },

  /* reset */
  reset: { marginTop: 22, height: 50, borderRadius: 13, flexDirection: 'row', gap: 9,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  resetTxt: { color: 'rgba(255,255,255,0.72)', fontSize: 14.5, fontWeight: '600', letterSpacing: 0.2 },
});
