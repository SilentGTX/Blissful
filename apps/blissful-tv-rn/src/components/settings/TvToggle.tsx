import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, font, radius } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { markContentFocus } from '../../lib/focusBus';
import { useSelfTag } from '../../lib/useSelfTag';

type M = ReturnType<typeof useMetrics>;

// A D-pad focusable on/off switch row (mirrors the desktop BingeToggle, but the
// whole row is the focus stop and OK flips it). Lavender ring on focus; the
// knob slides + the track tints accent when on.
export function TvToggle({
  label,
  hint,
  value,
  m,
  atRowStart,
  onToggle,
}: {
  label: string;
  hint?: string;
  value: boolean;
  m: M;
  atRowStart?: boolean;
  onToggle: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  const selfTag = useSelfTag(ref, Boolean(atRowStart));

  const trackW = m.s(56);
  const trackH = m.s(32);
  const knob = m.s(26);
  const pad = m.s(3);

  return (
    <Pressable
      ref={ref}
      nextFocusLeft={selfTag}
      onFocus={() => { setFocused(true); markContentFocus(Boolean(atRowStart)); }}
      onBlur={() => setFocused(false)}
      onPress={onToggle}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(16),
        paddingVertical: m.s(12),
        paddingHorizontal: m.s(16),
        borderRadius: radius.field,
        borderWidth: 1,
        borderColor: focused ? colors.accent : 'transparent',
        backgroundColor: focused ? colors.surface10 : 'transparent',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: colors.text }}>{label}</Text>
        {hint ? (
          <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost, marginTop: m.s(4), lineHeight: m.s(21) }}>{hint}</Text>
        ) : null}
      </View>
      <View
        style={{
          width: trackW,
          height: trackH,
          borderRadius: 999,
          backgroundColor: value ? colors.accent : colors.surface18,
          justifyContent: 'center',
          padding: pad,
        }}
      >
        <View
          style={{
            width: knob,
            height: knob,
            borderRadius: 999,
            backgroundColor: value ? colors.accentInk : colors.text,
            alignSelf: value ? 'flex-end' : 'flex-start',
          }}
        />
      </View>
    </Pressable>
  );
}
