import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { colors } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { markContentFocus } from '../../lib/focusBus';
import { isTransparentColor, normColor } from '../../lib/colorUtils';
import { useSelfTag } from '../../lib/useSelfTag';
import { useSettingsLeftTarget } from '../../lib/settingsLeftTarget';

type M = ReturnType<typeof useMetrics>;

// One focusable color swatch. Selected = solid white ring baked in; focused =
// lavender accent ring (mirrors PosterCard's focus treatment). The leftmost
// swatch in a row traps D-pad Left on itself so the nav rail can open cleanly.
function Swatch({
  hex,
  selected,
  size,
  fill,
  m,
  atRowStart,
  onPress,
}: {
  hex: string;
  selected: boolean;
  size: number;
  /** Flex to share the row width evenly (circles grow to fill it). */
  fill?: boolean;
  m: M;
  atRowStart?: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  const leftTarget = useSettingsLeftTarget();
  const railTrap = leftTarget == null && Boolean(atRowStart);
  const selfTag = useSelfTag(ref, railTrap);
  const transparent = isTransparentColor(hex);
  return (
    <Pressable
      ref={ref}
      nextFocusLeft={Boolean(atRowStart) && leftTarget != null ? leftTarget : selfTag}
      onFocus={() => { setFocused(true); markContentFocus(railTrap); }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        // fill: flex to share the row, aspectRatio keeps them circular; otherwise
        // a fixed square. borderRadius 999 rounds either to a circle.
        ...(fill ? { flex: 1, aspectRatio: 1 } : { width: size, height: size }),
        borderRadius: 999,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        // A fully-transparent swatch would be invisible against the panel — give
        // it a faint fill + a diagonal "no colour" slash so it reads as transparent.
        backgroundColor: transparent ? 'rgba(255,255,255,0.06)' : hex,
        borderWidth: focused ? 2 : selected ? 2 : 1,
        borderColor: focused ? colors.accent : selected ? colors.text : 'rgba(255,255,255,0.2)',
        // Always an array — toggling transform to undefined crashes the New Arch
        // ("Cannot read property 'forEach' of null" in processTransform).
        transform: [{ scale: focused ? 1.12 : 1 }],
      }}
    >
      {transparent ? (
        <View style={{ position: 'absolute', width: '140%', height: 2, backgroundColor: 'rgba(255,90,90,0.9)', transform: [{ rotate: '-45deg' }] }} />
      ) : null}
    </Pressable>
  );
}

// A wrapping row of focusable swatches. `value` is matched case-insensitively
// against each preset to draw the selected ring.
export function ColorSwatchRow({
  presets,
  value,
  m,
  size,
  fill,
  atRowStart,
  onChange,
}: {
  presets: readonly string[];
  value: string;
  m: M;
  size?: number;
  /** Swatches flex to fill the whole row width (bigger circles, even spacing). */
  fill?: boolean;
  atRowStart?: boolean;
  onChange: (hex: string) => void;
}) {
  const sw = size ?? m.s(40);
  const current = normColor(value);
  return (
    <View style={{ flexDirection: 'row', flexWrap: fill ? 'nowrap' : 'wrap', gap: m.s(12) }}>
      {presets.map((hex, i) => (
        <Swatch
          key={hex}
          hex={hex}
          size={sw}
          fill={fill}
          selected={current === normColor(hex)}
          m={m}
          atRowStart={atRowStart && i === 0}
          onPress={() => onChange(hex)}
        />
      ))}
    </View>
  );
}
