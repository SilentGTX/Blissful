import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useState } from 'react';
import { Pressable, Text, View, type View as RNView } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { volumeFillColor } from '../../lib/colorUtils';

type M = ReturnType<typeof useMetrics>;
const ACCENT = '#95a2ff';

// A focusable transport button: lavender ring + bg tint + scale(1.12) when the
// D-pad lands on it (matches the old .bliss-tv-ctrl-focused). 40x40 hit area.
export const PlayerIconBtn = forwardRef<RNView, {
  m: M;
  onPress: () => void;
  onFocusChange?: (focused: boolean) => void;
  autoFocus?: boolean;
  nextFocusUp?: number;
  nextFocusDown?: number;
  children: (color: string) => React.ReactNode;
}>(function PlayerIconBtn({ m, onPress, onFocusChange, autoFocus, nextFocusUp, nextFocusDown, children }, ref) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      ref={ref}
      hasTVPreferredFocus={autoFocus}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      onFocus={() => { setF(true); onFocusChange?.(true); }}
      onBlur={() => { setF(false); onFocusChange?.(false); }}
      onPress={onPress}
      style={{
        width: m.s(40),
        height: m.s(40),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: f ? m.s(2) : 0,
        borderColor: f ? ACCENT : 'transparent',
        backgroundColor: f ? 'rgba(255,255,255,0.16)' : 'transparent',
        transform: f ? [{ scale: 1.12 }] : undefined,
      }}
    >
      {children(f ? ACCENT : 'rgba(255,255,255,0.85)')}
    </Pressable>
  );
});

export function PlayIcon({ m, paused, color }: { m: M; paused: boolean; color: string }) {
  return <Ionicons name={paused ? 'play' : 'pause'} size={m.s(24)} color={color} />;
}
export function MuteIcon({ m, level, muted, color }: { m: M; level: number; muted: boolean; color: string }) {
  const name = muted || level <= 0 ? 'volume-mute' : level < 0.5 ? 'volume-low' : level < 1 ? 'volume-medium' : 'volume-high';
  return <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={m.s(20)} color={color} />;
}
// Captions box (rounded rect + two rows of lines) — drawn with react-native-svg
// to avoid the MaterialIcons font (not reliably loaded in this build).
export function SubsIcon({ m, color }: { m: M; color: string }) {
  const s = m.s(22);
  return (
    <Svg width={s} height={s} viewBox="0 0 24 24">
      <Rect x={2.5} y={5} width={19} height={14} rx={3} stroke={color} strokeWidth={1.8} fill="none" />
      <Line x1={5.5} y1={11} x2={11} y2={11} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={13} y1={11} x2={18.5} y2={11} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={5.5} y1={15} x2={9} y2={15} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={11} y1={15} x2={18.5} y2={15} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
// Equalizer bars (audio tracks).
export function AudioIcon({ m, color }: { m: M; color: string }) {
  const s = m.s(22);
  return (
    <Svg width={s} height={s} viewBox="0 0 24 24">
      <Line x1={5} y1={9} x2={5} y2={15} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Line x1={10} y1={4.5} x2={10} y2={19.5} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Line x1={15} y1={8} x2={15} y2={16} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Line x1={20} y1={6} x2={20} y2={18} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}
export function FullscreenIcon({ m, color }: { m: M; color: string }) {
  return <Ionicons name="expand" size={m.s(20)} color={color} />;
}

// Gradient volume bar: faint white→yellow→orange→red 30% track, a solid fill of
// volumeFillColor(level) up to the level, + a 12px white thumb. `level` = 0..2.
export function VolumeSlider({ m, level, focused }: { m: M; level: number; focused: boolean }) {
  const pct = Math.max(0, Math.min(1, level / 2)); // 0..1, unity→0.5
  const fill = volumeFillColor(pct);
  const w = m.s(112);
  return (
    <View style={{ width: w, height: m.s(4), borderRadius: 999, overflow: 'hidden', justifyContent: 'center', opacity: focused ? 1 : 0.85 }}>
      <LinearGradient
        colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.3)', 'rgba(250,204,21,0.3)', 'rgba(249,115,22,0.3)', 'rgba(239,68,68,0.3)']}
        locations={[0, 0.5, 0.62, 0.8, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, right: 0, height: m.s(4), borderRadius: 999 }}
      />
      <View style={{ position: 'absolute', left: 0, width: `${pct * 100}%`, height: m.s(4), borderRadius: 999, backgroundColor: fill }} />
      <View style={{ position: 'absolute', left: `${pct * 100}%`, width: m.s(12), height: m.s(12), borderRadius: 999, marginLeft: -m.s(6), backgroundColor: '#fff', borderWidth: focused ? m.s(2) : 0, borderColor: ACCENT }} />
    </View>
  );
}

// Small uppercase source/quality pills (RD / 4K / HDR), top-right of the player.
export function SourceBadges({ m, badges }: { m: M; badges: string[] }) {
  if (badges.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
      {badges.map((b) => (
        <View key={b} style={{ borderRadius: m.s(6), borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: m.s(8), paddingVertical: m.s(4) }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(13), fontWeight: '700', letterSpacing: m.s(0.5), color: 'rgba(255,255,255,0.8)' }}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

// Top-right "Watch Party" pill (focusable). Full feature is a later chunk; for
// now it's a styled focusable entry that calls onPress.
export function WatchPartyButton({ m, onPress, onFocusChange }: { m: M; onPress: () => void; onFocusChange?: (f: boolean) => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onFocus={() => { setF(true); onFocusChange?.(true); }}
      onBlur={() => { setF(false); onFocusChange?.(false); }}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8), borderRadius: 999, borderWidth: 1, borderColor: f ? ACCENT : 'rgba(255,255,255,0.1)', backgroundColor: f ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.4)', paddingHorizontal: m.s(14), paddingVertical: m.s(9) }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: f ? ACCENT : '#fff' }}>Watch Party</Text>
    </Pressable>
  );
}

// Top-left back pill: chevron + title (title 16px, max 40% width).
export function BackPill({ m, title, onPress, onFocusChange }: { m: M; title: string; onPress: () => void; onFocusChange?: (f: boolean) => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus
      onFocus={() => { setF(true); onFocusChange?.(true); }}
      onBlur={() => { setF(false); onFocusChange?.(false); }}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8), alignSelf: 'flex-start', maxWidth: '40%', borderRadius: 999, borderWidth: 1, borderColor: f ? ACCENT : 'rgba(255,255,255,0.1)', backgroundColor: f ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.4)', paddingHorizontal: m.s(12), paddingVertical: m.s(8) }}
    >
      <Ionicons name="chevron-back" size={m.s(20)} color={f ? ACCENT : '#fff'} />
      <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: f ? ACCENT : '#fff' }}>{title}</Text>
    </Pressable>
  );
}
