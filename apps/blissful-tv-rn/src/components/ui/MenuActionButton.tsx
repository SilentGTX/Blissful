import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';
import { colors, font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { useTvFocusable } from '../../lib/useTvFocusable';

// The action-overlay button (hold-OK menus laid on a poster/tile): a rounded-rect
// row that FILLS with the accent on focus (fg → ink) — a stronger affordance than
// the pill-ring family, because it's the lone control on a dimmed card. `danger`
// tints the label red at rest (Remove progress); `wrap` lets a long label run to
// 2 lines on the narrow portrait poster. Replaces the duplicated ActionBtn in
// HomeActionOverlay + LibraryActionOverlay.
export function MenuActionButton({
  label,
  icon,
  onPress,
  danger,
  wrap,
  autoFocus,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  danger?: boolean;
  wrap?: boolean;
  autoFocus?: boolean;
}) {
  const m = useMetrics();
  const { focused, focusProps } = useTvFocusable({ autoFocus, onPress });
  const fg = focused ? colors.accentInk : danger ? colors.danger : '#fff';
  return (
    <Pressable
      {...focusProps}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: m.s(10),
        minHeight: m.s(46),
        height: wrap ? undefined : m.s(46),
        paddingVertical: wrap ? m.s(8) : undefined,
        paddingHorizontal: m.s(wrap ? 12 : 16),
        borderRadius: m.s(12),
        backgroundColor: focused ? colors.accent : colors.surface10,
      }}
    >
      <Ionicons name={icon} size={m.s(22)} color={fg} />
      <Text numberOfLines={wrap ? 2 : 1} style={{ fontFamily: font.bodySemi, fontSize: m.s(wrap ? 17 : 18), color: fg, flexShrink: wrap ? 1 : 0 }}>
        {label}
      </Text>
    </Pressable>
  );
}
