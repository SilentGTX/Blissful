import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { FocusTrap } from './FocusTrap';
import { useAuth } from '../context/AuthContext';
import { resolveAvatar, PRESET_AVATARS } from '../lib/avatars';
import { openLogin } from '../lib/loginStore';
import type { StoredAccount } from '../lib/accounts';

const PRESET_RE = /avatar[_-]?(\d{1,2})/i;
function presetIndexOf(avatar?: string | null): number {
  if (avatar) {
    const m = PRESET_RE.exec(avatar);
    if (m) {
      const i = Number.parseInt(m[1], 10) - 1;
      if (i >= 0 && i < PRESET_AVATARS.length) return i;
    }
  }
  return 0;
}

// "just leave the purple": no bg/color change on focus — only the purple ring.
function Row({
  label,
  icon,
  danger,
  m,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  m: ReturnType<typeof useMetrics>;
  onPress: () => void;
}) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(16), paddingVertical: m.s(14), paddingHorizontal: m.s(18), borderRadius: m.s(14), borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Ionicons name={icon} size={m.s(30)} color={danger ? colors.danger : colors.textDim} />
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(26), color: danger ? colors.danger : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function AvatarCell({ src, size, selected, autoFocus, onPress }: { src: number; size: number; selected: boolean; autoFocus: boolean; onPress: () => void }) {
  const [f, setF] = useState(false);
  const ring = f || selected;
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ width: size, height: size, borderRadius: radius.field, overflow: 'hidden', borderWidth: 1, borderColor: ring ? colors.accent : 'transparent' }}
    >
      <Image source={src} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      {selected ? (
        <View style={{ position: 'absolute', right: size * 0.06, top: size * 0.06, width: size * 0.24, height: size * 0.24, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent }}>
          <Text style={{ fontSize: size * 0.13, color: colors.accentInk, fontFamily: font.bodySemi }}>✓</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// A switchable saved profile (avatar + name). Tapping it activates that account;
// the swap icon signals "switch to". Mirrors the Row affordance (purple ring on
// focus, no fill change).
function ProfileRow({ account, m, onPress }: { account: StoredAccount; m: ReturnType<typeof useMetrics>; onPress: () => void }) {
  const [f, setF] = useState(false);
  const name = account.user.displayName || account.user.username || 'Profile';
  const av = resolveAvatar(account.user.avatar, name.charAt(0).toUpperCase());
  return (
    <Pressable
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(16), paddingVertical: m.s(10), paddingHorizontal: m.s(12), borderRadius: m.s(14), borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      {av.kind === 'image' ? (
        <Image source={av.source} style={{ width: m.s(50), height: m.s(50), borderRadius: radius.pill }} resizeMode="cover" />
      ) : (
        <View style={{ width: m.s(50), height: m.s(50), borderRadius: radius.pill, backgroundColor: colors.surface12, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.serif, fontSize: m.s(24), color: colors.text }}>{av.value}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(24), color: colors.text }} numberOfLines={1}>{name}</Text>
        {account.user.username ? <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: colors.textFaint }} numberOfLines={1}>@{account.user.username}</Text> : null}
      </View>
      <Ionicons name="swap-horizontal" size={m.s(24)} color={colors.textDim} />
    </Pressable>
  );
}

