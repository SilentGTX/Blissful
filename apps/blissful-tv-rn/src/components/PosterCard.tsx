import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { normalizeStremioImage } from '@blissful/core';
import { markContentFocus } from '../lib/focusBus';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';

export type CardItem = {
  id: string;
  type: string;
  name: string;
  poster?: string | null;
  imdbRating?: string | number;
};

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
  progress,
  onSelect,
}: {
  item: CardItem;
  width: number;
  autoFocus?: boolean;
  progress?: number;
  onSelect: (item: CardItem) => void;
}) {
  const m = useMetrics();
  const [focused, setFocused] = useState(false);
  const poster = normalizeStremioImage(item.poster);
  const rating = ratingText(item.imdbRating);
  const h = width * POSTER_RATIO;

  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => { setFocused(true); markContentFocus(); }}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(item)}
      style={{ width }}
    >
      <View
        style={[
          styles.posterWrap,
          { width, height: h, borderRadius: m.s(16), borderWidth: 1 },
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
        {progress != null && progress > 0 ? (
          <View style={{ position: 'absolute', bottom: m.s(12), left: m.s(12), right: m.s(12), height: m.s(6), borderRadius: radius.pill, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' }}>
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.min(100, progress)}%`, backgroundColor: colors.accent }} />
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
