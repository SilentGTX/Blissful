/**
 * PosterArt — placeholder gradient artwork seeded from item hue.
 * Replace the whole body with <Image source={{uri:item.img}} style={StyleSheet.absoluteFill} resizeMode="cover" />
 * once you have real artwork.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect } from 'react-native-svg';
import { artStops } from './theme';

export default function PosterArt({ item, radius = 16 }) {
  const s = artStops(item, true);
  const initial = item.title.replace(/^(The|A) /, '')[0];
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden', backgroundColor: s.base }]}>
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={s.c1} />
            <Stop offset="1" stopColor={s.c2} />
          </LinearGradient>
          <RadialGradient id="rg" cx="0.78" cy="0.16" r="0.7">
            <Stop offset="0" stopColor={s.a} />
            <Stop offset="0.58" stopColor={s.a} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#lg)" />
        <Rect width="100%" height="100%" fill="url(#rg)" />
        {/* bottom legibility scrim */}
        <Rect x="0" y="55%" width="100%" height="45%" fill="#05070b" opacity="0.55" />
      </Svg>
      <Text style={styles.ghost}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ghost: {
    position: 'absolute', top: '4%', right: '5%',
    fontFamily: 'Spectral-Bold', fontSize: 170, lineHeight: 180,
    color: 'rgba(255,255,255,0.08)',
  },
});
