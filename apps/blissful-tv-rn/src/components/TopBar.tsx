import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';

// .tv-topbar-search / -profile: two stacked gradients (cool-glass base + white sheen).
function Glass({ focused, style, children }: { focused: boolean; style?: any; children: React.ReactNode }) {
  return (
    <View style={style}>
      <LinearGradient
        colors={['rgba(124,144,176,0.10)', 'rgba(18,24,36,0.18)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.05)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

export function TopBar() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const m = useMetrics();
  const [searchFocused, setSearchFocused] = useState(false);
  const [avatarFocused, setAvatarFocused] = useState(false);

  const initial = (user?.displayName || user?.username || '?').trim().charAt(0).toUpperCase();
  const ring = (focused: boolean) => ({
    borderWidth: focused ? 3 : 1,
    borderColor: focused ? colors.accent : 'rgba(255,255,255,0.18)',
  });

  return (
    <View style={[styles.bar, { top: m.safeY, left: m.contentLeft, right: m.safeX, height: m.topbarH }]}>
      <Pressable
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        onPress={() => { /* search screen — next */ }}
        style={{ width: m.searchW, height: '100%' }}
      >
        <Glass
          focused={searchFocused}
          style={[
            styles.pill,
            { height: '100%', paddingHorizontal: m.s(26), gap: m.s(14), borderRadius: radius.pill },
            ring(searchFocused),
          ]}
        >
          <Ionicons name="search" size={m.s(26)} color="rgba(255,255,255,0.6)" />
          <Text style={{ fontFamily: font.body, fontSize: m.searchFont, color: 'rgba(255,255,255,0.45)' }}>
            Search movies, series, actors...
          </Text>
        </Glass>
      </Pressable>

      <Pressable
        onFocus={() => setAvatarFocused(true)}
        onBlur={() => setAvatarFocused(false)}
        onPress={() => navigation.navigate('Login')}
        style={[styles.avatarPress, { width: m.topbarH, height: m.topbarH }]}
      >
        <Glass
          focused={avatarFocused}
          style={[styles.avatar, { borderRadius: radius.pill }, ring(avatarFocused)]}
        >
          {user ? (
            <Text style={{ fontFamily: font.serif, fontSize: m.profileFont, color: colors.text }}>{initial}</Text>
          ) : (
            <Ionicons name="person" size={m.s(34)} color={colors.text} />
          )}
        </Glass>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', zIndex: 45 },
  pill: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  avatarPress: { position: 'absolute', right: 0 },
  avatar: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
