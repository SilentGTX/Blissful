import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, findNodeHandle, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useTVEventHandler, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { ICONS, StrokeIcon } from '../icons/StrokeIcon';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { useFriends, statusLine } from '../lib/friends';
import { acceptFriendRequest, removeFriend, requestPartyInvite, setFriendNickname } from '@blissful/core';
import { atLeftEdgeRaw, focusStamp } from '../lib/focusBus';
import { setRailOpen } from '../lib/railStore';
import { closeLogin, openLogin, useLoginOpen } from '../lib/loginStore';
import { isOverlayOpen } from '../lib/overlayStore';
import { useActiveParties } from '../lib/activeParties';
import { joinWatchPartyRoom } from '../lib/joinWatchParty';
import { FriendAvatar } from './FriendAvatar';
import { JoinPartyModal } from './JoinPartyModal';
import { LoginModal } from './LoginModal';

type NavKey = 'Search' | 'Home' | 'Discover' | 'Library' | 'Addons' | 'JoinParty' | 'Settings';
const ITEMS: { key: NavKey; icon: keyof typeof ICONS; label: string }[] = [
  { key: 'Search', icon: 'search', label: 'Search' },
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
  renderIcon: (color: string) => ReactNode;
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
  renderIcon,
  onRailFocus,
  onPress,
  nextFocusUp,
  nextFocusDown,
  autoFocus,
}, ref) {
  const m = useMetrics();
  const [focused, setFocused] = useState(false);
  // Focus indicator = an accent BORDER ring only — icon + label keep their resting
  // colour (active page = accent, otherwise textDim). The whole-row accent FILL was
  // removed per request: a focused row gets the ring, nothing else changes.
  const lc = labelColor ?? (active ? colors.accent : colors.textDim);
  // Border is ALWAYS present (transparent when unfocused) so gaining focus only
  // recolours it — the row content never shifts.
  const ringW = m.s(3);
  const body = (
    <View
      style={{
        height: itemH,
        marginHorizontal: mx,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: radius.card,
        borderWidth: ringW,
        borderColor: focused ? colors.accent : 'transparent',
      }}
    >
      {/* Fixed-width icon column in BOTH states: anchored to the row's left, so
          the icon X never moves on expand/collapse (no jump). iconW == the
          collapsed row content width, so when collapsed the icon is centered. */}
      <View style={{ width: iconW, alignItems: 'center', justifyContent: 'center' }}>{renderIcon(lc)}</View>
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
  const toast = useToast();
  const m = useMetrics();
  const { token } = useAuth();
  const { friends, incoming, presence, refresh } = useFriends(token);
  const [joinOpen, setJoinOpen] = useState(false);
  // The global Login modal is opened from many places (avatar, this rail, the
  // Library empty state). Render it IN-TREE here — same spot as JoinPartyModal —
  // so its FocusTrap reliably traps the D-pad (a root-level sibling of the
  // navigator did not). `isFocused` so a stacked-but-inactive screen's rail
  // (e.g. Home under Discover) doesn't render a second copy.
  const loginOpen = useLoginOpen();
  const isFocused = useIsFocused();

  // Flush to the screen's left edge (design Sidebar.jsx aside: left 0, full height).
  const railLeft = 0;
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
  // The content-focus stamp seen at the PREVIOUS Left event — lets us tell a Left
  // that moved focus onto the edge tile (stamp advanced) from a Left pressed while
  // already parked on it (stamp unchanged). Fixes the rail expanding spuriously when
  // a (slightly long) Left just lands you on the first poster.
  const leftSeenStampRef = useRef(0);
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
      if (isOverlayOpen()) return; // a modal/overlay (FocusTrap) is up — don't open the rail behind it
      // Open ONLY when this Left didn't move focus — i.e. focus is parked on a
      // left-edge content element. A Left that moves another card -> the first card
      // bumps the focus stamp, so we suppress it (was opening on the landing Left).
      // The >400ms resting fallback covers the very first Left after route entry.
      const stamp = focusStamp();
      const moved = stamp !== leftSeenStampRef.current;
      leftSeenStampRef.current = stamp;
      const parked = atLeftEdgeRaw() && (!moved || Date.now() - stamp > 400);
      if (!expandedRef.current && parked && !focusedRef.current && Date.now() - justCollapsedRef.current > 400) {
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
  // is non-deterministic about this). Indices: 0..6 nav items, 7 = Friends.
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
        <View style={{ position: 'absolute', top: -sz * 0.32, right: -sz * 0.4, minWidth: sz * 0.72, height: sz * 0.72, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: sz * 0.5, color: colors.accentInk }}>{incoming.length}</Text>
        </View>
      ) : null}
    </View>
  );

  const Divider = ({ mx, my }: { mx: number; my: number }) => <View style={{ height: 1, marginHorizontal: mx, marginVertical: my, backgroundColor: HAIRLINE }} />;

  return (
    <>
    <Animated.View style={[styles.rail, { left: railLeft, top: 0, bottom: 0, width: widthAnim, zIndex: expanded ? 70 : 10, backgroundColor: expanded ? NAV_PANEL : 'transparent', borderRightWidth: 1, borderRightColor: expanded ? 'rgba(255,255,255,0.07)' : HAIRLINE, borderTopRightRadius: expanded ? radius.card : 0, borderBottomRightRadius: expanded ? radius.card : 0 }]}>
      {/* Full-height panel flush to the left edge: transparent when collapsed —
          icons float on the home scrim, with a super-subtle right hairline marking
          where the rail ends — and a dark panel with a gently-rounded RIGHT edge
          (top-right + bottom-right) when expanded. No glass pill / sheen. */}
      <View style={{ flex: 1, paddingTop: m.safeY, paddingBottom: m.safeY }}>
        <Row iconW={iconW} itemH={m.s(48)} mx={rowMargin} expanded={expanded} focusable={false} label="Blissful" labelColor={colors.text} labelFont={font.serif} labelSize={m.s(22)} renderIcon={() => <Image source={require('../../assets/blissful-small-logo.png')} style={{ width: m.s(36), height: m.s(36), borderRadius: m.s(10) }} resizeMode="contain" />} />
        <Divider mx={m.s(10)} my={m.s(6)} />
        {ITEMS.map((it, i) => (
          <Row key={i === 0 ? `${it.key}-${openKey}` : it.key} ref={(el) => { navRefs.current[i] = el; }} focusable={expanded} autoFocus={i === 0 && expanded} nextFocusUp={upTag(i)} nextFocusDown={downTag(i)} iconW={iconW} itemH={m.navItemH} mx={rowMargin} expanded={expanded} active={active === it.key} label={it.label} labelSize={m.s(16)} renderIcon={(c) => ico(it.icon, c, c === colors.accent)} onRailFocus={onRailFocus} onPress={() => { if (it.key === 'Search') navigation.navigate('Search'); else if (it.key === 'Home') navigation.navigate('Home'); else if (it.key === 'Discover') navigation.navigate('Discover', { type: 'movie' }); else if (it.key === 'Library') navigation.navigate('Library'); else if (it.key === 'Addons') navigation.navigate('Addons'); else if (it.key === 'Settings') navigation.navigate('Settings'); else if (it.key === 'JoinParty') setJoinOpen(true); }} />
        ))}

        <Divider mx={m.s(8)} my={m.s(8)} />

        {expanded ? (
          <>
            <Row ref={(el) => { navRefs.current[7] = el; }} nextFocusUp={upTag(7)} iconW={iconW} itemH={m.navItemH} mx={rowMargin} expanded label="Friends" labelColor={colors.text} labelSize={m.s(17)} renderIcon={(c) => friendsIcon(c)} onRailFocus={onRailFocus} />
            {token ? (
              <FriendsBody m={m} mx={rowMargin} token={token} friends={friends} incoming={incoming} presence={presence} refresh={refresh} tab={tab} setTab={setTab} query={query} setQuery={setQuery} onRailFocus={onRailFocus} onTabFocus={(f: boolean) => (tabFocusedRef.current = f)} />
            ) : (
              <Pressable onFocus={() => onRailFocus(true)} onBlur={() => onRailFocus(false)} onPress={openLogin} style={{ paddingHorizontal: rowMargin + m.s(6), paddingVertical: m.s(10) }}>
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: colors.textDim }}>Login to see friends</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Row focusable={false} iconW={iconW} itemH={m.navItemH} mx={rowMargin} expanded={false} label="Friends" labelSize={m.s(16)} renderIcon={() => friendsIcon(colors.textDim)} />
        )}
      </View>
    </Animated.View>
    {joinOpen ? <JoinPartyModal token={token} onClose={() => setJoinOpen(false)} /> : null}
    {loginOpen && isFocused ? <LoginModal onClose={closeLogin} /> : null}
    </>
  );
}

