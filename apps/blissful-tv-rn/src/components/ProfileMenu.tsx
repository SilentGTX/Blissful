import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { BackHandler, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';
import { resolveAvatar } from '../lib/avatars';

function Row({
  label,
  icon,
  autoFocus,
  danger,
  m,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  autoFocus?: boolean;
  danger?: boolean;
  m: ReturnType<typeof useMetrics>;
  onPress: () => void;
}) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(16),
        paddingVertical: m.s(14),
        paddingHorizontal: m.s(18),
        borderRadius: m.s(14),
        backgroundColor: f ? colors.surface10 : 'transparent',
      }}
    >
      <Ionicons name={icon} size={m.s(30)} color={danger ? colors.danger : f ? colors.accent : colors.textDim} />
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(26), color: danger ? colors.danger : f ? colors.text : colors.textDim }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ProfileMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const m = useMetrics();
  const { user, logout } = useAuth();

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible || !user) return null;

  const name = user.displayName || user.username || 'You';
  const av = resolveAvatar(user.avatar, name.charAt(0).toUpperCase());

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="fade">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.panel, { top: m.safeY + m.topbarH + m.s(10), right: m.safeX, width: m.s(560), borderRadius: m.s(24), padding: m.s(16) }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(16), paddingHorizontal: m.s(8), paddingBottom: m.s(14), marginBottom: m.s(6), borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
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
        </View>
        <Row label="Settings" icon="settings-outline" autoFocus m={m} onPress={onClose} />
        <Row label="Customize Home" icon="grid-outline" m={m} onPress={onClose} />
        <Row label="Log out" icon="log-out-outline" danger m={m} onPress={() => { logout(); onClose(); }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { position: 'absolute', backgroundColor: 'rgba(20,24,33,0.98)', borderWidth: 1, borderColor: colors.hairline },
});
