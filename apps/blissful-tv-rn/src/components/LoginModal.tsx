// Login / Create-account modal — a centred in-tree overlay (NOT a routed screen),
// opened from anywhere via the loginStore (the home avatar, the TopBar avatar, the
// NavRail friends prompt, the Library empty state). Mirrors the web app, which
// renders one LoginModal at the shell root rather than navigating to a page.
// Rendered IN-TREE by NavRail (next to JoinPartyModal) so <FocusTrap> reliably
// traps the D-pad inside it; Cancel / hardware Back closes.
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInput as RNTextInput,
} from 'react-native';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';
import { FocusTrap } from './FocusTrap';

type M = ReturnType<typeof useMetrics>;

function Field({
  m,
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  autoFocus,
  inputRef,
  onSubmitEditing,
  returnKeyType,
}: {
  m: M;
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<RNTextInput | null>;
  onSubmitEditing?: () => void;
  returnKeyType?: 'next' | 'go';
}) {
  const [focused, setFocused] = useState(false);
  const localRef = useRef<RNTextInput | null>(null);
  const ref = inputRef ?? localRef;
  // Android TV: hasTVPreferredFocus on a bare TextInput does NOT grab D-pad focus
  // on mount (TextInputs only take focus on an explicit tap), so the field stays
  // unfocused and the FocusTrap has nothing to hold. Mirror JoinPartyModal: a
  // Pressable wrapper carries the D-pad focus + ring, and OK focuses the inner
  // TextInput so the soft keyboard opens for typing.
  return (
    <View>
      <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: 'rgba(255,255,255,0.6)', marginBottom: m.s(7) }}>{label}</Text>
      <Pressable
        hasTVPreferredFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => ref.current?.focus()}
        style={{
          backgroundColor: 'rgba(255,255,255,0.06)',
          borderRadius: m.s(12),
          borderWidth: m.s(2),
          borderColor: focused ? colors.accent : 'transparent',
          paddingHorizontal: m.s(16),
          minHeight: m.s(54),
          justifyContent: 'center',
        }}
      >
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.32)"
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          cursorColor={colors.accent}
          selectionColor={colors.accent}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          blurOnSubmit={returnKeyType === 'go'}
          style={{
            fontFamily: font.body,
            fontSize: m.s(17),
            color: colors.text,
            paddingVertical: m.s(10),
          }}
        />
      </Pressable>
    </View>
  );
}

function Btn({
  m,
  label,
  primary,
  onPress,
  busy,
}: {
  m: M;
  label: string;
  primary?: boolean;
  onPress: () => void;
  busy?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        minWidth: m.s(150),
        height: m.s(50),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: m.s(24),
        borderWidth: m.s(2),
        borderColor: focused ? colors.accent : 'transparent',
        backgroundColor: primary
          ? focused ? '#e6e9ff' : '#fff'
          : focused ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)',
      }}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.ink : colors.text} />
      ) : (
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(17), color: primary ? colors.ink : 'rgba(255,255,255,0.9)' }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function LoginModal({ onClose }: { onClose: () => void }) {
  const m = useMetrics();
  const { login, register } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordRef = useRef<RNTextInput | null>(null);
  const confirmRef = useRef<RNTextInput | null>(null);

  const isRegister = mode === 'register';

  // Hardware / remote Back closes the modal (same contract as JoinPartyModal).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const submit = async () => {
    setError(null);
    if (!identifier.trim() || !password) {
      setError('Field required');
      return;
    }
    if (isRegister) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match");
        return;
      }
    }
    setBusy(true);
    try {
      if (isRegister) await register(identifier.trim(), password);
      else await login(identifier.trim(), password);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.overlay}>
      <FocusTrap
        style={{
          width: m.s(620),
          borderRadius: m.s(24),
          padding: m.s(28),
          backgroundColor: 'rgba(16,17,22,0.98)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.10)',
        }}
      >
        <Text style={{ fontFamily: font.serif, fontSize: m.s(34), color: colors.text }}>{isRegister ? 'Create account' : 'Login'}</Text>
        <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: 'rgba(255,255,255,0.55)', marginTop: m.s(6) }}>
          {isRegister
            ? 'Create a Blissful account to sync your library + Continue Watching.'
            : 'Sign in to sync your library + Continue Watching.'}
        </Text>

        <View style={{ marginTop: m.s(22), gap: m.s(14) }}>
          <Field
            m={m}
            label={isRegister ? 'Username' : 'Username or email'}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={isRegister ? '3-50 chars: a-z 0-9 _ -' : undefined}
            autoFocus
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Field
            m={m}
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder={isRegister ? '8-50 characters' : undefined}
            secure
            inputRef={passwordRef}
            returnKeyType={isRegister ? 'next' : 'go'}
            // The keyboard's action key advances to confirm (register) or submits
            // (login) — but only when both fields are filled, so a stray IME action
            // during D-pad navigation is a no-op instead of flashing "Field required".
            // The Login button is the explicit submit that surfaces validation.
            onSubmitEditing={() => {
              if (isRegister) confirmRef.current?.focus();
              else if (identifier.trim() && password) submit();
            }}
          />
          {isRegister ? (
            <Field
              m={m}
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="repeat your password"
              secure
              inputRef={confirmRef}
              returnKeyType="go"
              onSubmitEditing={() => { if (identifier.trim() && password && confirm) submit(); }}
            />
          ) : null}
        </View>

        {error ? <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(14), color: '#f87171', marginTop: m.s(12) }}>{error}</Text> : null}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: m.s(12), marginTop: m.s(22) }}>
          <Btn m={m} label={isRegister ? 'Create account' : 'Login'} primary onPress={submit} busy={busy} />
          <Btn m={m} label="Cancel" onPress={onClose} />
        </View>

        <Pressable
          onPress={() => {
            setMode(isRegister ? 'login' : 'register');
            setError(null);
          }}
          style={{ marginTop: m.s(18) }}
        >
          {({ focused }) => (
            <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: focused ? colors.text : 'rgba(255,255,255,0.6)', textDecorationLine: focused ? 'underline' : 'none' }}>
              {isRegister ? 'Already have an account?  Login' : "Don't have an account?  Create account"}
            </Text>
          )}
        </Pressable>
      </FocusTrap>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 300,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
});