function FriendsBody({ m, mx, token, friends, incoming, presence, refresh, tab, setTab, query, setQuery, onRailFocus, onTabFocus }: any) {
  const [sf, setSf] = useState(false);
  const toast = useToast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = useNavigation<any>();
  // The friend row whose actions accordion is open (friends tab only).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The friend whose inline nickname field is open.
  const [nickId, setNickId] = useState<string | null>(null);
  const [nickVal, setNickVal] = useState('');
  // Friends with an OPEN room (they accepted our invite / are hosting) -> the row
  // shows "Join party" instead of "Request party" until their room closes.
  const activeParties = useActiveParties();
  const list = tab === 'requests' ? incoming : friends;
  const acceptReq = (f: any) => { if (token) acceptFriendRequest(token, f.id).then(refresh).catch(() => toast.show('Could not accept')); };
  const declineReq = (f: any) => { if (token) removeFriend(token, f.id).then(refresh).catch(() => toast.show('Could not decline')); };
  const requestParty = (f: any) => { setExpandedId(null); if (token) requestPartyInvite(token, f.userId).then(() => toast.show('Invite sent', { description: `Waiting for ${f.nickname || f.displayName} to accept.` })).catch(() => toast.show('Invite failed')); };
  const joinParty = (room: any) => { setExpandedId(null); joinWatchPartyRoom(token, { code: room.code, type: room.type, imdbId: room.imdbId, videoId: room.videoId, hasPassword: false, participantCount: 0 }).then((res) => { if (!res.ok) toast.show(res.reason ?? 'Could not join the party'); }); };
  const unfriend = (f: any) => { setExpandedId(null); if (token) removeFriend(token, f.id).then(refresh).catch(() => toast.show('Could not remove')); };
  const saveNick = (f: any) => { setNickId(null); setExpandedId(null); if (token) setFriendNickname(token, f.id, nickVal.trim()).then(refresh).catch(() => toast.show('Could not save')); };
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
      {/* The list scrolls; a bottom fade dissolves the last row into the panel
          instead of a hard clip, signalling "more below" (matches the home peek). */}
      <View style={{ flex: 1, minHeight: 0, marginTop: m.s(10) }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: m.s(6), paddingBottom: m.s(56) }} showsVerticalScrollIndicator>
          {list.length === 0 ? (
            <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: colors.textFaint, padding: m.s(10) }}>{tab === 'requests' ? 'No requests.' : 'No friends yet.'}</Text>
          ) : (
            list.map((f: any) => {
              const p = presence.get(f.userId);
              const watching = tab === 'friends' && Boolean(p?.online && p?.activity?.name);
              const activeRoom = tab === 'friends' ? activeParties[f.userId] : undefined;
              const isReq = tab === 'requests';
              const expanded = !isReq && expandedId === f.id;
              const editingNick = nickId === f.id;
              return (
                <View key={f.id} style={{ borderRadius: m.s(14), overflow: 'hidden', backgroundColor: expanded ? 'rgba(255,255,255,0.06)' : 'transparent' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
                    {/* OK on a friend EXPANDS the row (accordion); on a request it accepts. */}
                    <FriendRow m={m} expanded={expanded} onRailFocus={onRailFocus} onPress={() => { if (isReq) acceptReq(f); else setExpandedId(expanded ? null : f.id); }}>
                      <FriendAvatar name={f.nickname || f.displayName} size={m.s(46)} online={Boolean(p?.online)} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(15), color: colors.text }}>{f.nickname || f.displayName}</Text>
                        <Text numberOfLines={1} style={{ fontFamily: font.body, fontSize: m.s(13), color: 'rgba(255,255,255,0.5)' }}>{isReq ? 'wants to be friends' : statusLine(p)}</Text>
                      </View>
                      {isReq ? (
                        <StrokeIcon path="M5 13l4 4L19 7" size={m.s(20)} color="#34d399" />
                      ) : (
                        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={m.s(18)} color="rgba(255,255,255,0.5)" />
                      )}
                    </FriendRow>
                    {isReq ? <FriendActionBtn m={m} icon="M6 6l12 12M18 6L6 18" color="#f87171" onRailFocus={onRailFocus} onPress={() => declineReq(f)} /> : null}
                  </View>
                  {/* Accordion: actions revealed below the name (the OpenCode PersonActionsRow). */}
                  {expanded ? (
                    <View style={{ paddingHorizontal: m.s(8), paddingBottom: m.s(8), gap: m.s(2) }}>
                      {editingNick ? (
                        <>
                          <FriendNickField m={m} value={nickVal} onChange={setNickVal} onSubmit={() => saveNick(f)} onRailFocus={onRailFocus} />
                          <OptionRow m={m} label="Save nickname" accent onRailFocus={onRailFocus} onPress={() => saveNick(f)} />
                          <OptionRow m={m} label="Back" onRailFocus={onRailFocus} onPress={() => setNickId(null)} />
                        </>
                      ) : (
                        <>
                          <OptionRow m={m} label="View profile" autoFocus onRailFocus={onRailFocus} onPress={() => { setExpandedId(null); nav.navigate('Profile', { userId: f.userId, displayName: f.nickname || f.displayName }); }} />
                          {activeRoom ? (
                            <OptionRow m={m} label="Join party" accent onRailFocus={onRailFocus} onPress={() => joinParty(activeRoom)} />
                          ) : watching ? (
                            <OptionRow m={m} label="Request party" accent onRailFocus={onRailFocus} onPress={() => requestParty(f)} />
                          ) : null}
                          <OptionRow m={m} label="Nickname" onRailFocus={onRailFocus} onPress={() => { setNickId(f.id); setNickVal(f.nickname ?? ''); }} />
                          <OptionRow m={m} label="Remove friend" danger onRailFocus={onRailFocus} onPress={() => unfriend(f)} />
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
        <LinearGradient pointerEvents="none" colors={['transparent', NAV_PANEL]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: m.s(48) }} />
      </View>
    </View>
  );
}

// The focusable friend-row body (avatar + name/status + a right-side hint icon).
// OK runs the row's primary action; it's a real focus stop so the D-pad walks the
// list. The decline ✕ (requests) sits beside it as a separate focusable.
function FriendRow({ m, expanded, onRailFocus, onPress, children }: any) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onFocus={() => { setF(true); onRailFocus(true); }}
      onBlur={() => { setF(false); onRailFocus(false); }}
      onPress={onPress}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: m.s(11), paddingVertical: m.s(8), paddingHorizontal: m.s(10), borderRadius: m.s(14), backgroundColor: f ? 'rgba(255,255,255,0.1)' : expanded ? 'transparent' : 'rgba(255,255,255,0.043)', borderWidth: m.s(2), borderColor: f ? colors.accent : 'transparent' }}
    >
      {children}
    </Pressable>
  );
}

// One action inside the expanded friend accordion (View profile / Request party /
// Nickname / Remove friend).
function OptionRow({ m, label, accent, danger, autoFocus, onRailFocus, onPress }: any) {
  const [f, setF] = useState(false);
  const color = danger ? '#f87171' : accent ? colors.accent : colors.text;
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => { setF(true); onRailFocus(true); }}
      onBlur={() => { setF(false); onRailFocus(false); }}
      onPress={onPress}
      style={{ borderRadius: m.s(10), paddingHorizontal: m.s(12), paddingVertical: m.s(10), backgroundColor: f ? 'rgba(255,255,255,0.12)' : 'transparent', borderWidth: m.s(2), borderColor: f ? colors.accent : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(15), color }}>{label}</Text>
    </Pressable>
  );
}

