import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme/colors';

// Initials-on-tinted-circle with an optional online dot (port of FriendAvatar).
export function FriendAvatar({ name, size, online }: { name: string; size: number; online?: boolean }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: 999 }]}>
      <Text style={{ fontFamily: font.bodySemi, fontSize: size * 0.42, color: colors.text }}>{initial}</Text>
      {online ? (
        <View
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: size * 0.3,
            height: size * 0.3,
            borderRadius: 999,
            backgroundColor: '#3ad07a',
            borderWidth: size * 0.05,
            borderColor: '#1a1f2b',
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
});
