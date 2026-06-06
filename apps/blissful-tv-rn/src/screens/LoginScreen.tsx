import { useNavigation } from '@react-navigation/native';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInput as RNTextInput,
} from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useAuth } from '../context/AuthContext';

function Field({
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
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textGhost}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        hasTVPreferredFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        blurOnSubmit={returnKeyType === 'go'}
        style={[styles.input, focused && styles.inputFocused]}
      />
    </View>
  );
}

function Btn({
  label,
  primary,
  onPress,
  busy,
}: {
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
      style={[
        styles.btn,
        primary ? styles.btnPrimary : styles.btnGhost,
        focused && styles.btnFocused,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.ink : colors.text} />
      ) : (
        <Text style={[styles.btnText, primary ? styles.btnTextPrimary : styles.btnTextGhost]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function LoginScreen() {
  const navigation = useNavigation();
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
      navigation.goBack();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>{isRegister ? 'Create account' : 'Login'}</Text>
        <Text style={styles.subtitle}>
          {isRegister
            ? 'Create a Blissful account to sync your library + Continue Watching.'
            : 'Sign in to sync your library + Continue Watching.'}
        </Text>

        <View style={styles.form}>
          <Field
            label={isRegister ? 'Username' : 'Username or email'}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={isRegister ? '3-50 chars: a-z 0-9 _ -' : undefined}
            autoFocus
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder={isRegister ? '8-50 characters' : undefined}
            secure
            inputRef={passwordRef}
            returnKeyType={isRegister ? 'next' : 'go'}
            onSubmitEditing={() => (isRegister ? confirmRef.current?.focus() : submit())}
          />
          {isRegister ? (
            <Field
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="repeat your password"
              secure
              inputRef={confirmRef}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <Btn label={isRegister ? 'Create account' : 'Login'} primary onPress={submit} busy={busy} />
          <Btn label="Cancel" onPress={() => navigation.goBack()} />
        </View>

        <Pressable
          onPress={() => {
            setMode(isRegister ? 'login' : 'register');
            setError(null);
          }}
          style={styles.toggleWrap}
        >
          {({ focused }) => (
            <Text style={[styles.toggle, focused && styles.toggleFocused]}>
              {isRegister ? 'Already have an account?  Login' : "Don't have an account?  Create account"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  card: {
    width: 520,
    borderRadius: radius.panel,
    padding: 28,
    backgroundColor: 'rgba(28,33,46,0.97)',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  title: { fontFamily: font.serif, fontSize: 30, color: colors.text },
  subtitle: { fontFamily: font.body, fontSize: 14, color: colors.textDim, marginTop: 6 },
  form: { marginTop: 22, gap: 14 },
  field: {},
  label: { fontFamily: font.body, fontSize: 13, color: colors.textDim, marginBottom: 6 },
  input: {
    fontFamily: font.body,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface10,
    borderRadius: radius.field,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputFocused: { borderColor: colors.accent },
  error: { fontFamily: font.bodyMed, fontSize: 14, color: colors.danger, marginTop: 14 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 22 },
  btn: {
    minWidth: 130,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  btnPrimary: { backgroundColor: colors.text },
  btnGhost: { backgroundColor: colors.surface10 },
  btnFocused: { borderColor: colors.accent },
  btnText: { fontFamily: font.bodySemi, fontSize: 16 },
  btnTextPrimary: { color: colors.ink },
  btnTextGhost: { color: colors.text },
  toggleWrap: { marginTop: 18 },
  toggle: { fontFamily: font.body, fontSize: 14, color: colors.textDim },
  toggleFocused: { color: colors.text, textDecorationLine: 'underline' },
});
