import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useAuth } from '../context/AuthContext';

// Liquid-glass recipe from the TV top bar (.tv-topbar-search / -profile).
const GLASS = ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.05)'] as const;

export function TopBar() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [searchFocused, setSearchFocused] = useState(false);
  const [avatarFocused, setAvatarFocused] = useState(false);

  const initial = (user?.displayName || user?.username || '?').trim().charAt(0).toUpperCase();

  return (
    <View style={styles.bar}>
      <Pressable
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        onPress={() => { /* search screen — next */ }}
        style={styles.searchPress}
      >
        <LinearGradient
          colors={GLASS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.searchPill, searchFocused && styles.glassFocused]}
        >
          <Ionicons name="search" size={22} color={colors.textFaint} />
          <Text style={styles.placeholder}>Search movies, series, actors...</Text>
        </LinearGradient>
      </Pressable>

      <Pressable
        onFocus={() => setAvatarFocused(true)}
        onBlur={() => setAvatarFocused(false)}
        onPress={() => navigation.navigate('Login')}
        style={styles.avatarPress}
      >
        <LinearGradient
          colors={GLASS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.avatar, avatarFocused && styles.glassFocused]}
        >
          {user ? (
            <Text style={styles.avatarInitial}>{initial}</Text>
          ) : (
            <Ionicons name="person" size={24} color={colors.text} />
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const BAR_H = 64;

const styles = StyleSheet.create({
  bar: {
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPress: { width: 620, maxWidth: '70%', height: '100%' },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.surface18,
  },
  placeholder: { fontFamily: font.body, fontSize: 17, color: colors.textGhost },
  avatarPress: { position: 'absolute', right: 0, height: '100%', aspectRatio: 1 },
  avatar: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surface18,
  },
  avatarInitial: { fontFamily: font.serif, fontSize: 22, color: colors.text },
  glassFocused: { borderColor: colors.accent, borderWidth: 3 },
});
