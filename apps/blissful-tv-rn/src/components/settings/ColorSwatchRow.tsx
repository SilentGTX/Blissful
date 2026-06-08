import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { colors } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { markContentFocus } from '../../lib/focusBus';
import { useSelfTag } from '../../lib/useSelfTag';

type M = ReturnType<typeof useMetrics>;

// One focusable color swatch. Selected = solid white ring baked in; focused =
// lavender accent ring (mirrors PosterCard's focus treatment). The leftmost
// swatch in a row traps D-pad Left on itself so the nav rail can open cleanly.
function Swatch({
  hex,
  selected,
  size,
  m,
  atRowStart,
  onPress,
}: {
  hex: string;
  selected: boolean;
  size: number;
  m: M;
  atRowStart?: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  const selfTag = useSelfTag(ref, Boolean(atRowStart));
  return (
    <Pressable
      ref={ref}
      nextFocusLeft={selfTag}
      onFocus={() => { setFocused(true); markContentFocus(Boolean(atRowStart)); }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: hex,
        borderWidth: focused ? 2 : selected ? 2 : 1,
        borderColor: focused ? colors.accent : selected ? colors.text : 'rgba(255,255,255,0.2)',
        // Always an array — toggling transform to undefined crashes the New Arch
        // ("Cannot read property 'forEach' of null" in processTransform).
        transform: [{ scale: focused ? 1.12 : 1 }],
      }}
    />
  );
}

// A wrapping row of focusable swatches. `value` is matched case-insensitively
// against each preset to draw the selected ring.
export function ColorSwatchRow({
  presets,
  value,
  m,
  size,
  atRowStart,
  onChange,
}: {
  presets: readonly string[];
  value: string;
  m: M;
  size?: number;
  atRowStart?: boolean;
  onChange: (hex: string) => void;
}) {
  const sw = size ?? m.s(40);
  const current = value.toLowerCase();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(12) }}>
      {presets.map((hex, i) => (
        <Swatch
          key={hex}
          hex={hex}
          size={sw}
          selected={current === hex.toLowerCase()}
          m={m}
          atRowStart={atRowStart && i === 0}
          onPress={() => onChange(hex)}
        />
      ))}
    </View>
  );
}
