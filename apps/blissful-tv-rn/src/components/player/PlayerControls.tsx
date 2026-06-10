import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { volumeFillColor } from '../../lib/colorUtils';

type M = ReturnType<typeof useMetrics>;
const ACCENT = '#95a2ff';

// Non-focusable transport button — focus is driven by the player's virtual index
// (the old app's model), NOT native tvos focus. `focused` lights the lavender ring
// + bg tint + scale(1.12) (matches .bliss-tv-ctrl-focused). 40x40 hit area.
export function PlayerIconBtn({ m, focused, children }: { m: M; focused: boolean; children: (color: string) => React.ReactNode }) {
  return (
    <View
      style={{
        width: m.s(40),
        height: m.s(40),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: focused ? m.s(2) : 0,
        borderColor: focused ? ACCENT : 'transparent',
        backgroundColor: focused ? 'rgba(255,255,255,0.16)' : 'transparent',
        // Always an array — toggling transform to `undefined` on the New Arch
        // throws "Cannot read property 'forEach' of null".
        transform: [{ scale: focused ? 1.12 : 1 }],
      }}
    >
      {children(focused ? ACCENT : 'rgba(255,255,255,0.85)')}
    </View>
  );
}

export function PlayIcon({ m, paused, color }: { m: M; paused: boolean; color: string }) {
  return <Ionicons name={paused ? 'play' : 'pause'} size={m.s(24)} color={color} />;
}
export function MuteIcon({ m, level, muted, color }: { m: M; level: number; muted: boolean; color: string }) {
  const name = muted || level <= 0 ? 'volume-mute' : level < 0.5 ? 'volume-low' : level < 1 ? 'volume-medium' : 'volume-high';
  return <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={m.s(20)} color={color} />;
}
// Captions box + two rows of lines — pure Views (react-native-svg crashes
// "forEach of null" when its parent View has a scale transform = our focus ring).
export function SubsIcon({ m, color }: { m: M; color: string }) {
  const w = m.s(22);
  const bar = (flex: number) => <View style={{ flex, height: m.s(1.8), borderRadius: 1, backgroundColor: color }} />;
  return (
    <View style={{ width: w, height: w * 0.72, borderRadius: m.s(3), borderWidth: m.s(1.8), borderColor: color, justifyContent: 'center', paddingHorizontal: m.s(3), gap: m.s(2.5) }}>
      <View style={{ flexDirection: 'row', gap: m.s(2) }}>{bar(2)}{bar(2)}</View>
      <View style={{ flexDirection: 'row', gap: m.s(2) }}>{bar(1)}{bar(3)}</View>
    </View>
  );
}
// Releases — cloud icon (switch the torrent/release mid-playback), matching
// OpenCode's BlissfulPlayer bottom-controls "Releases" button.
export function ReleasesIcon({ m, color }: { m: M; color: string }) {
  return <Ionicons name="cloud-outline" size={m.s(24)} color={color} />;
}
// Equalizer bars (audio tracks) — pure Views.
export function AudioIcon({ m, color }: { m: M; color: string }) {
  const s = m.s(22);
  const heights = [0.55, 1, 0.45, 0.75];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: s, gap: m.s(2.4) }}>
      {heights.map((h, i) => (
        <View key={i} style={{ width: m.s(2.4), height: s * h, borderRadius: m.s(2), backgroundColor: color }} />
      ))}
    </View>
  );
}
export function FullscreenIcon({ m, color }: { m: M; color: string }) {
  return <Ionicons name="expand" size={m.s(20)} color={color} />;
}

// Gradient volume bar: faint white→yellow→orange→red 30% track, a solid fill of
// volumeFillColor(level) up to the level, + a 12px white thumb. `level` = 0..2.
export function VolumeSlider({ m, level }: { m: M; level: number }) {
  const pct = Math.max(0, Math.min(1, level / 2));
  const fill = volumeFillColor(pct);
  const w = m.s(112);
  return (
    <View style={{ width: w, height: m.s(4), borderRadius: 999, overflow: 'hidden', justifyContent: 'center', opacity: 0.85 }}>
      <LinearGradient
        colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.3)', 'rgba(250,204,21,0.3)', 'rgba(249,115,22,0.3)', 'rgba(239,68,68,0.3)']}
        locations={[0, 0.5, 0.62, 0.8, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, right: 0, height: m.s(4), borderRadius: 999 }}
      />
      <View style={{ position: 'absolute', left: 0, width: `${pct * 100}%`, height: m.s(4), borderRadius: 999, backgroundColor: fill }} />
      <View style={{ position: 'absolute', left: `${pct * 100}%`, width: m.s(12), height: m.s(12), borderRadius: 999, marginLeft: -m.s(6), backgroundColor: '#fff' }} />
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

// Top-right "Watch Party" pill (focus driven by virtual index).
export function WatchPartyButton({ m, focused }: { m: M; focused: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8), borderRadius: 999, borderWidth: 1, borderColor: focused ? ACCENT : 'rgba(255,255,255,0.1)', backgroundColor: focused ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.4)', paddingHorizontal: m.s(14), paddingVertical: m.s(9) }}>
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: focused ? ACCENT : '#fff' }}>Watch Party</Text>
    </View>
  );
}

// Top-left back pill: chevron + title.
export function BackPill({ m, title, focused }: { m: M; title: string; focused: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8), alignSelf: 'flex-start', maxWidth: '40%', borderRadius: 999, borderWidth: 1, borderColor: focused ? ACCENT : 'rgba(255,255,255,0.1)', backgroundColor: focused ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.4)', paddingHorizontal: m.s(12), paddingVertical: m.s(8) }}>
      <Ionicons name="chevron-back" size={m.s(20)} color={focused ? ACCENT : '#fff'} />
      <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: focused ? ACCENT : '#fff' }}>{title}</Text>
    </View>
  );
}
