import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { colors, radius } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { useTvFocusable } from '../../lib/useTvFocusable';

// THE one round icon-only button — glass circle, lavender ring on focus, dims +
// non-focusable when disabled. Replaces the inline SeasonChevron and the like.
// Size = sm (40) / md (46).

export type IconButtonSize = 'sm' | 'md';

const ICON_SIZES: Record<IconButtonSize, { box: number; icon: number }> = {
  sm: { box: 40, icon: 20 },
  md: { box: 46, icon: 22 },
};

export function IconButton({
  icon,
  onPress,
  size = 'md',
  disabled,
  autoFocus,
  atRowStart,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  size?: IconButtonSize;
  disabled?: boolean;
  autoFocus?: boolean;
  atRowStart?: boolean;
  color?: string;
}) {
  const m = useMetrics();
  const sz = ICON_SIZES[size];
  const isDisabled = Boolean(disabled);
  const { focused, focusProps } = useTvFocusable({ atRowStart, autoFocus, onPress: () => { if (!isDisabled) onPress(); } });
  return (
    <Pressable
      {...focusProps}
      focusable={!isDisabled}
      style={{
        width: m.s(sz.box),
        height: m.s(sz.box),
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface08,
        borderWidth: 1,
        borderColor: focused ? colors.accent : 'transparent',
        opacity: isDisabled ? 0.35 : 1,
      }}
    >
      <Ionicons name={icon} size={m.s(sz.icon)} color={color ?? '#fff'} />
    </Pressable>
  );
}
