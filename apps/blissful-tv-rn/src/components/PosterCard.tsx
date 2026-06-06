import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { normalizeStremioImage, type StremioMetaPreview } from '@blissful/core';
import { colors, font, layout, radius } from '../theme/colors';

function ratingText(r?: string | number): string | null {
  if (r == null) return null;
  const n = typeof r === 'number' ? r : parseFloat(r);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(1);
}

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
  const rating = ratingText(item.imdbRating);
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
        {rating ? (
          <View style={styles.imdb}>
            <Text style={styles.imdbValue}>{rating}</Text>
            <Text style={styles.imdbTag}>IMDb</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.cardTitle, focused && styles.cardTitleFocused]} numberOfLines={2}>
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
    borderRadius: radius.card,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  posterWrapFocused: { borderColor: colors.accent, transform: [{ scale: 1.06 }] },
  poster: { width: '100%', height: '100%', backgroundColor: colors.surface },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  posterEmptyText: { fontFamily: font.body, color: colors.textDim, fontSize: 13, textAlign: 'center' },
  imdb: {
    position: 'absolute',
    left: 10,
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    paddingLeft: 9,
    paddingRight: 8,
    paddingVertical: 3,
  },
  imdbValue: { fontFamily: font.bodySemi, color: colors.text, fontSize: 12 },
  imdbTag: { fontFamily: font.bodySemi, color: colors.imdbGold, fontSize: 9, letterSpacing: 0.5 },
  cardTitle: { fontFamily: font.bodyMed, color: colors.textDim, fontSize: 14, marginTop: 10, textAlign: 'center' },
  cardTitleFocused: { color: colors.accent },
});
