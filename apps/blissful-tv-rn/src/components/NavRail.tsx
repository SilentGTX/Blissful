import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useTVEventHandler, View } from 'react-native';
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

// Icon column is flex:1 when collapsed (icon dead-centered in the row) and a
// FIXED width when expanded (icon stays put, label appears to the right).
function Row({
  iconW,
  itemH,
  mx,
  expanded,
  active,
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
  mx: number;
  expanded: boolean;
  active?: boolean;
  focusable?: boolean;
  label: string;
  labelColor?: string;
  labelFont?: string;
  labelSize: number;
  icon: ReactNode;
  onRailFocus?: (focused: boolean) => void;
  onPress?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const lc = labelColor ?? (active ? colors.accent : focused ? colors.text : colors.textDim);
  const body = (
    <View
      style={{
        height: itemH,
        marginHorizontal: mx,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: radius.card,
        borderWidth: 2,
        borderColor: focused ? colors.accent : 'transparent',
        backgroundColor: focused ? colors.surface10 : 'transparent',
      }}
    >
      <View style={[{ alignItems: 'center', justifyContent: 'center' }, expanded ? { width: iconW } : { flex: 1 }]}>{icon}</View>
      {expanded ? (
        <Text numberOfLines={1} style={{ fontFamily: labelFont ?? font.bodySemi, fontSize: labelSize, color: lc, flex: 1, marginLeft: 2 }}>
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
        onRailFocus?.(true);
      }}
      onBlur={() => {
        setFocused(false);
        onRailFocus?.(false);
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
  const sz = m.s(26);

  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'friends' | 'requests'>('friends');
  const [query, setQuery] = useState('');
  const widthAnim = useRef(new Animated.Value(collapsedW)).current;

  // Track whether ANY rail element is focused with a boolean (not a count): the
  // search TextInput fires unbalanced focus/blur, which made a counter drift and
  // never return to 0 -> the rail wouldn't collapse on Right. Relies on the
  // standard blur-before-focus order: leaving a row blurs (schedules collapse),
  // entering the next focuses (cancels it). Focus genuinely leaving the rail
  // (the only exit is Right, since the rail hugs the left edge) -> collapse.
  const focusedRef = useRef(false);
  const expandedRef = useRef(false);
  const tabFocusedRef = useRef(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setExp = (v: boolean) => {
    expandedRef.current = v;
    setExpanded(v);
  };
  const onRailFocus = (focused: boolean) => {
    focusedRef.current = focused;
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    if (focused) setExp(true);
    else collapseTimer.current = setTimeout(() => !focusedRef.current && setExp(false), 120);
  };

  // Deterministic close: D-pad Right while the rail is open collapses it,
  // regardless of whether the row blur fired (tvos blur events are unreliable
  // after the search field). Tabs are excluded so Friends->Requests still works.
  useTVEventHandler((evt) => {
    if ((evt.eventType === 'right' || evt.eventType === 'swipeRight') && expandedRef.current && !tabFocusedRef.current) {
      focusedRef.current = false;
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
        collapseTimer.current = null;
      }
      setExp(false);
    }
  });

  useEffect(() => {
    Animated.timing(widthAnim, { toValue: expanded ? expandedW : collapsedW, duration: 200, useNativeDriver: false }).start();
  }, [expanded, expandedW, collapsedW, widthAnim]);

  const ico = (path: keyof typeof ICONS, color: string, glow?: boolean) => (
    <StrokeIcon path={ICONS[path]} size={sz} color={color} glow={glow ? colors.accent : undefined} />
  );
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

  const Divider = ({ mx, my }: { mx: number; my: number }) => <View style={{ height: 1, marginHorizontal: mx, marginVertical: my, backgroundColor: 'rgba(255,255,255,0.1)' }} />;

  return (
    <Animated.View style={[styles.rail, { left: railLeft, top: m.safeY, bottom: m.safeY, width: widthAnim, borderRadius: m.s(28), zIndex: expanded ? 70 : 10 }]}>
      <LinearGradient colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)']} start={{ x: 0.85, y: 0 }} end={{ x: 0.15, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, paddingVertical: m.s(10) }}>
        <Row iconW={iconW} itemH={m.s(48)} mx={rowMargin} expanded={expanded} focusable={false} label="Blissful" labelColor={colors.text} labelFont={font.serif} labelSize={m.s(22)} icon={<Image source={require('../../assets/blissful-small-logo.png')} style={{ width: m.s(36), height: m.s(36), borderRadius: m.s(10) }} resizeMode="contain" />} />
        <Divider mx={m.s(10)} my={m.s(6)} />
        {ITEMS.map((it) => (
          <Row key={it.key} iconW={iconW} itemH={m.navItemH} mx={rowMargin} expanded={expanded} active={active === it.key} label={it.label} labelSize={m.s(16)} icon={ico(it.icon, active === it.key ? colors.accent : colors.textDim, active === it.key)} onRailFocus={onRailFocus} onPress={() => it.key === 'Home' && navigation.navigate('Home')} />
        ))}

        {!expanded ? <View style={{ flex: 1 }} /> : null}
        <Divider mx={m.s(8)} my={m.s(8)} />

        {expanded ? (
          <>
            <Row iconW={iconW} itemH={m.navItemH} mx={rowMargin} expanded label="Friends" labelColor={colors.text} labelSize={m.s(17)} icon={friendsIcon(colors.text)} onRailFocus={onRailFocus} />
            {token ? (
              <FriendsBody m={m} mx={rowMargin} friends={friends} incoming={incoming} presence={presence} tab={tab} setTab={setTab} query={query} setQuery={setQuery} onRailFocus={onRailFocus} onTabFocus={(f: boolean) => (tabFocusedRef.current = f)} />
            ) : (
              <Pressable onFocus={() => onRailFocus(true)} onBlur={() => onRailFocus(false)} onPress={() => navigation.navigate('Login')} style={{ paddingHorizontal: rowMargin + m.s(6), paddingVertical: m.s(10) }}>
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: colors.textDim }}>Login to see friends</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Row iconW={iconW} itemH={m.navItemH} mx={rowMargin} expanded={false} label="Friends" labelSize={m.s(16)} icon={friendsIcon(colors.accent)} onRailFocus={onRailFocus} />
        )}
      </View>
    </Animated.View>
  );
}

function FriendsBody({ m, mx, friends, incoming, presence, tab, setTab, query, setQuery, onRailFocus, onTabFocus }: any) {
  const [sf, setSf] = useState(false);
  const list = tab === 'requests' ? incoming : friends;
  return (
    <View style={{ flex: 1, minHeight: 0, marginHorizontal: mx }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: m.s(38), borderRadius: radius.pill, paddingHorizontal: m.s(14), gap: m.s(10), marginTop: m.s(6), backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: sf ? colors.accent : 'rgba(255,255,255,0.12)' }}>
        <StrokeIcon path="M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" size={m.s(20)} color={colors.textFaint} />
        <TextInput value={query} onChangeText={setQuery} onFocus={() => { setSf(true); onRailFocus(true); }} onBlur={() => { setSf(false); onRailFocus(false); }} placeholder="Search people..." placeholderTextColor={colors.textGhost} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(15), color: colors.text, padding: 0 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: m.s(8), marginTop: m.s(10) }}>
        {(['friends', 'requests'] as const).map((t) => (
          <Tab key={t} m={m} active={tab === t} label={`${t === 'friends' ? 'Friends' : 'Requests'} ${t === 'friends' ? friends.length : incoming.length}`} onRailFocus={onRailFocus} onTabFocus={onTabFocus} onPress={() => setTab(t)} />
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
                onFocus={() => onRailFocus(true)}
                onBlur={() => onRailFocus(false)}
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

function Tab({ m, active, label, onRailFocus, onTabFocus, onPress }: any) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => { setFocused(true); onRailFocus(true); onTabFocus?.(true); }}
      onBlur={() => { setFocused(false); onRailFocus(false); onTabFocus?.(false); }}
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
