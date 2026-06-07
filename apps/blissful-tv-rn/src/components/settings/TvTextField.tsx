import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInput as RNTextInput } from 'react-native';
import { colors, font, radius } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { markContentFocus } from '../../lib/focusBus';
import { useSelfTag } from '../../lib/useSelfTag';

type M = ReturnType<typeof useMetrics>;

// A D-pad focusable settings text field. The whole row is a Pressable focus
// stop (lavender ring on focus, mirroring PosterCard/TvSelect); pressing OK
// focuses the inner TextInput, which raises the Android TV on-screen keyboard
// (IME). `secureMask` shows a dotted preview of a stored secret (RD/TMDB key)
// without exposing it, while still letting the user retype.
export function TvTextField({
  label,
  hint,
  value,
  placeholder,
  onChange,
  onSubmit,
  m,
  atRowStart,
  secureMask,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  m: M;
  atRowStart?: boolean;
  secureMask?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const rowRef = useRef<View>(null);
  const inputRef = useRef<RNTextInput | null>(null);
  const selfTag = useSelfTag(rowRef, Boolean(atRowStart));

  const displayValue = secureMask && !editing && value ? '•'.repeat(Math.min(value.length, 24)) : value;

  return (
    <View style={{ gap: m.s(8) }}>
      <Text style={{ fontFamily: font.body, fontSize: m.s(17), color: colors.textDim }}>{label}</Text>
      <Pressable
        ref={rowRef}
        nextFocusLeft={selfTag}
        onFocus={() => { setFocused(true); markContentFocus(Boolean(atRowStart)); }}
        onBlur={() => setFocused(false)}
        onPress={() => inputRef.current?.focus()}
        style={{
          minHeight: m.s(52),
          borderRadius: radius.field,
          borderWidth: 1,
          borderColor: focused ? colors.accent : colors.hairline,
          backgroundColor: colors.surface10,
          paddingHorizontal: m.s(16),
          justifyContent: 'center',
        }}
      >
        <TextInput
          ref={inputRef}
          value={editing ? value : displayValue}
          onChangeText={onChange}
          onFocus={() => { setEditing(true); setFocused(true); }}
          onBlur={() => { setEditing(false); setFocused(false); }}
          onSubmitEditing={onSubmit}
          placeholder={placeholder}
          placeholderTextColor={colors.textGhost}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          // Let the parent Pressable own the focus ring; we don't want the bare
          // input to also be a separate D-pad stop on the same row.
          style={{
            fontFamily: font.body,
            fontSize: m.s(20),
            color: colors.text,
            paddingVertical: m.s(12),
          }}
        />
      </Pressable>
      {hint ? (
        <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost, lineHeight: m.s(21) }}>{hint}</Text>
      ) : null}
    </View>
  );
}
