import { memo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTvFocusable } from '../../lib/useTvFocusable';
import { colors, font, radius } from '../../theme/colors';
import type { useMetrics } from '../../theme/metrics';
import { PosterCard, POSTER_W, type CardRect } from '../PosterCard';
import type { HomeItem } from './homeData';

type M = ReturnType<typeof useMetrics>;

function SeeAll({ m, onPress }: { m: M; onPress: () => void }) {
  const { focused, focusProps } = useTvFocusable({ onPress });
  return (
    <Pressable
      {...focusProps}
      style={{ height: m.s(40), paddingHorizontal: m.s(20), borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.14)', backgroundColor: focused ? colors.accent : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(19), includeFontPadding: false, textAlignVertical: 'center', color: focused ? colors.accentInk : 'rgba(255,255,255,0.82)' }}>See all</Text>
    </Pressable>
  );
}

// A titled horizontal rail of landscape tiles (design Row.jsx `Row`). The rows band
// in HomeScreen stacks these and focus-scrolls so the active row sits at the top.
export const LandscapeRail = memo(function LandscapeRail({
  title,
  items,
  rowIndex,
  m,
  firstFocus,
  upTag,
  activeActionId,
  onFocusItem,
  onBlurItem,
  onPress,
  onActiveRect,
  onSeeAll,
}: {
  title: string;
  items: HomeItem[];
  rowIndex: number;
  m: M;
  firstFocus?: boolean;
  /** nextFocusUp for this row's tiles (top row routes Up to the avatar). */
  upTag?: number;
  /** The id of the tile currently showing its hold-OK action overlay (if any). */
  activeActionId?: string;
  onFocusItem: (it: HomeItem, rowIndex: number) => void;
  onBlurItem: () => void;
  onPress: (it: HomeItem) => void;
  onActiveRect: (r: CardRect) => void;
  onSeeAll?: () => void;
}) {
  return (
    <View style={{ marginBottom: m.s(51) }}>
      <View style={{ height: m.s(40), marginBottom: m.s(18), paddingRight: m.s(40), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: font.spectralSemi, fontSize: m.s(30), color: '#fff', paddingLeft: m.s(20) }}>{title}</Text>
        {onSeeAll ? <SeeAll m={m} onPress={onSeeAll} /> : null}
      </View>
      <View>
        <FlatList
          horizontal
          data={items}
          keyExtractor={(it) => it.id}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews={false}
          // paddingVertical (14) leaves room for the 1.075 focus scale top/bottom
          // (counted into ROW_STEP=380); paddingLeft (20) keeps the first tile's scaled
          // left edge off the FlatList/band clip edge AND aligns tiles at 150.
          contentContainerStyle={{ gap: m.s(30), paddingTop: m.s(14), paddingBottom: m.s(14), paddingLeft: m.s(20), paddingRight: m.safeX }}
          renderItem={({ item, index }) => (
            <PosterCard
              item={item}
              variant="landscape"
              hideRating
              width={m.s(POSTER_W.land)}
              autoFocus={firstFocus && index === 0}
              atRowStart={index === 0}
              nextFocusUp={upTag}
              active={item.id === activeActionId}
              onFocus={() => onFocusItem(item, rowIndex)}
              onBlur={onBlurItem}
              onSelect={() => onPress(item)}
              onActiveRect={onActiveRect}
            />
          )}
        />
        {/* Right-edge fade — a RADIAL vignette centred on the right-middle so the
            shadow blends out on the LEFT and feathers at the TOP and BOTTOM (a flat
            horizontal gradient left hard top/bottom edges). Semi-transparent so it's
            a gentle vignette over the full-bleed backdrop, not a hard dark band. */}
        <View style={[styles.rightFade, { width: m.s(120) }]} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="railFade" cx="100%" cy="50%" rx="100%" ry="58%">
                <Stop offset="0" stopColor="#080a0e" stopOpacity="0.62" />
                <Stop offset="0.6" stopColor="#080a0e" stopOpacity="0.32" />
                <Stop offset="1" stopColor="#080a0e" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#railFade)" />
          </Svg>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  rightFade: { position: 'absolute', top: 0, bottom: 0, right: 0 },
});
