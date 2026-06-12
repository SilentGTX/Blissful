import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { proxiedImage } from '../../lib/images';
import { useMetrics } from '../../theme/metrics';

// The title's LANDSCAPE logo, centred on black, pulsing opacity 0.2→1→0.2 over
// 2s (max ~240px) — exactly the old .bliss-buffering veil. ONLY the logo is ever
// shown: nothing while it loads, nothing if there's no logo (just black). No
// "Buffering" circle.
export function BufferingVeil({ visible, logo, black }: { visible: boolean; logo?: string | null; black?: boolean }) {
  const m = useMetrics();
  const pulse = useRef(new Animated.Value(0.2)).current;
  // Only reveal the logo once it loads AND is landscape (a real wordmark, not a
  // vertical poster) — mirrors the old BufferingOverlay's naturalWidth>=height gate.
  const [landscape, setLandscape] = useState(false);
  const src = proxiedImage(logo);

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.2, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  if (!visible) return null;
  const showLogo = Boolean(src) && landscape;
  const max = m.s(240);

  return (
    <View style={[styles.veil, black ? styles.black : null]} pointerEvents="none">
      {src ? (
        <Animated.View style={{ opacity: showLogo ? pulse : 0 }}>
          <Image
            source={{ uri: src }}
            style={{ width: max, height: max }}
            contentFit="contain"
            cachePolicy="memory-disk"
            onLoad={(e) => {
              const { width, height } = e.source ?? { width: 0, height: 0 };
              setLandscape(width >= height && width > 0);
            }}
            onError={() => setLandscape(false)}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  veil: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  black: { backgroundColor: '#000', zIndex: 300 },
});
