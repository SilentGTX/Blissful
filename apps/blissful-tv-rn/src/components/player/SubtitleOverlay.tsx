import { Text, View } from 'react-native';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { isTransparentColor } from '../../lib/colorUtils';

type M = ReturnType<typeof useMetrics>;

// Draws the active subtitle cue with the user's saved profile style — text
// colour, optional background box, and an outline (four offset layers behind the
// text, the same recipe the SettingsScreen preview uses). This replaces
// expo-video's unstyleable native subtitle rendering. Positioned bottom-centre,
// above the controls bar, non-interactive.
export function SubtitleOverlay({
  text,
  sizePx,
  color,
  bg,
  outline,
  m,
}: {
  text: string | null;
  sizePx: number;
  color: string;
  bg: string;
  outline: string;
  m: M;
}) {
  if (!text) return null;
  const fontSize = m.s(sizePx);
  const lineHeight = fontSize * 1.25;
  const off = Math.max(m.s(1), m.s(sizePx) * 0.055);
  const offsets = [[-off, -off], [off, -off], [-off, off], [off, off]];
  const hasBg = !isTransparentColor(bg);
  const hasOutline = !isTransparentColor(outline);
  const textStyle = { fontFamily: font.bodySemi, fontSize, lineHeight, textAlign: 'center' as const };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: m.s(78), alignItems: 'center', paddingHorizontal: m.s(48), zIndex: 15 }}>
      <View style={[{ paddingHorizontal: m.s(12), paddingVertical: m.s(4), borderRadius: m.s(6), maxWidth: '94%' }, hasBg ? { backgroundColor: bg } : null]}>
        <View>
          {hasOutline
            ? offsets.map(([x, y], i) => (
                <Text key={i} style={[textStyle, { position: 'absolute', left: 0, right: 0, color: outline, transform: [{ translateX: x }, { translateY: y }] }]}>
                  {text}
                </Text>
              ))
            : null}
          <Text style={[textStyle, { color }]}>{text}</Text>
        </View>
      </View>
    </View>
  );
}
