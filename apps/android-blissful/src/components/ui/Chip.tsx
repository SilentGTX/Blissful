import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { colors, font, radius } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { useTvFocusable } from '../../lib/useTvFocusable';

// THE one pill-chip. Two roles, picked by whether `onPress` is given:
//   - focusable (onPress) → a D-pad chip with the lavender focus ring; `active`
//     flips it to the solid white fill + ink text (Library sort/watched + type
//     filters, Detail genre/cast chips).
//   - static (no onPress) → a non-focusable label tag (the Addons type/resource
//     pills). Compact, hairline-outlined.
// Sizes are 1920-design px scaled internally via m.s(), so callers just pick a
// variant. 1:1 with the inline chips it replaces across the app.

export type ChipSize = 'sm' | 'md';

// md = filter chips (fixed height 52, centred — aligns with TvSelect in a row);
// sm = genre/cast chips (padding-sized, font 18).
const CHIP_SIZES: Record<ChipSize, { height?: number; padV?: number; padH: number; fontSize: number }> = {
  sm: { padH: 19, padV: 10, fontSize: 18 },
  md: { height: 52, padH: 22, fontSize: 20 },
};

export function Chip({
  label,
  onPress,
  active = false,
  size = 'md',
  icon,
  atRowStart,
  autoFocus,
  containerStyle,
}: {
  label: string;
  /** Omit for a static, non-focusable label tag. */
  onPress?: () => void;
  active?: boolean;
  size?: ChipSize;
  icon?: keyof typeof Ionicons.glyphMap;
  atRowStart?: boolean;
  autoFocus?: boolean;
  containerStyle?: ViewStyle;
}) {
  const m = useMetrics();

  // Static label tag (Addons resource pills) — compact, never focusable.
  if (!onPress) {
    return (
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: m.s(6),
            paddingHorizontal: m.s(12),
            paddingVertical: m.s(5),
            borderRadius: radius.pill,
            backgroundColor: colors.surface08,
            borderWidth: 1,
            borderColor: colors.hairline,
          },
          containerStyle,
        ]}
      >
        {icon ? <Ionicons name={icon} size={m.s(15)} color={colors.textDim} /> : null}
        <Text numberOfLines={1} style={{ fontFamily: font.bodyMed, fontSize: m.s(15), color: colors.textDim }}>
          {label}
        </Text>
      </View>
    );
  }

  return <FocusableChip label={label} onPress={onPress} active={active} size={size} icon={icon} atRowStart={atRowStart} autoFocus={autoFocus} containerStyle={containerStyle} m={m} />;
}

function FocusableChip({
  label,
  onPress,
  active,
  size,
  icon,
  atRowStart,
  autoFocus,
  containerStyle,
  m,
}: {
  label: string;
  onPress: () => void;
  active: boolean;
  size: ChipSize;
  icon?: keyof typeof Ionicons.glyphMap;
  atRowStart?: boolean;
  autoFocus?: boolean;
  containerStyle?: ViewStyle;
  m: ReturnType<typeof useMetrics>;
}) {
  const sz = CHIP_SIZES[size];
  const { focused, focusProps } = useTvFocusable({ atRowStart, autoFocus, onPress });
  const fg = active ? colors.ink : 'rgba(255,255,255,0.9)';
  return (
    <Pressable
      {...focusProps}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: m.s(8),
          height: sz.height ? m.s(sz.height) : undefined,
          paddingVertical: sz.padV ? m.s(sz.padV) : undefined,
          paddingHorizontal: m.s(sz.padH),
          borderRadius: radius.pill,
          backgroundColor: active ? colors.text : colors.surface10,
          borderWidth: 1,
          borderColor: focused ? colors.accent : 'transparent',
        },
        containerStyle,
      ]}
    >
      {icon ? <Ionicons name={icon} size={m.s(sz.fontSize + 2)} color={fg} /> : null}
      <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(sz.fontSize), color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

// Maps a string[] (genres, cast) → a wrapping row of chips. Replaces the inline
// Detail `Chips` helper. `atRowStart` applies to the first chip only.
export function ChipRow({
  items,
  onPress,
  size = 'sm',
  gap = 10,
  atRowStart,
}: {
  items: string[];
  onPress: (item: string) => void;
  size?: ChipSize;
  gap?: number;
  atRowStart?: boolean;
}) {
  const m = useMetrics();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(gap) }}>
      {items.map((it, i) => (
        <Chip key={it} label={it} size={size} onPress={() => onPress(it)} atRowStart={atRowStart && i === 0} />
      ))}
    </View>
  );
}