export function ProfileMenu({ visible, onClose, onCustomizeHome }: { visible: boolean; onClose: () => void; onCustomizeHome?: () => void }) {
  const m = useMetrics();
  const navigation = useNavigation<any>();
  const { user, token, accounts, switchAccount, logout, updateProfile } = useAuth();
  const [mode, setMode] = useState<'menu' | 'avatar'>('menu');
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [headFocused, setHeadFocused] = useState(false);
  const [saveFocused, setSaveFocused] = useState(false);

  useEffect(() => {
    if (visible) {
      setMode('menu');
      setSelected(presetIndexOf(user?.avatar));
    }
  }, [visible, user?.avatar]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'avatar') {
        setMode('menu');
        return true;
      }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose, mode]);

  if (!visible || !user) return null;

  const name = user.displayName || user.username || 'You';
  const av = resolveAvatar(user.avatar, name.charAt(0).toUpperCase());
  // The OTHER saved profiles (the active one is already the header).
  const others = accounts.filter((a) => a.token !== token);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ avatar: `/avatar/avatar_${selected + 1}.png` });
      onClose();
    } catch {
      // leave the menu open on failure
    } finally {
      setSaving(false);
    }
  };

  const panelW = m.s(560);
  const cardW = m.s(600);
  const cardPad = m.s(28);
  const cellGap = m.s(16);
  // shave a couple px so 4 cells never wrap to a 3rd row; space-between fills it.
  const cellSize = (cardW - cardPad * 2 - cellGap * 3) / 4 - m.s(4);

  return (
    // A full-screen in-tree overlay, NOT a <Modal>: react-native-tvos Modals don't
    // capture the hardware Back on Android TV (Back fell through and EXITED the app
    // instead of closing the menu). As a normal view in the tree, the BackHandler
    // below fires reliably and FocusTrap keeps the D-pad inside. Must be rendered at
    // a full-screen root (HomeScreen) so absoluteFill === the screen.
    <View style={styles.overlayRoot}>
      <Pressable style={styles.backdrop} focusable={false} onPress={onClose} />
      {mode === 'menu' ? (
        <FocusTrap style={[styles.panel, { top: m.safeY + m.topbarH + m.s(10), right: m.safeX, width: panelW, borderRadius: m.s(24), padding: m.s(16) }]}>
            <Pressable
              hasTVPreferredFocus
              onFocus={() => setHeadFocused(true)}
              onBlur={() => setHeadFocused(false)}
              onPress={() => setMode('avatar')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(16), padding: m.s(8), marginBottom: m.s(6), borderRadius: m.s(16), borderWidth: 1, borderColor: headFocused ? colors.accent : 'transparent' }}
            >
              {av.kind === 'image' ? (
                <Image source={av.source} style={{ width: m.s(76), height: m.s(76), borderRadius: radius.pill }} resizeMode="cover" />
              ) : (
                <View style={{ width: m.s(76), height: m.s(76), borderRadius: radius.pill, backgroundColor: colors.surface12, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: font.serif, fontSize: m.s(34), color: colors.text }}>{av.value}</Text>
                </View>
              )}
              <View>
                <Text style={{ fontFamily: font.serif, fontSize: m.s(32), color: colors.text }}>{name}</Text>
                {user.username ? <Text style={{ fontFamily: font.body, fontSize: m.s(22), color: colors.textFaint }}>@{user.username}</Text> : null}
              </View>
            </Pressable>
            <View style={{ height: 1, backgroundColor: colors.hairline, marginBottom: m.s(6) }} />
            {/* Switch profile — other saved accounts (instant, no re-login) + add a new one. */}
            {others.map((acc) => (
              <ProfileRow key={acc.token} account={acc} m={m} onPress={() => { switchAccount(acc.token); onClose(); }} />
            ))}
            <Row label="Add account" icon="person-add-outline" m={m} onPress={() => { onClose(); openLogin(); }} />
            <View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: m.s(6) }} />
            <Row label="Settings" icon="settings-outline" m={m} onPress={() => { onClose(); navigation.navigate('Settings'); }} />
            <Row label="Customize Home" icon="grid-outline" m={m} onPress={() => { onClose(); onCustomizeHome?.(); }} />
            <Row label="Log out" icon="log-out-outline" danger m={m} onPress={() => { logout(); onClose(); }} />
        </FocusTrap>
      ) : (
        <View style={styles.center}>
          <FocusTrap style={{ width: cardW, borderRadius: radius.panel, padding: cardPad, backgroundColor: 'rgba(20,24,33,0.98)', borderWidth: 1, borderColor: colors.hairline }}>
            <Text style={{ fontFamily: font.serif, fontSize: m.s(34), color: colors.text, marginBottom: m.s(18) }}>Choose your avatar</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: cellGap }}>
              {PRESET_AVATARS.map((src, i) => (
                <AvatarCell key={i} src={src as number} size={cellSize} selected={selected === i} autoFocus={selected === i} onPress={() => setSelected(i)} />
              ))}
            </View>
            <Pressable
              onFocus={() => setSaveFocused(true)}
              onBlur={() => setSaveFocused(false)}
              onPress={save}
              style={{ marginTop: m.s(22), alignSelf: 'stretch', alignItems: 'center', paddingVertical: m.s(13), borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: saveFocused ? colors.accent : 'transparent' }}
            >
              <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(24), color: '#000' }}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </FocusTrap>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  panel: { position: 'absolute', backgroundColor: 'rgba(20,24,33,0.98)', borderWidth: 1, borderColor: colors.hairline },
});
