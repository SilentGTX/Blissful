import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { markContentFocus } from '../lib/focusBus';
import { useContentInert } from '../lib/contentFocus';
import { openLogin } from '../lib/loginStore';
import { useSelfTag } from '../lib/useSelfTag';
import { useAuth } from '../context/AuthContext';
import { resolveAvatar } from '../lib/avatars';
import { ProfileMenu } from './ProfileMenu';

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

export function TopBar({
  searchRef,
  searchValue,
  onSearchChange,
  searchAutoFocus,
  searchNextFocusDown,
}: {
  searchRef?: React.Ref<View>;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchAutoFocus?: boolean;
  /** Node handle for the editable search's D-pad Down target (Search routes it
      to the first result card — geometry alone picks a mid-row card). */
  searchNextFocusDown?: number;
}) {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const m = useMetrics();
  const railOpen = useContentInert(); // gate the 2-3 top-bar focusables (cheap) so an
  // open rail traps focus here too; the rail's own ScrollView cascade covers the cards.
  const [searchFocused, setSearchFocused] = useState(false);
  const [avatarFocused, setAvatarFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Editing = the input is enabled + holds native focus (IME up). Starts true
  // when the screen wants the keyboard on entry (searchAutoFocus); OK on the
  // pill re-enters it. Ends on blur (focus moved to results / IME submit).
  const [editing, setEditing] = useState(Boolean(searchAutoFocus));
  // Trap Left on the search (the left-edge content element) so D-pad Left opens
  // the rail instead of jumping diagonally to a card below. Both traps live on
  // Pressables: TextInput drops nextFocus* natively (ReactTextInputManager has
  // no setters — only ReactViewManager does), so the editable pill is a
  // Pressable focus stop around a non-selectable input (the TvTextField pattern).
  const searchInputRef = useRef<TextInput | null>(null);
  const searchEditRef = useRef(null);
  const searchEditTag = useSelfTag(searchEditRef, !railOpen);
  const searchPressRef = useRef(null);
  const searchPressTag = useSelfTag(searchPressRef, !railOpen);
  // Focus (and thereby raise the IME on) the input once it's editable — the
  // enable must land on the native view before focus, so this can't happen
  // inline in onPress, and the focus command must trail the prop commit by a
  // tick (a disabled EditText silently rejects requestFocus).
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [editing]);
  // One-shot entry recovery: on screen entry the tvos engine hands its default
  // focus to the pill, which can beat/steal the auto-editing focus and leave
  // the IME closed. The FIRST pill focus after mount hands focus back to the
  // input; the input's own onFocus disarms it once editing has stuck.
  const entryFocusRef = useRef(Boolean(searchAutoFocus));
  // The non-editable search Pressable also exposes searchRef (Home's Up target),
  // so merge our measuring ref with the forwarded one.
  const setSearchPress = (node: unknown) => {
    (searchPressRef as { current: unknown }).current = node;
    if (typeof searchRef === 'function') searchRef(node as never);
    else if (searchRef) (searchRef as { current: unknown }).current = node;
  };

  const initial = (user?.displayName || user?.username || '?').trim().charAt(0).toUpperCase();
  const ring = (focused: boolean) => ({
    borderWidth: 1,
    borderColor: focused ? colors.accent : 'rgba(255,255,255,0.18)',
  });

  return (
    <View style={[styles.bar, { top: m.safeY, left: m.contentLeft, right: m.safeX, height: m.topbarH }]}>
      {onSearchChange ? (
        // Editable search (Search screen): a Pressable pill owns the D-pad focus
        // stop (so nextFocusLeft/Down actually apply); OK flips the inner input
        // editable and focuses it, which raises the IME. The input is DISABLED
        // (editable=false -> native isEnabled=false) whenever it isn't being
        // edited — a bare enabled EditText stays an Android focus candidate
        // (ReactTextInputManager drops isTVSelectable/focusable) and would steal
        // the D-pad stop from the pill.
        <Pressable
          ref={searchEditRef}
          isTVSelectable={!railOpen}
          nextFocusLeft={searchEditTag}
          nextFocusDown={searchNextFocusDown}
          onFocus={() => {
            setSearchFocused(true);
            markContentFocus(true);
            if (entryFocusRef.current) {
              entryFocusRef.current = false;
              if (editing) setTimeout(() => searchInputRef.current?.focus(), 30);
              else setEditing(true);
            }
          }}
          onBlur={() => setSearchFocused(false)}
          onPress={() => { if (editing) searchInputRef.current?.focus(); else setEditing(true); }}
          style={{ width: m.searchW, height: '100%' }}
        >
          <Glass
            focused={searchFocused}
            style={[styles.pill, { height: '100%', paddingHorizontal: m.s(26), gap: m.s(14), borderRadius: radius.pill }, ring(searchFocused)]}
          >
            <Ionicons name="search" size={m.s(26)} color="rgba(255,255,255,0.6)" />
            <TextInput
              ref={searchInputRef}
              autoFocus={searchAutoFocus}
              editable={editing}
              // The generated Android theme sets no colorAccent, so the caret falls
              // back to AppCompat's stock Material teal — pin it to the app accent.
              cursorColor={colors.accent}
              selectionColor={colors.accent}
              value={searchValue}
              onChangeText={onSearchChange}
              onFocus={() => { setSearchFocused(true); entryFocusRef.current = false; }}
              onBlur={() => { setSearchFocused(false); setEditing(false); }}
              placeholder="Search movies, series, actors..."
              placeholderTextColor="rgba(255,255,255,0.45)"
              returnKeyType="search"
              style={{ flex: 1, fontFamily: font.body, fontSize: m.searchFont, color: colors.text }}
            />
          </Glass>
        </Pressable>
      ) : (
        <Pressable
          ref={setSearchPress}
          isTVSelectable={!railOpen}
          nextFocusLeft={searchPressTag}
          onFocus={() => { setSearchFocused(true); markContentFocus(true); }}
          onBlur={() => setSearchFocused(false)}
          onPress={() => navigation.navigate('Search')}
          style={{ width: m.searchW, height: '100%' }}
        >
          <Glass
            focused={searchFocused}
            style={[styles.pill, { height: '100%', paddingHorizontal: m.s(26), gap: m.s(14), borderRadius: radius.pill }, ring(searchFocused)]}
          >
            <Ionicons name="search" size={m.s(26)} color="rgba(255,255,255,0.6)" />
            <Text style={{ fontFamily: font.body, fontSize: m.searchFont, color: 'rgba(255,255,255,0.45)' }}>
              Search movies, series, actors...
            </Text>
          </Glass>
        </Pressable>
      )}

      <Pressable
        isTVSelectable={!railOpen}
        onFocus={() => { setAvatarFocused(true); markContentFocus(false); }}
        onBlur={() => setAvatarFocused(false)}
        onPress={() => (user ? setMenuOpen(true) : openLogin())}
        style={[styles.avatarPress, { width: m.topbarH, height: m.topbarH }]}
      >
        {(() => {
          const av = user ? resolveAvatar(user.avatar, initial) : null;
          if (av && av.kind === 'image') {
            return (
              <Image
                source={av.source}
                style={{ width: '100%', height: '100%', borderRadius: radius.pill, borderWidth: 1, borderColor: avatarFocused ? colors.accent : 'rgba(255,255,255,0.18)' }}
                resizeMode="cover"
              />
            );
          }
          return (
            <Glass focused={avatarFocused} style={[styles.avatar, { borderRadius: radius.pill }, ring(avatarFocused)]}>
              {user ? (
                <Text style={{ fontFamily: font.serif, fontSize: m.profileFont, color: colors.text }}>{av?.value ?? initial}</Text>
              ) : (
                <Ionicons name="person" size={m.s(34)} color={colors.text} />
              )}
            </Glass>
          );
        })()}
      </Pressable>

      <ProfileMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', zIndex: 45 },
  pill: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  avatarPress: { position: 'absolute', right: 0 },
  avatar: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
