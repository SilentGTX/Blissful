import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { colors, font, radius } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { markContentFocus } from '../../lib/focusBus';
import { useSelfTag } from '../../lib/useSelfTag';

type M = ReturnType<typeof useMetrics>;

// A D-pad focusable glass pill button — the RN equivalent of the desktop
// FocusableButton in pillBtnClass mode (rounded-full, hairline border,
// white/0.06 fill, lavender ring on focus). `primary` swaps to the solid white
// CTA (bg-white text-black) used by the Account Save buttons. Disabled buttons
// dim and become non-focusable.
export function PillButton({
  label,
  m,
  onPress,
  disabled,
  busy,
  primary,
  atRowStart,
}: {
  label: string;
  m: M;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
  atRowStart?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  const selfTag = useSelfTag(ref, Boolean(atRowStart));
  const isDisabled = Boolean(disabled);

  const baseBg = primary ? colors.text : colors.surface;
  const textColor = primary ? colors.ink : colors.text;

  return (
    <Pressable
      ref={ref}
      focusable={!isDisabled}
      nextFocusLeft={selfTag}
      onFocus={() => { setFocused(true); markContentFocus(Boolean(atRowStart)); }}
      onBlur={() => setFocused(false)}
      onPress={() => { if (!isDisabled) onPress(); }}
      style={{
        height: m.s(52),
        minWidth: m.s(120),
        paddingHorizontal: m.s(24),
        borderRadius: radius.pill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isDisabled ? colors.surface : baseBg,
        borderWidth: 1,
        borderColor: focused ? colors.accent : colors.hairline,
        opacity: isDisabled ? 0.5 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.ink : colors.text} />
      ) : (
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: isDisabled ? colors.textGhost : textColor }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
