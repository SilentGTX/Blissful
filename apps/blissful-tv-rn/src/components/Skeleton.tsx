import { useEffect } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const POSTER_RATIO = 1.464; // matches PosterCard.POSTER_RATIO (kept local to avoid a circular import)

// HeroUI-style skeleton shimmer. Cheap on a low-end TV: ONE module-level Animated
// value + ONE loop drives every skeleton's sweep (the transform runs on the native
// driver), so a whole grid of placeholders is a single JS animation, not N.
const sweep = new Animated.Value(0);
let started = false;
function ensureSweep() {
  if (started) return;
  started = true;
  Animated.loop(
    Animated.timing(sweep, { toValue: 1, duration: 1150, easing: Easing.linear, useNativeDriver: true }),
  ).start();
}

export function Skeleton({ width, height, br, style }: { width: number; height: number; br?: number; style?: ViewStyle }) {
  useEffect(ensureSweep, []);
  return (
    <View style={[{ width, height, borderRadius: br ?? 8, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }, style]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-width, width] }) }] },
        ]}
      >
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.09)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

// A poster-shaped skeleton (image block + title line) for loading rails/grids —
// the "posters load empty with the skeleton animation" look.
export function PosterSkeleton({ width, m }: { width: number; m: { s: (n: number) => number } }) {
  return (
    <View style={{ width }}>
      <Skeleton width={width} height={width * POSTER_RATIO} br={m.s(16)} />
      <Skeleton width={width * 0.7} height={m.s(16)} br={m.s(6)} style={{ marginTop: m.s(15), alignSelf: 'center' }} />
    </View>
  );
}

// A full loading grid of poster skeletons (drop-in for an ActivityIndicator on
// the grid screens). `unused` kept tiny on purpose.
export function PosterGridSkeleton({
  width,
  cols,
  gap,
  rows = 2,
  m,
}: {
  width: number;
  cols: number;
  gap: number;
  rows?: number;
  m: { s: (n: number) => number };
}) {
  const cells = Array.from({ length: cols * rows });
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {cells.map((_, i) => (
        <PosterSkeleton key={i} width={width} m={m} />
      ))}
    </View>
  );
}
