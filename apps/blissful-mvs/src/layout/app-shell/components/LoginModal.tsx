// Username + password login / register modal. Validation is HeroUI's
// idiomatic Form + TextField pattern: each field has its own
// `validate` callback that returns the error string (or null), and
// the parent <Form> gates submission until every field passes. We
// only see the modal's `onSubmit` callback fire on a clean form.
//
// Reads modal state from useModals() so any caller can `openLogin()`
// and have this thing appear without prop drilling.

import { Button, FieldError, Form, Input, Label, Modal, TextField } from '@heroui/react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthProvider';
import { useModals } from '../../../context/ModalsProvider';
import { useErrorToast } from '../../../lib/useErrorToast';
import { notifySuccess } from '../../../lib/toastQueues';

const USERNAME_RE = /^[a-z0-9_-]{3,50}$/;

// Shared className for every Input. The data-[invalid=true] overrides
// are necessary because our `bg-white/10 rounded-xl px-4 py-2` styling
// otherwise overrides HeroUI's default `.input[data-invalid]` red ring.
const INPUT_CLASS =
  'mt-1 w-full bg-white/10 rounded-xl px-4 py-2 ' +
  'data-[invalid=true]:!border-danger ' +
  'data-[invalid=true]:!ring-1 ' +
  'data-[invalid=true]:!ring-danger/40';

const LABEL_CLASS = 'text-sm text-foreground/70';

