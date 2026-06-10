import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme/colors';
import type { useMetrics } from '../theme/metrics';
import { FocusTrap } from './FocusTrap';
import type { CardItem } from './PosterCard';
import type { CardRect } from './LibraryPosterCard';

type M = ReturnType<typeof useMetrics>;

// A compact action button tuned for the narrower portrait poster (vs the wide
// landscape tile in HomeActionOverlay): the label wraps to 2 lines and the
// height grows to fit, so "Remove from library" reads cleanly on a 2:3 card.
function ActionBtn({ label, icon, autoFocus, m, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; autoFocus?: boolean; m: M; onPress: () => void }) {
  const [f, setF] = useState(false);
  const fg = f ? colors.accentInk : '#fff';
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: m.s(10), minHeight: m.s(46), paddingVertical: m.s(8), paddingHorizontal: m.s(12), borderRadius: m.s(12), backgroundColor: f ? colors.accent : 'rgba(255,255,255,0.12)' }}
    >
      <Ionicons name={icon} size={m.s(22)} color={fg} />
      <Text numberOfLines={2} style={{ fontFamily: font.bodySemi, fontSize: m.s(17), color: fg, flexShrink: 1 }}>{label}</Text>
    </Pressable>
  );
}

// The hold-OK quick action for the Library grid, laid directly ON the focused
// poster — same pattern as HomeActionOverlay (CW): a root-level overlay placed
// at the card's measured window rect (so the focus trap / Back work reliably
// over the FlatList), the poster art dimmed behind it so it reads as "options on
// the poster", not a detached modal. Back closes it (LibraryScreen owns state).
export function LibraryActionOverlay({
  item,
  rect,
  m,
  onRemove,
  onClose,
}: {
  item: CardItem | null;
  rect: CardRect | null;
  m: M;
  onRemove: (item: CardItem) => void;
  onClose: () => void;
}) {
  if (!item || !rect) return null;
  return (
    <View style={styles.root}>
      {/* light full-screen scrim — neighbours stay faintly visible behind */}
      <Pressable style={styles.scrim} focusable={false} onPress={onClose} />
      {/* the action box, sized + placed exactly over the focused poster */}
      <View style={{ position: 'absolute', top: rect.y, left: rect.x, width: rect.w, height: rect.h, borderRadius: m.s(16), overflow: 'hidden' }}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(5,7,11,0.9)' }]} />
        <FocusTrap style={{ flex: 1, justifyContent: 'center', gap: m.s(10), paddingHorizontal: m.s(12) }}>
          <ActionBtn label="Remove from library" icon="bookmark" autoFocus m={m} onPress={() => onRemove(item)} />
        </FocusTrap>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: m.s(16), borderWidth: m.s(3), borderColor: colors.accent }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 150 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
});
