import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { ICONS, StrokeIcon } from '../icons/StrokeIcon';

type NavKey = 'Home' | 'Discover' | 'Library' | 'Addons' | 'JoinParty' | 'Settings';

const ITEMS: { key: NavKey; icon: keyof typeof ICONS }[] = [
  { key: 'Home', icon: 'home' },
  { key: 'Discover', icon: 'discover' },
  { key: 'Library', icon: 'library' },
  { key: 'Addons', icon: 'addons' },
  { key: 'JoinParty', icon: 'watchParty' },
  { key: 'Settings', icon: 'settings' },
];

function NavIcon({
  icon,
  size,
  itemH,
  active,
  onPress,
}: {
  icon: keyof typeof ICONS;
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
      }}
    >
      <StrokeIcon path={ICONS[icon]} size={size} color={color} />
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
      <LinearGradient
        colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ height: m.s(18) }} />
      <Image
        source={require('../../assets/blissful-small-logo.png')}
        style={{ width: m.s(54), height: m.s(54), borderRadius: m.s(14) }}
        resizeMode="contain"
      />
      <View style={{ gap: m.s(18), alignItems: 'center', marginTop: m.s(26) }}>
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

      <View style={{ flex: 1 }} />

      {/* Friends section (TvFriendsRail) — collapsed: a people icon + badge. */}
      <Pressable style={{ height: m.navItemH, width: m.navItemH, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', marginBottom: m.s(6) }}>
        <StrokeIcon path={ICONS.watchParty} size={m.navIcon} color={colors.accent} />
        <View style={{ position: 'absolute', top: m.s(6), right: m.s(8), minWidth: m.s(16), height: m.s(16), borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: m.s(3) }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(11), color: colors.accentInk }}>1</Text>
        </View>
      </Pressable>
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
});
