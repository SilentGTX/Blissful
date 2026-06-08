import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, findNodeHandle, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useTVEventHandler, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { ICONS, StrokeIcon } from '../icons/StrokeIcon';
import { useAuth } from '../context/AuthContext';
import { useFriends, statusLine } from '../lib/friends';
import { isAtLeftEdge } from '../lib/focusBus';
import { setRailOpen } from '../lib/railStore';
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
const Row = forwardRef<View, {
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
  nextFocusUp?: number;
  nextFocusDown?: number;
  autoFocus?: boolean;
}>(function Row({
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
  nextFocusUp,
  nextFocusDown,
  autoFocus,
}, ref) {
  const [focused, setFocused] = useState(false);
  // No color change on focus ("just leave the purple") — label color is constant;
  // the purple ring overlay is the only focus indicator.
  const lc = labelColor ?? (active ? colors.accent : colors.textDim);
  const body = (
    <View
      style={{
        height: itemH,
        marginHorizontal: mx,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: radius.card,
      }}
    >
      {/* Focus ring as an absolute overlay so it does NOT inset the row content
          (a layout border would shift the icon off-center). */}
      {focused ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.card, borderWidth: 1, borderColor: colors.accent }} /> : null}
      {/* Fixed-width icon column in BOTH states: anchored to the row's left, so
          the icon X never moves on expand/collapse (no jump). iconW == the
          collapsed row content width, so when collapsed the icon is centered. */}
      <View style={{ width: iconW, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
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
      ref={ref}
      hasTVPreferredFocus={autoFocus}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
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
});

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
  const setExp = (v: boolean) => {
    expandedRef.current = v;
    setExpanded(v);
  };
  // The collapsed rail is NOT focusable (its rows render focusable={expanded}),
  // so the D-pad can never land on a collapsed icon. It opens ONLY when D-pad
  // Left is pressed at the content's LEFT EDGE — i.e. the Left did not move
  // focus to another content card (focusBus). On open, the first row is remounted
  // (bumped key) with hasTVPreferredFocus so focus jumps into the rail. While
  // open, leaving the rail (focus to content) collapses it; Right also closes it.
  const justCollapsedRef = useRef(0);
  const [openKey, setOpenKey] = useState(0);
  const onRailFocus = (focused: boolean) => {
    focusedRef.current = focused;
  };

  // While open, each rail-bearing screen's content CONTAINER goes non-focusable
  // (railStore -> isTVSelectable on ONE ScrollView, which cascades to its cards),
  // so focus is trapped in the rail and can only leave via D-pad Right. Flipping
  // one container — not every card — is what keeps open instant (per-card flips
  // stalled the native tvos focus engine ~1.3s).
  useEffect(() => {
    setRailOpen(expanded);
  }, [expanded]);

  useTVEventHandler((evt) => {
    const t = evt.eventType;
    if (t === 'left' || t === 'swipeLeft') {
      // Synchronous: open only if focus is on a left-edge content element. (Left
      // on a non-edge card just moves to the card on its left — no open.)
      if (!expandedRef.current && isAtLeftEdge() && !focusedRef.current && Date.now() - justCollapsedRef.current > 400) {
        setOpenKey((k) => k + 1);
        setExp(true);
      }
    } else if ((t === 'right' || t === 'swipeRight') && expandedRef.current && !tabFocusedRef.current) {
      focusedRef.current = false;
      justCollapsedRef.current = Date.now();
      setExp(false);
    }
  });

  useEffect(() => {
    Animated.timing(widthAnim, { toValue: expanded ? expandedW : collapsedW, duration: 150, useNativeDriver: false }).start();
  }, [expanded, expandedW, collapsedW, widthAnim]);

  // Chain the rail rows vertically so D-pad Up/Down deterministically cycle the
  // rail items instead of escaping to the content grid (the native focus engine
  // is non-deterministic about this). Indices: 0..5 nav items, 6 = Friends.
  const navRefs = useRef<(View | null)[]>([]);
  const [navTags, setNavTags] = useState<(number | null)[]>([]);
  useLayoutEffect(() => {
    setNavTags(navRefs.current.map((r) => (r ? findNodeHandle(r) : null)));
  }, [expanded, token]);
  const upTag = (i: number) => navTags[i - 1] ?? navTags[i] ?? undefined;
  const downTag = (i: number) => navTags[i + 1] ?? navTags[i] ?? undefined;

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
        {ITEMS.map((it, i) => (
          <Row key={i === 0 ? `${it.key}-${openKey}` : it.key} ref={(el) => { navRefs.current[i] = el; }} focusable={expanded} autoFocus={i === 0 && expanded} nextFocusUp={upTag(i)} nextFocusDown={downTag(i)} iconW={iconW} itemH={m.navItemH} mx={rowMargin} expanded={expanded} active={active === it.key} label={it.label} labelSize={m.s(16)} icon={ico(it.icon, active === it.key ? colors.accent : colors.textDim, active === it.key)} onRailFocus={onRailFocus} onPress={() => { if (it.key === 'Home') navigation.navigate('Home'); else if (it.key === 'Discover') navigation.navigate('Discover', { type: 'movie' }); else if (it.key === 'Library') navigation.navigate('Library'); else if (it.key === 'Addons') navigation.navigate('Addons'); else if (it.key === 'Settings') navigation.navigate('Settings'); }} />
        ))}

        {!expanded ? <View style={{ flex: 1 }} /> : null}
        <Divider mx={m.s(8)} my={m.s(8)} />

        {expanded ? (
          <>
            <Row ref={(el) => { navRefs.current[6] = el; }} nextFocusUp={upTag(6)} iconW={iconW} itemH={m.navItemH} mx={rowMargin} expanded label="Friends" labelColor={colors.text} labelSize={m.s(17)} icon={friendsIcon(colors.text)} onRailFocus={onRailFocus} />
            {token ? (
              <FriendsBody m={m} mx={rowMargin} friends={friends} incoming={incoming} presence={presence} tab={tab} setTab={setTab} query={query} setQuery={setQuery} onRailFocus={onRailFocus} onTabFocus={(f: boolean) => (tabFocusedRef.current = f)} />
            ) : (
              <Pressable onFocus={() => onRailFocus(true)} onBlur={() => onRailFocus(false)} onPress={() => navigation.navigate('Login')} style={{ paddingHorizontal: rowMargin + m.s(6), paddingVertical: m.s(10) }}>
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: colors.textDim }}>Login to see friends</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Row focusable={false} iconW={iconW} itemH={m.navItemH} mx={rowMargin} expanded={false} label="Friends" labelSize={m.s(16)} icon={friendsIcon(colors.accent)} />
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
                style={({ focused }: any) => ({ flexDirection: 'row', alignItems: 'center', gap: m.s(11), paddingVertical: m.s(8), paddingHorizontal: m.s(10), borderRadius: m.s(14), backgroundColor: 'rgba(255,255,255,0.043)', borderWidth: 1, borderColor: focused ? colors.accent : 'transparent' })}
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
      style={{ flex: 1, alignItems: 'center', paddingVertical: m.s(7), borderRadius: radius.pill, backgroundColor: active ? 'rgba(255,255,255,0.16)' : colors.surface08, borderWidth: 1, borderColor: focused ? colors.accent : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), color: active ? colors.text : colors.textDim }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', backgroundColor: 'rgba(28,33,46,0.97)', borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
});
