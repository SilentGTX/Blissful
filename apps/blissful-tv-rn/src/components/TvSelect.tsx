import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { FocusTrap } from './FocusTrap';
import { markContentFocus } from '../lib/focusBus';
import { useSelfTag } from '../lib/useSelfTag';
import { useSettingsLeftTarget } from '../lib/settingsLeftTarget';

export type SelectOption = { key: string; label: string };
type M = ReturnType<typeof useMetrics>;

// What the screen needs to host the dropdown overlay at the root level.
export type DropdownAnchor = {
  pos: { x: number; y: number; w: number; h: number };
  options: SelectOption[];
  value: string;
  onChange: (key: string) => void;
  /** Return D-pad focus to the trigger that opened this dropdown (call after the
   *  overlay closes) so focus doesn't snap to the first focusable on screen. */
  requestFocus: () => void;
};

// The trigger button (icon + value + chevron). On press it measures itself and
// asks the screen to open the overlay (the overlay must render at the screen
// root, not nested here, so its absolute fill covers the whole screen).
export function TvSelect({
  iconName,
  options,
  value,
  onChange,
  m,
  minWidth,
  atRowStart,
  onOpen,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  options: SelectOption[];
  value: string;
  onChange: (key: string) => void;
  m: M;
  minWidth: number;
  atRowStart?: boolean;
  onOpen: (anchor: DropdownAnchor) => void;
}) {
  const [focused, setFocused] = useState(false);
  const triggerRef = useRef<View>(null);
  const leftTarget = useSettingsLeftTarget();
  const railTrap = leftTarget == null && Boolean(atRowStart);
  const selfTag = useSelfTag(triggerRef, railTrap);
  const current = options.find((o) => o.key === value);
  const open = () =>
    triggerRef.current?.measureInWindow((x, y, w, h) =>
      onOpen({
        pos: { x, y, w, h },
        options,
        value,
        onChange,
        requestFocus: () => (triggerRef.current as unknown as { requestTVFocus?: () => void } | null)?.requestTVFocus?.(),
      }),
    );
  return (
    <Pressable
      ref={triggerRef}
      nextFocusLeft={leftTarget ?? selfTag}
      onFocus={() => { setFocused(true); markContentFocus(railTrap); }}
      onBlur={() => setFocused(false)}
      onPress={open}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10), minWidth, height: m.s(52), paddingHorizontal: m.s(18), borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.12)' }}
    >
      <Ionicons name={iconName} size={m.s(22)} color={colors.textDim} />
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.bodySemi, fontSize: m.s(20), color: colors.text }}>{current?.label ?? ''}</Text>
      <Ionicons name="chevron-down" size={m.s(20)} color={colors.textDim} />
    </Pressable>
  );
}

function Row({ label, selected, autoFocus, m, onPress }: { label: string; selected: boolean; autoFocus: boolean; m: M; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10), paddingVertical: m.s(11), paddingHorizontal: m.s(16), borderRadius: m.s(12), backgroundColor: f ? colors.surface10 : 'transparent', borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Text style={{ flex: 1, fontFamily: font.bodySemi, fontSize: m.s(20), color: selected ? colors.accent : colors.text }}>{label}</Text>
      {selected ? <Ionicons name="checkmark" size={m.s(20)} color={colors.accent} /> : null}
    </Pressable>
  );
}

// Screen-root overlay: dims the screen, anchors the option list under the
// trigger. Absolute overlay (not a Modal) so D-pad select fires.
export function TvSelectOverlay({ anchor, onClose, m }: { anchor: DropdownAnchor; onClose: () => void; m: M }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  const idx = Math.max(0, anchor.options.findIndex((o) => o.key === anchor.value));
  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} focusable={false} onPress={onClose} />
      <FocusTrap style={{ position: 'absolute', left: anchor.pos.x, top: anchor.pos.y + anchor.pos.h + m.s(6), minWidth: Math.max(anchor.pos.w, m.s(220)), maxHeight: m.s(420), borderRadius: m.s(16), padding: m.s(6), backgroundColor: 'rgba(20,24,33,0.98)', borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' }}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {anchor.options.map((o, i) => (
            <Row key={o.key} label={o.label} selected={o.key === anchor.value} autoFocus={i === idx} m={m} onPress={() => { anchor.onChange(o.key); onClose(); }} />
          ))}
        </ScrollView>
      </FocusTrap>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.35)' },
});
