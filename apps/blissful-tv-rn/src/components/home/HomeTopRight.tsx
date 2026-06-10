import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { findNodeHandle, Image, Pressable, Text, View } from 'react-native';
import { colors, font, radius } from '../../theme/colors';
import type { useMetrics } from '../../theme/metrics';
import { markContentFocus } from '../../lib/focusBus';
import { useRailOpen } from '../../lib/railStore';
import { useAuth } from '../../context/AuthContext';
import { resolveAvatar } from '../../lib/avatars';

type M = ReturnType<typeof useMetrics>;

function timeNow(): string {
  const d = new Date();
  const h = d.getHours();
  const min = d.getMinutes();
  return `${h < 10 ? `0${h}` : h}:${min < 10 ? `0${min}` : min}`; // 24-hour
}

// The design's top-right cluster: a live clock + the profile avatar (opens the
// account menu). isTVSelectable is gated on the rail so an open sidebar traps
// focus (same contract as the old TopBar avatar).
export function HomeTopRight({ m, onOpenProfile, onAvatarTag }: { m: M; onOpenProfile: () => void; onAvatarTag?: (tag: number | null) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const railOpen = useRailOpen();
  const [now, setNow] = useState(timeNow());
  const [focused, setFocused] = useState(false);
  // Publish the avatar's native node tag so the InfoPanel CTAs can route D-pad Up
  // here (the avatar is otherwise unreachable — Up from the band stops at the CTAs).
  const avatarRef = useRef<View>(null);
  useEffect(() => {
    const t = setTimeout(() => onAvatarTag?.(avatarRef.current ? findNodeHandle(avatarRef.current) : null), 300);
    return () => clearTimeout(t);
  }, [onAvatarTag]);

  useEffect(() => {
    const id = setInterval(() => setNow(timeNow()), 20000);
    return () => clearInterval(id);
  }, []);

  const initial = (user?.displayName || user?.username || '?').trim().charAt(0).toUpperCase();
  const av = user ? resolveAvatar(user.avatar, initial) : null;
  const sz = m.s(54);
  return (
    <View style={{ position: 'absolute', top: m.safeY, right: m.s(40), flexDirection: 'row', alignItems: 'center', gap: m.s(22), zIndex: 45 }}>
      <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(26), color: 'rgba(255,255,255,0.82)' }}>{now}</Text>
      <Pressable
        ref={avatarRef}
        isTVSelectable={!railOpen}
        onFocus={() => { setFocused(true); markContentFocus(false); }}
        onBlur={() => setFocused(false)}
        onPress={() => (user ? onOpenProfile() : navigation.navigate('Login'))}
        style={{ width: sz, height: sz }}
      >
        {av && av.kind === 'image' ? (
          <Image source={av.source} style={{ width: '100%', height: '100%', borderRadius: radius.pill, borderWidth: 2, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.22)' }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 2, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(124,144,176,0.20)', overflow: 'hidden' }}>
            {user ? (
              <Text style={{ fontFamily: font.serif, fontSize: m.s(24), color: colors.text }}>{av?.value ?? initial}</Text>
            ) : (
              <Ionicons name="person" size={m.s(28)} color={colors.text} />
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
}
