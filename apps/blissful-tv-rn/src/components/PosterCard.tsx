import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { normalizeStremioImage, type StremioMetaPreview } from '@blissful/core';
import { colors, layout } from '../theme/colors';

export function PosterCard({
  item,
  autoFocus,
  onSelect,
}: {
  item: StremioMetaPreview;
  autoFocus?: boolean;
  onSelect: (item: StremioMetaPreview) => void;
}) {
  const [focused, setFocused] = useState(false);
  const poster = normalizeStremioImage(item.poster);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(item)}
      style={styles.card}
    >
      <View style={[styles.posterWrap, focused && styles.posterWrapFocused]}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
        ) : (
          <View style={[styles.poster, styles.posterEmpty]}>
            <Text style={styles.posterEmptyText} numberOfLines={3}>
              {item.name}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.cardTitle, focused && styles.cardTitleFocused]} numberOfLines={1}>
        {item.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: layout.posterW },
  posterWrap: {
    width: layout.posterW,
    height: layout.posterH,
    borderRadius: layout.radius,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  posterWrapFocused: { borderColor: colors.accent, transform: [{ scale: 1.06 }] },
  poster: { width: '100%', height: '100%', backgroundColor: colors.surface },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  posterEmptyText: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  cardTitle: { color: colors.textDim, fontSize: 14, marginTop: 8 },
  cardTitleFocused: { color: colors.text },
});
