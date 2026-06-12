/**
 * Tile + Row — landscape cards in a horizontal rail.
 *
 * TV FOCUS: each Tile is a <Pressable>. On real TV, the OS moves focus with the
 * D-pad automatically between focusable Pressables; we hook onFocus/onBlur to drive
 * the scale-up, the white ring, and to lift the focused item's metadata up to the
 * screen (via onFocusItem) so the full-bleed hero + info panel can react.
 */
import React, { useRef } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import PosterArt from './PosterArt';
import { colors, layout, rgba } from './theme';

function Rating({ value }) {
  return (
    <View style={styles.rating}>
      <Text style={styles.ratingNum}>{value}</Text>
      <Text style={styles.imdb}>IMDb</Text>
    </View>
  );
}

export function Tile({ item, rowIndex, colIndex, accent, onFocusItem, hasTVPreferredFocus }) {
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;

  const animate = (to) => {
    Animated.parallel([
      Animated.spring(scale, { toValue: to ? 1.075 : 1, useNativeDriver: true, speed: 18, bounciness: 6 }),
      Animated.timing(ring, { toValue: to ? 1 : 0, duration: 140, useNativeDriver: true }),
    ]).start();
  };

  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      focusable
      onFocus={() => { animate(true); onFocusItem && onFocusItem(item, rowIndex, colIndex); }}
      onBlur={() => animate(false)}
      onPress={() => {/* navigate to detail / play */}}
      style={styles.tileWrap}
    >
      <Animated.View style={[styles.tile, { transform: [{ scale }] }]}>
        <PosterArt item={item} />
        {/* white focus ring (animated opacity) */}
        <Animated.View pointerEvents="none" style={[styles.ring, { opacity: ring }]} />
        <View style={styles.tileTop}>
          <Rating value={item.rating} />
          <Text style={styles.kind}>{item.kind.toUpperCase()}</Text>
        </View>
        <View style={styles.tileBottom}>
          <Text numberOfLines={2} style={styles.tileTitle}>{item.title}</Text>
        </View>
        {item.progress != null && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${item.progress * 100}%`, backgroundColor: accent }]} />
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

export function Row({ row, rowIndex, accent, onFocusItem, firstFocus }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{row.title}</Text>
        <Pressable focusable onPress={() => {}} style={({ focused }) => [styles.seeAll, focused && { backgroundColor: accent }]}>
          {({ focused }) => (
            <Text style={[styles.seeAllText, focused && { color: colors.ink }]}>See all  ›</Text>
          )}
        </Pressable>
      </View>
      {/* Use a horizontal FlatList in production for long catalogs */}
      <View style={styles.rail}>
        {row.items.map((it, ci) => (
          <Tile
            key={it.title}
            item={it}
            rowIndex={rowIndex}
            colIndex={ci}
            accent={accent}
            onFocusItem={onFocusItem}
            hasTVPreferredFocus={firstFocus && rowIndex === 0 && ci === 0}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 51 },
  rowHeader: { width: 1560, height: 40, marginBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { fontFamily: 'Spectral-SemiBold', fontSize: 30, color: '#fff', paddingLeft: 4 },
  seeAll: { height: 40, paddingHorizontal: 18, borderRadius: 999, justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.14)' },
  seeAllText: { fontSize: 19, fontWeight: '600', color: 'rgba(255,255,255,0.82)' },
  rail: { flexDirection: 'row', gap: layout.tileGap },

  tileWrap: { width: layout.tileW, height: layout.tileH },
  tile: { flex: 1, borderRadius: 16, overflow: 'visible' },
  ring: { ...StyleSheet.absoluteFillObject, borderRadius: 16, borderWidth: 3, borderColor: '#fff' },
  tileTop: { position: 'absolute', top: 14, left: 14, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.5, color: 'rgba(255,255,255,0.75)' },
  tileBottom: { position: 'absolute', left: 18, right: 18, bottom: 18 },
  tileTitle: { fontFamily: 'Spectral-SemiBold', fontSize: 25, lineHeight: 27, color: '#fff' },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, backgroundColor: 'rgba(255,255,255,0.18)' },
  progressFill: { height: '100%' },

  rating: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingLeft: 9, paddingRight: 7,
    borderRadius: 7, backgroundColor: 'rgba(8,10,15,0.7)' },
  ratingNum: { color: '#fff', fontSize: 14, fontWeight: '700' },
  imdb: { fontSize: 9.5, fontWeight: '900', color: '#0b0b0d', backgroundColor: colors.imdb, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, overflow: 'hidden' },
});
