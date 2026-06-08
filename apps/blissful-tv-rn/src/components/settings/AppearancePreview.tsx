import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';

type M = ReturnType<typeof useMetrics>;

function isLight(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length < 6) return false;
  const f = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(2)) + 0.0722 * lin(f(4)) > 0.5;
}
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const f = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${f(0)},${f(2)},${f(4)},${a})`;
}

// Spinner: a native-driver rotate (no SVG) tinted by the accent — one cheap loop.
function Spinner({ accent, m }: { accent: string; m: M }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 850, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const sz = m.s(30);
  return (
    <Animated.View
      style={{
        width: sz,
        height: sz,
        borderRadius: sz / 2,
        borderWidth: m.s(3),
        borderColor: 'rgba(255,255,255,0.12)',
        borderTopColor: accent,
        borderRightColor: accent,
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
      }}
    />
  );
}

// Live preview of the accent: spinner + progress bar + NEW badge + a Focused pill.
export function AccentPreview({ accent, m }: { accent: string; m: M }) {
  const ink = isLight(accent) ? '#0b0b0d' : '#fff';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(16),
        marginBottom: m.s(18),
        padding: m.s(16),
        borderRadius: m.s(14),
        backgroundColor: 'rgba(0,0,0,0.22)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
        flexWrap: 'wrap',
      }}
    >
      <Spinner accent={accent} m={m} />
      <View style={{ flex: 1, minWidth: m.s(120) }}>
        <View style={{ height: m.s(7), borderRadius: m.s(7), backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <View style={{ width: '62%', height: '100%', borderRadius: m.s(7), backgroundColor: accent }} />
        </View>
      </View>
      <View style={{ paddingHorizontal: m.s(11), paddingVertical: m.s(5), borderRadius: 999, backgroundColor: accent }}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(13), letterSpacing: 0.6, color: ink }}>NEW</Text>
      </View>
      <View style={{ height: m.s(38), paddingHorizontal: m.s(16), borderRadius: m.s(11), justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 2, borderColor: accent }}>
        <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(15), color: '#fff' }}>Focused</Text>
      </View>
    </View>
  );
}

// Live preview of the surface: a translucent glass menu over content, tinted by
// the chosen surface (approximates frosted glass without a blur dependency).
export function GlassPreview({ surface, accent, m }: { surface: string; accent: string; m: M }) {
  const items = ['Play next', 'Add to queue', 'Share'];
  return (
    <View style={{ height: m.s(150), borderRadius: m.s(14), overflow: 'hidden', marginBottom: m.s(18), borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#1a2540' }} />
      <View style={{ position: 'absolute', top: m.s(18), left: m.s(22), width: m.s(190), borderRadius: m.s(13), padding: m.s(7), backgroundColor: rgba(surface, 0.78), borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
        {items.map((label, i) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10), height: m.s(34), paddingHorizontal: m.s(11), borderRadius: m.s(8), backgroundColor: i === 0 ? 'rgba(255,255,255,0.1)' : 'transparent' }}>
            <View style={{ width: m.s(7), height: m.s(7), borderRadius: m.s(4), backgroundColor: i === 0 ? accent : 'rgba(255,255,255,0.3)' }} />
            <Text style={{ fontFamily: i === 0 ? font.bodySemi : font.bodyMed, fontSize: m.s(15), color: i === 0 ? '#fff' : 'rgba(255,255,255,0.74)' }}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={{ position: 'absolute', top: m.s(12), right: m.s(16), fontFamily: font.body, fontSize: m.s(12), letterSpacing: 0.5, color: 'rgba(255,255,255,0.4)' }}>PREVIEW</Text>
    </View>
  );
}
