import { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { colors, font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';

type M = ReturnType<typeof useMetrics>;

// Floating "Skip Intro / Recap / Credits" pill, bottom-right above the controls.
// VISUAL ONLY — it is NOT natively focusable: the player's virtual-index D-pad
// model owns focus, and a real focusable button would double-fire with the
// global useTVEventHandler. Instead, while this is showing and the player is in
// the "watching" state (row === 'none'), pressing OK seeks past the segment
// (see PlayerScreen's `select` handler). The accent ring + "OK" chip signal
// that. It stays up for the whole segment, independent of the auto-hiding
// controls bar (like Netflix), and fades in on mount.
export function SkipButton({ m, label }: { m: M; label: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [anim]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        right: m.s(48),
        bottom: m.s(108),
        zIndex: 16,
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [m.s(12), 0] }) }],
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: m.s(10),
          borderRadius: 999,
          borderWidth: m.s(2),
          borderColor: colors.accent,
          backgroundColor: 'rgba(0,0,0,0.72)',
          paddingLeft: m.s(10),
          paddingRight: m.s(20),
          paddingVertical: m.s(9),
        }}
      >
        <View style={{ borderRadius: 999, backgroundColor: colors.accent, paddingHorizontal: m.s(10), paddingVertical: m.s(3) }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(13), color: colors.accentInk }}>OK</Text>
        </View>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: '#fff' }}>{label}</Text>
      </View>
    </Animated.View>
  );
}