// Inline nickname text field inside the accordion (OK focuses it -> IME).
function FriendNickField({ m, value, onChange, onSubmit, onRailFocus }: any) {
  const [f, setF] = useState(false);
  const ref = useRef<TextInput>(null);
  return (
    <Pressable
      hasTVPreferredFocus
      onFocus={() => { setF(true); onRailFocus(true); }}
      onBlur={() => { setF(false); onRailFocus(false); }}
      onPress={() => ref.current?.focus()}
      style={{ borderRadius: m.s(10), borderWidth: m.s(2), borderColor: f ? colors.accent : 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: m.s(12), minHeight: m.s(44), justifyContent: 'center' }}
    >
      <TextInput ref={ref} value={value} onChangeText={onChange} onFocus={() => { setF(true); onRailFocus(true); }} onBlur={() => { setF(false); onRailFocus(false); }} onSubmitEditing={onSubmit} placeholder="Nickname (blank to clear)" placeholderTextColor={colors.textGhost} maxLength={40}
        style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.text, paddingVertical: m.s(8) }} />
    </Pressable>
  );
}

// A focusable round icon button on a friend row (accept ✓ / decline ✕ / party).
function FriendActionBtn({ m, icon, color, onRailFocus, onPress }: any) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onFocus={() => { setF(true); onRailFocus(true); }}
      onBlur={() => { setF(false); onRailFocus(false); }}
      onPress={onPress}
      style={{ width: m.s(42), height: m.s(42), borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: f ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)', borderWidth: m.s(2), borderColor: f ? colors.accent : 'transparent' }}
    >
      <StrokeIcon path={icon} size={m.s(20)} color={color} />
    </Pressable>
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

// The dark flush drawer. Pushed darker + less blue than the design's
// rgba(15,18,26) toward near-black (sits just above the app bg #07090d) per request.
const NAV_PANEL = 'rgba(10,11,15,0.99)';
// Super-subtle hairline shared by the collapsed rail's right edge AND the two
// in-panel dividers (below the logo, above Friends) so they read identically.
const HAIRLINE = 'rgba(255,255,255,0.022)';

const styles = StyleSheet.create({
  rail: { position: 'absolute', overflow: 'hidden' },
});
