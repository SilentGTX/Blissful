import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { ICONS, StrokeIcon } from '../icons/StrokeIcon';
import { useAuth } from '../context/AuthContext';
import { useFriends, statusLine } from '../lib/friends';
import { FriendAvatar } from './FriendAvatar';

type NavKey = 'Home' | 'Discover' | 'Library' | 'Addons' | 'JoinParty' | 'Settings';
const ITEMS: { key: NavKey; icon: keyof typeof ICONS; label: string }[] = [
  { key: 'Home', icon: 'home', label: 'Home' },
  { key: 'Discover', icon: 'discover', label: 'Discover' },
  { key: 'Library', icon: 'library', label: 'Library' },
  { key: 'Addons', icon: 'addons', label: 'Addons' },
  { key: 'JoinParty', icon: 'watchParty', label: 'Join Party' },
  { key: 'Settings', icon: 'settings', label: 'Settings' },
];

// Fixed-width icon column => icon never moves on expand; only the label appears.
function Row({
  iconW,
  itemH,
  expanded,
  active,
  glow,
  focusable = true,
  label,
  labelColor,
  labelFont,
  labelSize,
  icon,
  onRailFocus,
  onPress,
}: {
  iconW: number;
  itemH: number;
  expanded: boolean;
  active?: boolean;
  glow?: boolean;
  focusable?: boolean;
  label: string;
  labelColor?: string;
  labelFont?: string;
  labelSize: number;
  icon: ReactNode;
  onRailFocus?: (d: number) => void;
  onPress?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const lc = labelColor ?? (active ? colors.accent : focused ? colors.text : colors.textDim);
  const body = (
    <View
      style={{
        height: itemH,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: radius.card,
        borderWidth: 2,
        borderColor: focused ? colors.accent : 'transparent',
        backgroundColor: focused ? colors.surface10 : 'transparent',
      }}
    >
      <View style={{ width: iconW, alignItems: 'center', justifyContent: 'center' }}>
        {glow ? <View style={{ position: 'absolute', width: iconW * 1.0, height: iconW * 1.0, borderRadius: 999, backgroundColor: 'rgba(149,162,255,0.20)' }} /> : null}
        {icon}
      </View>
      {expanded ? (
        <Text numberOfLines={1} style={{ fontFamily: labelFont ?? font.bodySemi, fontSize: labelSize, color: lc, flex: 1 }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
  if (!focusable) return body;
  return (
    <Pressable
      onFocus={() => {
        setFocused(true);
        onRailFocus?.(1);
      }}
      onBlur={() => {
        setFocused(false);
        onRailFocus?.(-1);
      }}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

export function NavRail({ active = 'Home' as NavKey }: { active?: NavKey }) {
  const navigation = useNavigation<any>();
  const m = useMetrics();
  const { token } = useAuth();
  const { friends, incoming, presence } = useFriends(token);

  const railLeft = m.s(6);
  const collapsedW = m.railCollapsed - railLeft * 2;
  const rowMargin = m.s(5);
  const iconW = collapsedW - rowMargin * 2;
  const expandedW = m.railExpanded;
  const sz = m.s(26); // .nav-icon-slot svg = 26px

  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'friends' | 'requests'>('friends');
  const [query, setQuery] = useState('');
  const countRef = useRef(0);
  const widthAnim = useRef(new Animated.Value(collapsedW)).current;

  const onRailFocus = (d: number) => {
    countRef.current += d;
    if (countRef.current > 0) setExpanded(true);
    else setTimeout(() => countRef.current <= 0 && setExpanded(false), 60);
  };

  useEffect(() => {
    Animated.timing(widthAnim, { toValue: expanded ? expandedW : collapsedW, duration: 200, useNativeDriver: false }).start();
  }, [expanded, expandedW, collapsedW, widthAnim]);

  const ico = (path: keyof typeof ICONS, color: string) => <StrokeIcon path={ICONS[path]} size={sz} color={color} />;
  const friendsIcon = (color: string) => (
    <View>
      <StrokeIcon path={ICONS.watchParty} size={sz} color={color} />
      {incoming.length > 0 ? (
        <View style={{ position: 'absolute', top: -sz * 0.32, right: -sz * 0.4, minWidth: sz * 0.72, height: sz * 0.72, borderRadius: 999, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: sz * 0.5, color: colors.accentInk }}>{incoming.length}</Text>
        </View>
      ) : null}
    </View>
  );
  const divider = expanded ? <View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: m.s(8) }} /> : null;

  return (
    <Animated.View style={[styles.rail, { left: railLeft, top: m.safeY, bottom: m.safeY, width: widthAnim, borderRadius: m.s(28), zIndex: expanded ? 70 : 10 }]}>
      <LinearGradient colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, paddingHorizontal: rowMargin, paddingVertical: m.s(10) }}>
        <Row iconW={iconW} itemH={m.s(50)} expanded={expanded} focusable={false} label="Blissful" labelColor={colors.text} labelFont={font.serif} labelSize={m.s(22)} icon={<Image source={require('../../assets/blissful-small-logo.png')} style={{ width: m.s(38), height: m.s(38), borderRadius: m.s(10) }} resizeMode="contain" />} />
        {divider}
        {ITEMS.map((it) => (
          <Row key={it.key} iconW={iconW} itemH={m.navItemH} expanded={expanded} active={active === it.key} glow={active === it.key} label={it.label} labelSize={m.s(16)} icon={ico(it.icon, active === it.key ? colors.accent : colors.textDim)} onRailFocus={onRailFocus} onPress={() => it.key === 'Home' && navigation.navigate('Home')} />
        ))}

        {expanded ? (
          <>
            {divider}
            <Row iconW={iconW} itemH={m.navItemH} expanded label="Friends" labelColor={colors.text} labelSize={m.s(17)} icon={friendsIcon(colors.text)} onRailFocus={onRailFocus} />
            {token ? (
              <FriendsBody m={m} friends={friends} incoming={incoming} presence={presence} tab={tab} setTab={setTab} query={query} setQuery={setQuery} onRailFocus={onRailFocus} />
            ) : (
              <Pressable onFocus={() => onRailFocus(1)} onBlur={() => onRailFocus(-1)} onPress={() => navigation.navigate('Login')} style={{ padding: m.s(10) }}>
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: colors.textDim }}>Login to see friends</Text>
              </Pressable>
            )}
          </>
        ) : (
          <>
            <View style={{ flex: 1 }} />
            <Row iconW={iconW} itemH={m.navItemH} expanded={false} label="Friends" labelSize={m.s(16)} icon={friendsIcon(colors.accent)} onRailFocus={onRailFocus} />
          </>
        )}
      </View>
    </Animated.View>
  );
}

function FriendsBody({ m, friends, incoming, presence, tab, setTab, query, setQuery, onRailFocus }: any) {
  const [sf, setSf] = useState(false);
  const list = tab === 'requests' ? incoming : friends;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: m.s(38), borderRadius: radius.pill, paddingHorizontal: m.s(14), gap: m.s(10), marginTop: m.s(6), backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: sf ? colors.accent : 'rgba(255,255,255,0.12)' }}>
        <StrokeIcon path="M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" size={m.s(20)} color={colors.textFaint} />
        <TextInput value={query} onChangeText={setQuery} onFocus={() => { setSf(true); onRailFocus(1); }} onBlur={() => { setSf(false); onRailFocus(-1); }} placeholder="Search people..." placeholderTextColor={colors.textGhost} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(15), color: colors.text, padding: 0 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: m.s(8), marginTop: m.s(10) }}>
        {(['friends', 'requests'] as const).map((t) => (
          <Tab key={t} m={m} active={tab === t} label={`${t === 'friends' ? 'Friends' : 'Requests'} ${t === 'friends' ? friends.length : incoming.length}`} onRailFocus={onRailFocus} onPress={() => setTab(t)} />
        ))}
      </View>
      <ScrollView style={{ flex: 1, marginTop: m.s(10) }} contentContainerStyle={{ gap: m.s(6), paddingBottom: m.s(10) }} showsVerticalScrollIndicator>
        {list.length === 0 ? (
          <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: colors.textFaint, padding: m.s(10) }}>{tab === 'requests' ? 'No requests.' : 'No friends yet.'}</Text>
        ) : (
          list.map((f: any) => {
            const p = presence.get(f.userId);
            return (
              <Pressable
                key={f.id}
                onFocus={() => onRailFocus(1)}
                onBlur={() => onRailFocus(-1)}
                style={({ focused }: any) => ({ flexDirection: 'row', alignItems: 'center', gap: m.s(11), paddingVertical: m.s(8), paddingHorizontal: m.s(10), borderRadius: m.s(14), backgroundColor: focused ? colors.surface12 : 'rgba(255,255,255,0.043)', borderWidth: 2, borderColor: focused ? colors.accent : 'transparent' })}
              >
                <FriendAvatar name={f.nickname || f.displayName} size={m.s(46)} online={Boolean(p?.online)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(15), color: colors.text }}>{f.nickname || f.displayName}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: font.body, fontSize: m.s(13), color: 'rgba(255,255,255,0.5)' }}>{tab === 'requests' ? 'wants to be friends' : statusLine(p)}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Tab({ m, active, label, onRailFocus, onPress }: any) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => { setFocused(true); onRailFocus(1); }}
      onBlur={() => { setFocused(false); onRailFocus(-1); }}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', paddingVertical: m.s(7), borderRadius: radius.pill, backgroundColor: active ? 'rgba(255,255,255,0.16)' : colors.surface08, borderWidth: 2, borderColor: focused ? colors.accent : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), color: active ? colors.text : colors.textDim }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', backgroundColor: 'rgba(28,33,46,0.97)', borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
});
