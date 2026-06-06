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

// A rail row with a FIXED-width icon column so the icon never moves when the
// rail expands — only the label appears to its right.
function Row({
  iconColW,
  itemH,
  expanded,
  active,
  focusable = true,
  label,
  labelColor,
  icon,
  onRailFocus,
  onPress,
}: {
  iconColW: number;
  itemH: number;
  expanded: boolean;
  active?: boolean;
  focusable?: boolean;
  label: string;
  labelColor?: string;
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
      <View style={{ width: iconColW, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      {expanded ? (
        <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: iconColW * 0.42, color: lc, flex: 1, marginLeft: -iconColW * 0.06 }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
  if (!focusable) return <View style={{ marginHorizontal: 0 }}>{body}</View>;
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

  const rowMargin = m.s(4);
  const collapsedW = m.railCollapsed - rowMargin * 2;
  const iconColW = collapsedW - rowMargin * 2;
  const expandedW = m.railExpanded;
  const sz = m.navIcon;

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

  const ico = (path: string, color: string) => <StrokeIcon path={ICONS[path as keyof typeof ICONS]} size={sz} color={color} />;
  const friendsIcon = (color: string) => (
    <View>
      <StrokeIcon path={ICONS.watchParty} size={sz} color={color} />
      {incoming.length > 0 ? (
        <View style={{ position: 'absolute', top: -sz * 0.3, right: -sz * 0.35, minWidth: sz * 0.7, height: sz * 0.7, borderRadius: 999, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: sz * 0.5, color: colors.accentInk }}>{incoming.length}</Text>
        </View>
      ) : null}
    </View>
  );

  const divider = expanded ? <View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: m.s(8), marginHorizontal: rowMargin }} /> : null;

  return (
    <Animated.View style={[styles.rail, { left: rowMargin, top: m.safeY, bottom: m.safeY, width: widthAnim, borderRadius: m.s(28), zIndex: expanded ? 70 : 10 }]}>
      <LinearGradient colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, padding: rowMargin }}>
        {/* Logo + Blissful */}
        <Row
          iconColW={iconColW}
          itemH={m.s(52)}
          expanded={expanded}
          focusable={false}
          label="Blissful"
          labelColor={colors.text}
          icon={<Image source={require('../../assets/blissful-small-logo.png')} style={{ width: m.s(40), height: m.s(40), borderRadius: m.s(10) }} resizeMode="contain" />}
        />
        {divider}
        {ITEMS.map((it) => (
          <Row
            key={it.key}
            iconColW={iconColW}
            itemH={m.navItemH}
            expanded={expanded}
            active={active === it.key}
            label={it.label}
            icon={ico(it.icon, active === it.key ? colors.accent : colors.textDim)}
            onRailFocus={onRailFocus}
            onPress={() => it.key === 'Home' && navigation.navigate('Home')}
          />
        ))}

        {expanded ? (
          <>
            {divider}
            <Row iconColW={iconColW} itemH={m.navItemH} expanded label="Friends" labelColor={colors.text} icon={friendsIcon(colors.text)} onRailFocus={onRailFocus} />
            {token ? (
              <FriendsBody m={m} friends={friends} incoming={incoming} presence={presence} tab={tab} setTab={setTab} query={query} setQuery={setQuery} onRailFocus={onRailFocus} />
            ) : (
              <Pressable onFocus={() => onRailFocus(1)} onBlur={() => onRailFocus(-1)} onPress={() => navigation.navigate('Login')} style={styles.loginRow}>
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(22), color: colors.textDim }}>Login to see friends</Text>
              </Pressable>
            )}
          </>
        ) : (
          <>
            <View style={{ flex: 1 }} />
            <Row iconColW={iconColW} itemH={m.navItemH} expanded={false} label="Friends" icon={friendsIcon(colors.accent)} onRailFocus={onRailFocus} />
          </>
        )}
      </View>
    </Animated.View>
  );
}

function FriendsBody({ m, friends, incoming, presence, tab, setTab, query, setQuery, onRailFocus }: any) {
  const [searchFocused, setSearchFocused] = useState(false);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={[styles.search, { borderRadius: radius.pill, borderColor: searchFocused ? colors.accent : 'transparent', borderWidth: 2, paddingHorizontal: m.s(14), height: m.s(56), marginTop: m.s(6) }]}>
        <StrokeIcon path="M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" size={m.s(24)} color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => { setSearchFocused(true); onRailFocus(1); }}
          onBlur={() => { setSearchFocused(false); onRailFocus(-1); }}
          placeholder="Search people..."
          placeholderTextColor={colors.textGhost}
          style={{ flex: 1, marginLeft: m.s(10), fontFamily: font.body, fontSize: m.s(24), color: colors.text }}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: m.s(8), marginTop: m.s(10) }}>
        {(['friends', 'requests'] as const).map((t) => (
          <Tab key={t} m={m} active={tab === t} label={`${t === 'friends' ? 'Friends' : 'Requests'} ${t === 'friends' ? friends.length : incoming.length}`} onRailFocus={onRailFocus} onPress={() => setTab(t)} />
        ))}
      </View>
      <ScrollView style={{ flex: 1, marginTop: m.s(10) }} contentContainerStyle={{ gap: m.s(6), paddingBottom: m.s(10) }} showsVerticalScrollIndicator={false}>
        {(tab === 'requests' ? incoming : friends).length === 0 ? (
          <Text style={{ fontFamily: font.body, fontSize: m.s(22), color: colors.textFaint, padding: m.s(10) }}>
            {tab === 'requests' ? 'No requests.' : 'No friends yet.'}
          </Text>
        ) : (
          (tab === 'requests' ? incoming : friends).map((f: any) => {
            const p = presence.get(f.userId);
            return (
              <Pressable
                key={f.id}
                onFocus={() => onRailFocus(1)}
                onBlur={() => onRailFocus(-1)}
                style={({ focused }: any) => [styles.friendRow, { gap: m.s(12), padding: m.s(8), borderRadius: m.s(14), backgroundColor: focused ? colors.surface10 : 'transparent', borderWidth: 2, borderColor: focused ? colors.accent : 'transparent' }]}
              >
                <FriendAvatar name={f.nickname || f.displayName} size={m.s(50)} online={Boolean(p?.online)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(24), color: colors.text }}>{f.nickname || f.displayName}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: font.body, fontSize: m.s(20), color: colors.textFaint }}>
                    {tab === 'requests' ? 'wants to be friends' : statusLine(p)}
                  </Text>
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
      style={{ flex: 1, alignItems: 'center', paddingVertical: m.s(9), borderRadius: radius.pill, backgroundColor: active ? colors.surface18 : colors.surface08, borderWidth: 2, borderColor: focused ? colors.accent : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(22), color: active ? colors.text : colors.textDim }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', backgroundColor: 'rgba(28,33,46,0.97)', borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  loginRow: { padding: 10, marginTop: 8 },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface10 },
  friendRow: { flexDirection: 'row', alignItems: 'center' },
});
