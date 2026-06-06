import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';

type NavKey = 'Home' | 'Discover' | 'Library' | 'Addons' | 'JoinParty' | 'Settings';

const ITEMS: { key: NavKey; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'Home', icon: 'home' },
  { key: 'Discover', icon: 'compass' },
  { key: 'Library', icon: 'bookmark' },
  { key: 'Addons', icon: 'extension-puzzle' },
  { key: 'JoinParty', icon: 'people' },
  { key: 'Settings', icon: 'settings-sharp' },
];

function NavIcon({
  icon,
  size,
  itemH,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  size: number;
  itemH: number;
  active: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const color = active ? colors.accent : focused ? colors.text : colors.textGhost;
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        height: itemH,
        width: itemH,
        borderRadius: radius.card,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: focused ? colors.accent : 'transparent',
        backgroundColor: focused ? colors.surface10 : 'transparent',
      }}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function NavRail({ active = 'Home' as NavKey }: { active?: NavKey }) {
  const navigation = useNavigation<any>();
  const m = useMetrics();
  const pad = m.s(11); // clamp(8px,0.7vw,14px)

  return (
    <View
      style={[
        styles.rail,
        { left: pad, top: m.safeY, bottom: m.safeY, width: m.railCollapsed - pad * 2, borderRadius: m.s(28) },
      ]}
    >
      {/* faked glass: white sheen over the near-opaque glass base */}
      <LinearGradient
        colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ height: m.safeY }} />
      <Image
        source={require('../../assets/blissful-small-logo.png')}
        style={{ width: m.s(58), height: m.s(58), borderRadius: m.s(14) }}
        resizeMode="contain"
      />
      <View style={{ gap: m.s(6), alignItems: 'center', marginTop: m.s(18) }}>
        {ITEMS.map((it) => (
          <NavIcon
            key={it.key}
            icon={it.icon}
            size={m.navIcon}
            itemH={m.navItemH}
            active={active === it.key}
            onPress={() => {
              if (it.key === 'Home') navigation.navigate('Home');
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    backgroundColor: 'rgba(28,33,46,0.97)',
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    overflow: 'hidden',
  },
  logo: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
