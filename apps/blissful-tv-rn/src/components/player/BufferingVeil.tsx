import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { proxiedImage } from '../../lib/images';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';

// 1:1 of the old .bliss-buffering veil: the title's LANDSCAPE logo, centred on
// black, pulsing opacity 0.2→1→0.2 over 2s (max ~240px). When there's no
// landscape logo, the old app's no-logo state is a 120px "Buffering" circle.
export function BufferingVeil({ visible, logo }: { visible: boolean; logo?: string | null }) {
  const m = useMetrics();
  const pulse = useRef(new Animated.Value(0.2)).current;
  // Only reveal the logo once it loads AND is landscape (a real wordmark, not a
  // vertical poster) — mirrors BufferingOverlay's naturalWidth>=naturalHeight gate.
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
    <View style={styles.veil} pointerEvents="none">
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
          />
        </Animated.View>
      ) : null}
      {!showLogo ? (
        <Animated.View style={[styles.fallback, { width: m.s(120), height: m.s(120), borderRadius: 999, opacity: pulse }]}>
          <Text style={{ fontFamily: font.body, fontSize: m.s(20), color: 'rgba(255,255,255,0.7)' }}>Buffering</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  veil: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  fallback: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.4)' },
});
