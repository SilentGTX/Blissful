import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, type ViewStyle } from 'react-native';
import { colors, font, radius } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { useTvFocusable } from '../../lib/useTvFocusable';

// THE one pill action button (optional leading icon + label). Replaces the
// per-screen ActionBtn / BackPill / PillButton / modal Btn copies. Variants:
//   - glass  → faint glass fill + hairline, lavender ring on focus (secondary
//              actions, Back pills, modal secondaries).
//   - solid  → white fill + ink text (primary CTAs: Save, Login, modal confirm).
//   - accent → lavender fill + ink text, white ring on focus (Detail "Watch").
// Size = sm (height 40) / md (height 52). Focus + the Settings Left→category /
// rail-open routing all come from the shared useTvFocusable, so one button works
// everywhere (incl. the Settings two-column layout) with no per-call wiring.

export type ButtonVariant = 'glass' | 'solid' | 'accent';
export type ButtonSize = 'sm' | 'md';

const BTN_SIZES: Record<ButtonSize, { height: number; fontSize: number; padH: number; gap: number; icon: number; minWidth: number }> = {
  sm: { height: 40, fontSize: 18, padH: 24, gap: 10, icon: 22, minWidth: 0 },
  md: { height: 52, fontSize: 18, padH: 24, gap: 10, icon: 22, minWidth: 120 },
};

function palette(variant: ButtonVariant, focused: boolean, disabled: boolean): { bg: string; fg: string; border: string } {
  if (disabled) return { bg: colors.surface, fg: colors.textGhost, border: colors.hairline };
  switch (variant) {
    case 'solid':
      return { bg: colors.text, fg: colors.ink, border: focused ? colors.accent : colors.hairline };
    case 'accent':
      return { bg: colors.accent, fg: colors.accentInk, border: focused ? colors.text : 'transparent' };
    default:
      return { bg: colors.surface10, fg: colors.text, border: focused ? colors.accent : colors.hairline };
  }
}

export function Button({
  label,
  icon,
  onPress,
  variant = 'glass',
  size = 'md',
  disabled,
  busy,
  wrap,
  fullWidth,
  atRowStart,
  autoFocus,
  style,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  busy?: boolean;
  /** Allow the label to wrap to 2 lines (height grows). */
  wrap?: boolean;
  /** Stretch to the parent's width (full-width modal CTAs). */
  fullWidth?: boolean;
  atRowStart?: boolean;
  autoFocus?: boolean;
  style?: ViewStyle;
}) {
  const m = useMetrics();
  const sz = BTN_SIZES[size];
  const isDisabled = Boolean(disabled);
  const { focused, focusProps } = useTvFocusable({ atRowStart, autoFocus, onPress: () => { if (!isDisabled) onPress(); } });
  const p = palette(variant, focused, isDisabled);
  return (
    <Pressable
      {...focusProps}
      focusable={!isDisabled}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: m.s(sz.gap),
          height: wrap ? undefined : m.s(sz.height),
          minHeight: wrap ? m.s(sz.height) : undefined,
          paddingVertical: wrap ? m.s(8) : undefined,
          paddingHorizontal: m.s(sz.padH),
          minWidth: sz.minWidth ? m.s(sz.minWidth) : undefined,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          borderRadius: radius.pill,
          backgroundColor: p.bg,
          borderWidth: 1,
          borderColor: p.border,
          opacity: isDisabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={m.s(sz.icon)} color={p.fg} /> : null}
          <Text numberOfLines={wrap ? 2 : 1} style={{ fontFamily: font.bodySemi, fontSize: m.s(sz.fontSize), color: p.fg, flexShrink: wrap ? 1 : 0, textAlign: 'center' }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
