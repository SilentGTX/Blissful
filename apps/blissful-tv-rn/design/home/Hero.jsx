/**
 * Backdrop — full-bleed art of the focused item + legibility scrims.
 * InfoPanel — large featured metadata for the focused item.
 * Both are driven by the `item` lifted up from the focused Tile.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect } from 'react-native-svg';
import { Icon } from './Icon';
import { colors, artStops } from './theme';

export function Backdrop({ item }) {
  const s = artStops(item, true);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: s.base }]}>
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={s.c1} />
            <Stop offset="1" stopColor={s.c2} />
          </LinearGradient>
          <RadialGradient id="glow" cx="0.86" cy="0.18" r="0.7">
            <Stop offset="0" stopColor={s.a} />
            <Stop offset="0.6" stopColor={s.a} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#bg)" />
        <Rect width="100%" height="100%" fill="url(#glow)" />
      </Svg>
      {/* left + bottom scrims for text legibility */}
      <View style={[StyleSheet.absoluteFill, styles.scrimLeft]} />
      <View style={[StyleSheet.absoluteFill, styles.scrimBottom]} />
    </View>
  );
}

function CTA({ label, icon, accent, primary }) {
  return (
    <Pressable focusable onPress={() => {}}
      style={({ focused }) => [
        styles.cta,
        primary ? { backgroundColor: accent } : styles.ctaGlass,
        focused && (primary
          ? { transform: [{ scale: 1.04 }] }
          : { borderColor: accent, transform: [{ scale: 1.04 }] }),
      ]}>
      <Icon name={icon} size={primary ? 22 : 20} color={primary ? colors.ink : '#fff'} />
      <Text style={[styles.ctaText, { color: primary ? colors.ink : '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function InfoPanel({ item, accent }) {
  return (
    <View style={styles.panel} pointerEvents="box-none">
      <Text style={[styles.kicker, { color: accent }]}>
        {item.kind === 'Series' ? 'SERIES' : 'FEATURED FILM'}
      </Text>
      <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
      <View style={styles.meta}>
        <View style={styles.ratingBig}>
          <Text style={styles.ratingBigNum}>{item.rating}</Text>
          <Text style={styles.imdbBig}>IMDb</Text>
        </View>
        <Text style={styles.metaText}>{item.year}</Text>
        <Text style={styles.dot}>•</Text>
        <Text style={styles.metaText}>{item.runtime}</Text>
        <Text style={styles.dot}>•</Text>
        <Text style={styles.metaText}>{item.genres.join(' · ')}</Text>
      </View>
      <Text numberOfLines={2} style={styles.blurb}>{item.blurb}</Text>
      <View style={styles.ctaRow}>
        <CTA label={item.progress != null ? 'Resume' : 'Play'} icon="play" accent={accent} primary />
        <CTA label="Watchlist" icon="plus" accent={accent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrimLeft: { backgroundColor: 'transparent' }, // see note in README: use expo-linear-gradient for true scrims
  scrimBottom: { backgroundColor: 'transparent' },

  panel: { position: 'absolute', left: 150, top: 120, width: 1000 },
  kicker: { fontSize: 17, fontWeight: '800', letterSpacing: 3.5, marginBottom: 18 },
  title: { fontFamily: 'Spectral-Bold', fontSize: 80, lineHeight: 80, color: '#fff', marginBottom: 22, maxWidth: 920 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 24 },
  metaText: { color: 'rgba(255,255,255,0.85)', fontSize: 24, fontWeight: '500' },
  dot: { color: 'rgba(255,255,255,0.4)', fontSize: 24 },
  ratingBig: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 36, paddingLeft: 12, paddingRight: 9,
    borderRadius: 9, backgroundColor: 'rgba(8,10,15,0.7)' },
  ratingBigNum: { color: '#fff', fontSize: 19, fontWeight: '700' },
  imdbBig: { fontSize: 12, fontWeight: '900', color: '#0b0b0d', backgroundColor: colors.imdb, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 3, overflow: 'hidden' },
  blurb: { color: 'rgba(255,255,255,0.78)', fontSize: 27, lineHeight: 40, maxWidth: 820, marginBottom: 30 },
  ctaRow: { flexDirection: 'row', gap: 16 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 11, height: 56, paddingHorizontal: 26, borderRadius: 999 },
  ctaGlass: { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.16)' },
  ctaText: { fontSize: 21, fontWeight: '700' },
});
