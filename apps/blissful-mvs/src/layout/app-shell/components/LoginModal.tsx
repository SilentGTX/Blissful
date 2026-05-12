import { Button, Input, Modal } from '@heroui/react';
import { useEffect, useState } from 'react';
import type { StremioApiUser } from '../../../lib/stremioApi';
import { loginWithEmail, registerWithEmail } from '../../../lib/stremioApi';
import { getSavedAccounts } from '../../../lib/savedAccounts';
import { loginWithFacebookPopup } from '../../../lib/stremioFacebook';
import { useErrorToast } from '../../../lib/useErrorToast';
import { notifySuccess } from '../../../lib/toastQueues';

type LoginModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthSuccess: (authKey: string, user: StremioApiUser) => void;
  forcedErrorMessage?: string | null;
  forcedEmail?: string | null;
};

export function LoginModal({
  isOpen,
  onOpenChange,
  onAuthSuccess,
  forcedErrorMessage,
  forcedEmail,
}: LoginModalProps) {
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [fbLoading, setFbLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  const resolveLoginIdentifier = (input: string): string => {
    const value = input.trim();
    if (!value) return value;
    if (value.includes('@')) return value;

    const normalized = value.toLowerCase();
    const saved = getSavedAccounts();
    const match = saved.find((account) => {
      const displayName = account.displayName?.trim().toLowerCase();
      const email = account.email?.trim().toLowerCase();
      const emailUser = email?.split('@')[0] ?? '';
      return displayName === normalized || email === normalized || emailUser === normalized;
    });

    return match?.email ?? value;
  };

  useErrorToast(authError, 'Login failed');

  useEffect(() => {
    if (!isOpen) return;
    setAuthError(null);
    setIsRegisterMode(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!forcedErrorMessage) return;
    setAuthError(forcedErrorMessage);
  }, [forcedErrorMessage, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!forcedEmail) return;
    setLoginEmail(forcedEmail);
  }, [forcedEmail, isOpen]);

  // Hard short-circuit: don't render anything when isOpen is false.
  // HeroUI Modal.Backdrop's `isOpen` prop apparently isn't enough to
  // fully unmount in this version — the dialog stays painted after the
  // prop flips to false. Returning null here pulls the whole DOM
  // subtree, so the modal is definitively gone.
  if (!isOpen) return null;

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="blur"
        className="bg-black/50"
      >
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only"><Modal.Heading>Login</Modal.Heading></Modal.Header>
            <Modal.Body className="px-0">
              <div className="solid-surface mx-auto w-full rounded-[28px] bg-white/10 p-6">
                <div className="font-[Fraunces] text-2xl font-semibold tracking-tight">
                  {isRegisterMode ? 'Create account' : 'Login'}
                </div>
                <div className="mt-1 text-sm text-foreground/70">
                  {isRegisterMode
                    ? 'Create a Stremio account to sync Continue Watching.'
                    : 'Sign in to sync Continue Watching.'}
                </div>

                {!isRegisterMode ? (
                  <>
                    <div className="mt-5">
                      <Button
                        variant="ghost"
                        className="w-full rounded-full bg-white/10"
                        isPending={fbLoading}
                        onPress={async () => {
                          try {
                            setAuthError(null);
                            setFbLoading(true);
                            const creds = await loginWithFacebookPopup();
                            const result = await loginWithEmail({
                              email: creds.email,
                              password: creds.fbLoginToken,
                              facebook: true,
                            });
                            localStorage.setItem('stremioAuthKey', result.authKey);
                            localStorage.setItem('stremioUser', JSON.stringify(result.user));
                            onAuthSuccess(result.authKey, result.user);
                            notifySuccess('Login successful', 'Welcome back. Your account is synced.');
                            onOpenChange(false);
                          } catch (err: unknown) {
                            setAuthError(err instanceof Error ? err.message : 'Facebook login failed');
                          } finally {
                            setFbLoading(false);
                          }
                        }}
                      >
                        Continue with Facebook
                      </Button>
                    </div>

                    <div className="my-5 flex items-center gap-3">
                      <div className="h-px flex-1 bg-white/10" />
                      <div className="text-xs text-foreground/50">or</div>
                      <div className="h-px flex-1 bg-white/10" />
                    </div>
                  </>
                ) : null}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      setAuthError(null);
                      setAuthLoading(true);
                      if (isRegisterMode && loginPassword !== registerPasswordConfirm) {
                        throw new Error('Passwords do not match');
                      }

                      const loginValue = loginEmail.trim();
                      let result;
                      if (isRegisterMode) {
                        result = await registerWithEmail({
                          email: loginValue,
                          password: loginPassword,
                        });
                      } else {
                        const attempts = Array.from(
                          new Set([resolveLoginIdentifier(loginValue), loginValue].filter((v) => v.length > 0))
                        );
                        let lastError: unknown = null;
                        let loginResult: Awaited<ReturnType<typeof loginWithEmail>> | null = null;
                        for (const emailAttempt of attempts) {
                          try {
                            loginResult = await loginWithEmail({
                              email: emailAttempt,
                              password: loginPassword,
                            });
                            break;
                          } catch (err: unknown) {
                            lastError = err;
                          }
                        }
                        if (!loginResult) {
                          throw (lastError instanceof Error ? lastError : new Error('Login failed'));
                        }
                        result = loginResult;
                      }

                      localStorage.setItem('stremioAuthKey', result.authKey);
                      localStorage.setItem('stremioUser', JSON.stringify(result.user));
                      onAuthSuccess(result.authKey, result.user);
                      notifySuccess(
                        isRegisterMode ? 'Account created' : 'Login successful',
                        isRegisterMode
                          ? 'Your Stremio account was created and signed in.'
                          : 'Welcome back. Your account is synced.'
                      );
                      onOpenChange(false);
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
                  }}
                >
                  <div className="mt-6 space-y-3">
                    <div>
                      <label className="text-sm text-foreground/70">Email or username</label>
                      <Input
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        type="text"
                        className="mt-1 w-full bg-white/10 rounded-xl px-4 py-2"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-foreground/70">Password</label>
                      <Input
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        type="password"
                        className="mt-1 w-full bg-white/10 rounded-xl px-4 py-2"
                      />
                    </div>

                    {isRegisterMode ? (
                      <div>
                        <label className="text-sm text-foreground/70">Confirm password</label>
                        <Input
                          value={registerPasswordConfirm}
                          onChange={(e) => setRegisterPasswordConfirm(e.target.value)}
                          type="password"
                          className="mt-1 w-full bg-white/10 rounded-xl px-4 py-2"
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <Button
                      type="submit"
                      className="rounded-full bg-white text-black"
                      isPending={authLoading}
                      isDisabled={fbLoading}
                    >
                      {isRegisterMode ? 'Create account' : 'Login'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="rounded-full bg-white/10"
                      onPress={() => onOpenChange(false)}
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
                </form>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