export function LoginModal() {
  const modals = useModals();
  const { login, register } = useAuth();

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // On login the field accepts either a username or (for legacy
  // accounts) an email — same input box, server picks the lookup
  // based on whether "@" is present.
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('');
  const [registerUsername, setRegisterUsername] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  useErrorToast(authError, isRegisterMode ? 'Registration failed' : 'Login failed');

  // Reset state every time the modal opens, then apply any forced
  // identifier / error the caller passed via the modals provider.
  useEffect(() => {
    if (!modals.isLoginOpen) {
      setLoginIdentifier('');
      setLoginPassword('');
      setRegisterPasswordConfirm('');
      setRegisterUsername('');
      setAuthError(null);
      setIsRegisterMode(false);
      return;
    }
    if (modals.loginPrefillEmail) setLoginIdentifier(modals.loginPrefillEmail);
    if (modals.loginForcedError) setAuthError(modals.loginForcedError);
  }, [modals.isLoginOpen, modals.loginPrefillEmail, modals.loginForcedError]);

  // Hard short-circuit — HeroUI Modal.Backdrop's `isOpen` doesn't fully
  // unmount the dialog DOM, so we gate at the top level too.
  if (!modals.isLoginOpen) return null;

  const handleOpenChange = (open: boolean) => {
    if (!open) modals.closeLogin();
  };

  // Validators. Each returns the error message to show, or null when
  // the value is fine. Used as TextField's `validate` prop so HeroUI
  // wires the FieldError + red invalid state for us.
  const validateRegisterUsername = (value: string): string | null => {
    const v = value.trim().toLowerCase();
    if (!v) return 'Field required';
    if (!USERNAME_RE.test(v)) return '3-50 chars: lowercase a-z, 0-9, _ -';
    return null;
  };
  const validateLoginIdentifier = (value: string): string | null => {
    if (!value.trim()) return 'Field required';
    return null;
  };
  const validatePassword = (value: string): string | null => {
    if (!value) return 'Field required';
    if (isRegisterMode && value.length < 8) return 'At least 8 characters';
    if (isRegisterMode && value.length > 50) return 'Max 50 characters';
    return null;
  };
  const validateConfirm = (value: string): string | null => {
    if (!value) return 'Field required';
    if (value !== loginPassword) return "Passwords don't match";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Form's `validationBehavior="native"` (default) means we only
    // get here when every TextField's `validate` returned null. No
    // pre-flight re-checks needed.
    setAuthError(null);
    try {
      setAuthLoading(true);
      if (isRegisterMode) {
        const username = registerUsername.trim().toLowerCase();
        await register({ username, password: loginPassword });
        notifySuccess('Account created', 'Welcome to Blissful.');
        modals.closeLogin();
        // Fresh account → drop the user straight into the "Who's
        // watching?" profile picker so they can pick a display
        // name + avatar.
        modals.openProfilePrompt(username);
        return;
      }
      const result = await login(loginIdentifier.trim(), loginPassword);
      notifySuccess('Login successful', 'Welcome back. Your library is syncing.');
      modals.closeLogin();
      // If the user hasn't picked an avatar yet, open the picker
      // now so they can finish onboarding. `avatar == null`
      // reliably means "never been through the picker".
      if (!result.user.avatar) {
        const fallbackish = result.user.username || result.user.email || '';
        const initial =
          result.user.displayName && result.user.displayName !== fallbackish
            ? result.user.displayName
            : '';
        modals.openProfilePrompt(initial);
      }
    } catch (err: unknown) {
      setAuthError(
        err instanceof Error
          ? err.message
          : isRegisterMode
            ? 'Registration failed'
            : 'Login failed'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={modals.isLoginOpen}
        onOpenChange={handleOpenChange}
        variant="blur"
        className="bg-black/50"
      >
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only"><Modal.Heading>Login</Modal.Heading></Modal.Header>
            <Modal.Body className="px-0">
              <div className="solid-surface mx-auto w-full rounded-[28px] bg-white/10 p-6">
                <div className="font-[Instrument_Serif] text-2xl font-semibold tracking-tight">
                  {isRegisterMode ? 'Create account' : 'Login'}
                </div>
                <div className="mt-1 text-sm text-foreground/70">
                  {isRegisterMode
                    ? 'Create a Blissful account to sync your library + Continue Watching.'
                    : 'Sign in to sync your library + Continue Watching.'}
                </div>

                <Form onSubmit={handleSubmit}>
                  <div className="mt-6 w-full space-y-3">
                    {isRegisterMode ? (
                      <TextField
                        isRequired
                        validate={validateRegisterUsername}
                        value={registerUsername}
                        onChange={setRegisterUsername}
                        name="username"
                        className="w-full"
                      >
                        <Label className={LABEL_CLASS}>Username</Label>
                        <Input
                          type="text"
                          autoComplete="username"
                          placeholder="3-50 chars: a-z 0-9 _ -"
                          maxLength={50}
                          className={INPUT_CLASS}
                        />
                        <FieldError />
                      </TextField>
                    ) : (
                      <TextField
                        isRequired
                        validate={validateLoginIdentifier}
                        value={loginIdentifier}
                        onChange={setLoginIdentifier}
                        name="username"
                        className="w-full"
                      >
                        <Label className={LABEL_CLASS}>Username</Label>
                        <Input
                          type="text"
                          autoComplete="username"
                          // No maxLength on login — legacy accounts can
                          // still log in with their email which is
                          // routinely longer than 20 chars.
                          className={INPUT_CLASS}
                        />
                        <FieldError />
                      </TextField>
                    )}

                    <TextField
                      isRequired
                      validate={validatePassword}
                      value={loginPassword}
                      onChange={setLoginPassword}
                      type="password"
                      name="password"
                      className="w-full"
                    >
                      <Label className={LABEL_CLASS}>Password</Label>
                      <Input
                        autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                        // 40-char cap only when creating an account.
                        // Login stays unbounded so users with longer
                        // passwords from the legacy email flow can
                        // still sign in.
                        maxLength={isRegisterMode ? 50 : undefined}
                        placeholder={isRegisterMode ? '8-50 characters' : undefined}
                        className={INPUT_CLASS}
                      />
                      <FieldError />
                    </TextField>

                    {isRegisterMode ? (
                      <TextField
                        isRequired
                        validate={validateConfirm}
                        value={registerPasswordConfirm}
                        onChange={setRegisterPasswordConfirm}
                        type="password"
                        name="confirmPassword"
                        className="w-full"
                      >
                        <Label className={LABEL_CLASS}>Confirm password</Label>
                        <Input
                          autoComplete="new-password"
                          maxLength={50}
                          placeholder="repeat your password"
                          className={INPUT_CLASS}
                        />
                        <FieldError />
                      </TextField>
                    ) : null}
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <Button
                      type="submit"
                      className="rounded-full bg-white text-black"
                      isPending={authLoading}
                    >
                      {isRegisterMode ? 'Create account' : 'Login'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="rounded-full bg-white/10"
                      onPress={() => modals.closeLogin()}
                    >
                      Cancel
                    </Button>
                  </div>

                  <div className="mt-4 text-sm text-foreground/70">
                    {isRegisterMode ? 'Already have an account?' : "Don't have an account?"}{' '}
                    <button
                      type="button"
                      className="cursor-pointer text-white underline underline-offset-4"
                      onClick={() => {
                        setAuthError(null);
                        setIsRegisterMode((prev) => !prev);
                      }}
                    >
                      {isRegisterMode ? 'Login' : 'Create account'}
                    </button>
                  </div>
                </Form>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
