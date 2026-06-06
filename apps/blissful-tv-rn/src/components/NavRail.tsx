import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { ICONS, StrokeIcon } from '../icons/StrokeIcon';

type NavKey = 'Home' | 'Discover' | 'Library' | 'Addons' | 'JoinParty' | 'Settings';

const ITEMS: { key: NavKey; icon: keyof typeof ICONS; label: string }[] = [
  { key: 'Home', icon: 'home', label: 'Home' },
  { key: 'Discover', icon: 'discover', label: 'Discover' },
  { key: 'Library', icon: 'library', label: 'Library' },
  { key: 'Addons', icon: 'addons', label: 'Addons' },
  { key: 'JoinParty', icon: 'watchParty', label: 'Join Party' },
  { key: 'Settings', icon: 'settings', label: 'Settings' },
];

function NavRow({
  icon,
  label,
  size,
  itemH,
  expanded,
  active,
  badge,
  onRailFocus,
  onPress,
}: {
  icon: keyof typeof ICONS;
  label: string;
  size: number;
  itemH: number;
  expanded: boolean;
  active?: boolean;
  badge?: number;
  onRailFocus: (d: number) => void;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const color = active ? colors.accent : focused ? colors.text : colors.textGhost;
  return (
    <Pressable
      onFocus={() => {
        setFocused(true);
        onRailFocus(1);
      }}
      onBlur={() => {
        setFocused(false);
        onRailFocus(-1);
      }}
      onPress={onPress}
      style={{
        height: itemH,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: expanded ? 'flex-start' : 'center',
        paddingLeft: expanded ? size * 0.85 : 0,
        gap: expanded ? size * 0.75 : 0,
        borderRadius: radius.card,
        borderWidth: 2,
        borderColor: focused ? colors.accent : 'transparent',
        backgroundColor: focused ? colors.surface10 : 'transparent',
      }}
    >
      <View>
        <StrokeIcon path={ICONS[icon]} size={size} color={color} />
        {badge ? (
          <View style={{ position: 'absolute', top: -size * 0.3, right: -size * 0.35, minWidth: size * 0.7, height: size * 0.7, borderRadius: 999, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: font.bodySemi, fontSize: size * 0.5, color: colors.accentInk }}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {expanded ? (
        <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: size * 0.78, color }}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function NavRail({ active = 'Home' as NavKey }: { active?: NavKey }) {
  const navigation = useNavigation<any>();
  const m = useMetrics();
  const pad = m.s(6);
  const collapsedW = m.railCollapsed - pad * 2;
  const expandedW = m.railExpanded;

  const [expanded, setExpanded] = useState(false);
  const countRef = useRef(0);
  const widthAnim = useRef(new Animated.Value(collapsedW)).current;

  const onRailFocus = (delta: number) => {
    countRef.current += delta;
    if (countRef.current > 0) setExpanded(true);
    else setTimeout(() => countRef.current <= 0 && setExpanded(false), 60);
  };

  useEffect(() => {
    Animated.timing(widthAnim, { toValue: expanded ? expandedW : collapsedW, duration: 200, useNativeDriver: false }).start();
  }, [expanded, expandedW, collapsedW, widthAnim]);

  return (
    <Animated.View
      style={[styles.rail, { left: pad, top: m.safeY, bottom: m.safeY, width: widthAnim, borderRadius: m.s(28), zIndex: expanded ? 70 : 10 }]}
    >
      <LinearGradient
        colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ height: m.s(16) }} />
      <Image
        source={require('../../assets/blissful-small-logo.png')}
        style={{ width: m.s(46), height: m.s(46), borderRadius: m.s(12) }}
        resizeMode="contain"
      />
      <View style={{ gap: m.s(16), width: '100%', paddingHorizontal: pad + m.s(2), marginTop: m.s(26) }}>
        {ITEMS.map((it) => (
          <NavRow
            key={it.key}
            icon={it.icon}
            label={it.label}
            size={m.navIcon}
            itemH={m.navItemH}
            expanded={expanded}
            active={active === it.key}
            onRailFocus={onRailFocus}
            onPress={() => {
              if (it.key === 'Home') navigation.navigate('Home');
            }}
          />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <View style={{ width: '100%', paddingHorizontal: pad + m.s(2), marginBottom: m.s(6) }}>
        <NavRow
          icon="watchParty"
          label="Friends"
          size={m.navIcon}
          itemH={m.navItemH}
          expanded={expanded}
          badge={1}
          onRailFocus={onRailFocus}
          onPress={() => {}}
        />
      </View>
    </Animated.View>
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
