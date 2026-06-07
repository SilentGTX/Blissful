import { memo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { PosterCard, type CardItem } from './PosterCard';

// A rail driven by a ready array of items (e.g. Continue Watching), each
// optionally carrying a `progress` (0..100) shown as the bottom bar.
export const ItemsRail = memo(function ItemsRail({
  title,
  items,
  autoFocusFirst,
  onSelect,
}: {
  title: string;
  items: (CardItem & { progress?: number })[];
  autoFocusFirst?: boolean;
  onSelect: (item: CardItem) => void;
}) {
  const m = useMetrics();
  const posterW = m.s(200);
  const stride = posterW + m.s(24);
  if (items.length === 0) return null;
  return (
    <View style={{ marginBottom: m.s(34) }}>
      <Text style={{ fontFamily: font.bodySemi, color: colors.text, fontSize: m.railTitle, marginBottom: m.s(14), marginLeft: m.s(12) }}>
        {title}
      </Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(it) => it.id}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, index) => ({ length: stride, offset: stride * index, index })}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={5}
        // paddingLeft gives the focused first card's 1.06 scale room so it isn't
        // clipped on the left; the title's marginLeft matches so they stay aligned.
        contentContainerStyle={{ gap: m.s(24), paddingTop: m.s(20), paddingBottom: m.s(12), paddingLeft: m.s(12), paddingRight: m.safeX }}
        renderItem={({ item, index }) => (
          <PosterCard
            item={item}
            width={posterW}
            progress={item.progress}
            autoFocus={autoFocusFirst && index === 0}
            atRowStart={index === 0}
            onSelect={onSelect}
          />
        )}
      />
    </View>
  );
});

const styles = StyleSheet.create({});
