// Join-by-code overlay opened from the "Join Party" nav item. Code -> optional
// password -> resolve a stream for the room's title -> open the player in that
// room. Self-contained native focus + FocusTrap; Back/Cancel closes.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, TextInput, View, type TextInput as RNTextInput } from 'react-native';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { FocusTrap } from './FocusTrap';
import { useToast } from './Toast';
import { joinWatchPartyRoom } from '../lib/joinWatchParty';
import {
  formatRoomCodeInput,
  getWatchPartyRoom,
  isValidRoomCode,
  ROOM_CODE_LENGTH,
  stashWatchPartyPassword,
  verifyWatchPartyPassword,
  type WatchPartyRoomInfo,
} from '../lib/watchParty';

const ACCENT = '#95a2ff';
type M = ReturnType<typeof useMetrics>;

export function JoinPartyModal({ token, onClose }: { token: string | null; onClose: () => void }) {
  const m = useMetrics();
  const toast = useToast();
  const [step, setStep] = useState<{ kind: 'code' } | { kind: 'password'; room: WatchPartyRoomInfo }>({ kind: 'code' });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const go = async (room: WatchPartyRoomInfo) => {
    setBusy(true);
    const res = await joinWatchPartyRoom(token, room);
    if (!res.ok) { setError(res.reason ?? 'Could not join. Try again.'); setBusy(false); return; }
    onClose();
  };
  const submitCode = async () => {
    if (!isValidRoomCode(code) || busy) return;
    setBusy(true); setError(null);
    try {
      const room = await getWatchPartyRoom(code);
      if (!room) { setError('No room with that code.'); setBusy(false); return; }
      if (room.hasPassword) { setStep({ kind: 'password', room }); setBusy(false); return; }
      await go(room);
    } catch { setError('Lookup failed. Try again.'); setBusy(false); }
  };
  const submitPassword = async () => {
    if (step.kind !== 'password' || busy) return;
    setBusy(true); setError(null);
    try {
      const ok = await verifyWatchPartyPassword(step.room.code, password);
      if (!ok) { setError('Wrong password.'); setBusy(false); return; }
      stashWatchPartyPassword(step.room.code, password);
      await go(step.room);
    } catch { setError('Could not verify.'); setBusy(false); }
  };

  return (
    <View style={styles.overlay}>
      <FocusTrap style={{ width: m.s(440), borderRadius: m.s(24), borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(16,17,22,0.98)', padding: m.s(22), gap: m.s(12) }}>
        <Text style={{ fontFamily: font.serif, fontSize: m.s(30), color: '#fff' }}>Join a watch party</Text>
        {step.kind === 'code' ? (
          <>
            <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: 'rgba(255,255,255,0.6)' }}>Enter the code your friend shared.</Text>
            <Input m={m} value={code} onChange={(t) => setCode(formatRoomCodeInput(t))} placeholder="xxx-yyy" autoFocus center mono maxLength={ROOM_CODE_LENGTH} onSubmit={submitCode} />
            {error ? <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: '#f87171' }}>{error}</Text> : null}
            <Btn m={m} label={busy ? 'Looking up...' : 'Continue'} primary disabled={busy || !isValidRoomCode(code)} onPress={submitCode} />
          </>
        ) : (
          <>
            <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: 'rgba(255,255,255,0.7)' }}>Room {step.room.code.toUpperCase()} is password-protected.</Text>
            <Input m={m} value={password} onChange={setPassword} placeholder="Room password" autoFocus onSubmit={submitPassword} />
            {error ? <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: '#f87171' }}>{error}</Text> : null}
            <Btn m={m} label={busy ? 'Verifying...' : 'Join'} primary disabled={busy || !password.trim()} onPress={submitPassword} />
          </>
        )}
        <Btn m={m} label="Cancel" onPress={onClose} />
      </FocusTrap>
    </View>
  );
}

function Input({ m, value, onChange, placeholder, autoFocus, center, mono, maxLength, onSubmit }: { m: M; value: string; onChange: (t: string) => void; placeholder?: string; autoFocus?: boolean; center?: boolean; mono?: boolean; maxLength?: number; onSubmit?: () => void }) {
  const [f, setF] = useState(false);
  const ref = useRef<RNTextInput | null>(null);
  return (
    <Pressable hasTVPreferredFocus={autoFocus} onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={() => ref.current?.focus()}
      style={{ borderRadius: m.s(12), borderWidth: m.s(2), borderColor: f ? ACCENT : 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: m.s(14), minHeight: m.s(52), justifyContent: 'center' }}>
      <TextInput ref={ref} value={value} onChangeText={onChange} onFocus={() => setF(true)} onBlur={() => setF(false)} onSubmitEditing={onSubmit} placeholder={placeholder} placeholderTextColor="rgba(255,255,255,0.35)" maxLength={maxLength} autoCapitalize="none" autoCorrect={false}
        style={{ fontFamily: font.body, fontSize: m.s(mono ? 26 : 18), letterSpacing: mono ? m.s(8) : 0, textAlign: center ? 'center' : 'left', color: '#fff', paddingVertical: m.s(10) }} />
    </Pressable>
  );
}

function Btn({ m, label, primary, disabled, onPress }: { m: M; label: string; primary?: boolean; disabled?: boolean; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable disabled={disabled} onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={onPress}
      style={{ alignItems: 'center', borderRadius: 999, paddingVertical: m.s(13), backgroundColor: primary ? (disabled ? 'rgba(255,255,255,0.15)' : f ? '#e6e9ff' : '#fff') : f ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)', opacity: disabled ? 0.5 : 1, borderWidth: m.s(2), borderColor: f ? ACCENT : 'transparent' }}>
      {label.endsWith('...') ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}><ActivityIndicator size="small" color={primary ? '#000' : '#fff'} /><Text style={{ fontFamily: font.bodySemi, fontSize: m.s(15), color: primary ? '#000' : '#fff' }}>{label}</Text></View>
      ) : (
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(15), color: primary ? '#000' : 'rgba(255,255,255,0.85)' }}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 250, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)' },
});
