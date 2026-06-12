import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet } from 'react-native';

// Full-screen boot splash — the Blissful wordmark with a thin indeterminate
// loading line sweeping beneath it. Mirrors the old android / windows / web boot
// screen. Cheap on a low-end TV: a single transform-driven Animated loop (native
// driver) + one static image, no blur/gradient layers.
export function BootSplash({ done, onHidden }: { done: boolean; onHidden: () => void }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  useEffect(() => {
    if (!done) return;
    Animated.timing(opacity, { toValue: 0, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(
      ({ finished }) => { if (finished) onHidden(); },
    );
  }, [done, opacity, onHidden]);

  return (
    <Animated.View pointerEvents={done ? 'none' : 'auto'} style={[styles.root, { opacity }]}>
      <Image source={require('../../assets/blissful-logo.png')} style={styles.logo} resizeMode="contain" />
      <Animated.View style={styles.track}>
        <Animated.View
          style={[styles.spark, { transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-80, 240] }) }] }]}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    backgroundColor: '#0a0e16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: '54%', height: '40%' },
  track: {
    position: 'absolute',
    bottom: '24%',
    width: 240,
    height: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  spark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 80,
    borderRadius: 2,
    backgroundColor: 'rgba(170,195,255,0.9)',
  },
});
