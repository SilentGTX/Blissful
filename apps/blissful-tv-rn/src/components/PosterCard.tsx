import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { normalizeStremioImage, type StremioMetaPreview } from '@blissful/core';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';

function ratingText(r?: string | number): string | null {
  if (r == null) return null;
  const n = typeof r === 'number' ? r : parseFloat(r);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(1);
}

export const POSTER_RATIO = 1.464; // --poster-shape-ratio: 1/1.464

export function PosterCard({
  item,
  width,
  autoFocus,
  onSelect,
}: {
  item: StremioMetaPreview;
  width: number;
  autoFocus?: boolean;
  onSelect: (item: StremioMetaPreview) => void;
}) {
  const m = useMetrics();
  const [focused, setFocused] = useState(false);
  const poster = normalizeStremioImage(item.poster);
  const rating = ratingText(item.imdbRating);
  const h = width * POSTER_RATIO;

  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(item)}
      style={{ width }}
    >
      <View
        style={[
          styles.posterWrap,
          { width, height: h, borderRadius: m.s(16), borderWidth: m.s(3) },
          focused && { borderColor: colors.accent, transform: [{ scale: 1.06 }] },
        ]}
      >
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
        ) : (
          <View style={[styles.poster, styles.posterEmpty]}>
            <Text style={{ fontFamily: font.body, color: colors.textDim, fontSize: m.s(22), textAlign: 'center' }} numberOfLines={3}>
              {item.name}
            </Text>
          </View>
        )}
        {rating ? (
          <View style={[styles.imdb, { left: m.s(12), top: m.s(12), borderRadius: radius.pill, paddingLeft: m.s(10), paddingRight: m.s(8), paddingVertical: m.s(3), gap: m.s(4) }]}>
            <Text style={{ fontFamily: font.bodySemi, color: colors.text, fontSize: m.s(22) }}>{rating}</Text>
            <Text style={{ fontFamily: font.bodySemi, color: colors.imdbGold, fontSize: m.s(15), letterSpacing: 0.5 }}>IMDb</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={{ fontFamily: font.bodyMed, color: focused ? colors.accent : colors.textDim, fontSize: m.cardTitle, marginTop: m.s(17), textAlign: 'center' }}
        numberOfLines={2}
      >
        {item.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  posterWrap: { borderColor: 'transparent', overflow: 'hidden' },
  poster: { width: '100%', height: '100%', backgroundColor: colors.surface },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  imdb: { position: 'absolute', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
});
