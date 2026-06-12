import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../../theme/colors';
import type { useMetrics } from '../../theme/metrics';
import { FocusTrap } from '../FocusTrap';
import { MenuActionButton } from '../ui/MenuActionButton';
import type { HomeItem } from './homeData';
import type { CardRect } from '../PosterCard';

type M = ReturnType<typeof useMetrics>;

// The hold-OK quick actions, laid out directly ON the focused tile: a root-level
// overlay positioned at the tile's measured rect (so the focus trap / Back work
// reliably — an in-list trap fought the FlatList). The tile art shows through a
// dim, so it reads as "options on the poster", not a detached modal. Back closes
// it (HomeScreen owns the state + BackHandler).
export function HomeActionOverlay({
  item,
  rect,
  inLibrary,
  m,
  onToggleLibrary,
  onRemoveProgress,
  onClose,
}: {
  item: HomeItem | null;
  rect: CardRect | null;
  inLibrary: boolean;
  m: M;
  onToggleLibrary: (it: HomeItem) => void;
  onRemoveProgress: (it: HomeItem) => void;
  onClose: () => void;
}) {
  if (!item || !rect) return null;
  const isCw = item.cw != null;
  return (
    <View style={styles.root}>
      {/* light full-screen scrim — neighbours stay faintly visible behind */}
      <Pressable style={styles.scrim} focusable={false} onPress={onClose} />
      {/* the action box, sized + placed exactly over the focused tile */}
      <View style={{ position: 'absolute', top: rect.y, left: rect.x, width: rect.w, height: rect.h, borderRadius: m.s(16), overflow: 'hidden' }}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(5,7,11,0.9)' }]} />
        <FocusTrap style={{ flex: 1, justifyContent: 'center', gap: m.s(10), paddingHorizontal: m.s(16) }}>
          <MenuActionButton
            label={inLibrary ? 'Remove from library' : 'Add to library'}
            icon={inLibrary ? 'bookmark' : 'bookmark-outline'}
            autoFocus
            onPress={() => onToggleLibrary(item)}
          />
          {isCw ? (
            <MenuActionButton label="Remove progress" icon="trash-outline" danger onPress={() => onRemoveProgress(item)} />
          ) : null}
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
