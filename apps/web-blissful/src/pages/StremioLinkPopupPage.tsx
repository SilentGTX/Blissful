import { useEffect, useState } from 'react';
import { StremioLogo } from '../icons/StremioLogo';
import { prepareFacebookFlow } from '../lib/stremioFacebook';
import {
  exchangeStremioCredentialsForAuthKey,
  linkStremioWithToken,
} from '../lib/stremioLinkApi';

// Popup window page that links a user's Stremio account to Blissful.
// Opened from SettingsStremioPanel via window.open('/link-stremio', ...).
//
// Two sign-in methods, neither sending a password to Blissful's server:
//
//   A. Facebook (via Stremio): clicking "Continue with Facebook"
//      navigates THIS popup window to https://www.strem.io/login-fb/<state>.
//      The URL bar then shows strem.io and the user does FB login on
//      Stremio's actual page. Before navigating we postMessage the
//      opener (SettingsStremioPanel) with the state token — the opener
//      polls /login-fb-get-acc/<state>, converts the FB token to a
//      Stremio authKey browser-direct, stores it, then closes this
//      popup once we're on strem.io.
//
//   B. Email + password: form below POSTs DIRECTLY from this window to
//      api.strem.io/api/login. Verifiable in DevTools.
//
// Path B finishes by postMessage-ing the opener and auto-closing; path
// A finishes by the opener closing this window after it has the token.

const BLISSFUL_JWT_STORAGE_KEY = 'bliss:authToken';

type Phase = 'form' | 'submitting' | 'success' | 'error';

export default function StremioLinkPopupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-close countdown once linking succeeds. Gives the user a moment
  // to see the "Linked!" confirmation before the window disappears.
  const [closeIn, setCloseIn] = useState(2);
  useEffect(() => {
    if (phase !== 'success') return;
    if (closeIn <= 0) {
      try { window.close(); } catch { /* user-closed; ignore */ }
      return;
    }
    const id = window.setTimeout(() => setCloseIn((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, closeIn]);

  // Send the obtained authKey to Blissful and announce success to the
  // opener. Used by the email/password fallback path.
  async function persistAndAnnounce(authKey: string, stremioEmail: string) {
    const blissfulJwt = localStorage.getItem(BLISSFUL_JWT_STORAGE_KEY);
    if (!blissfulJwt) {
      throw new Error('You are not signed in to Blissful in this browser.');
    }
    await linkStremioWithToken(blissfulJwt, { authKey, email: stremioEmail });
    try {
      window.opener?.postMessage(
        { type: 'bliss:stremio-linked', email: stremioEmail },
        window.location.origin,
      );
    } catch {
      // No opener — fine, popup still closes; user can refresh Settings.
    }
    setPhase('success');
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage('Email and password required.');
      return;
    }
    setPhase('submitting');
    setErrorMessage(null);
    try {
      const creds = await exchangeStremioCredentialsForAuthKey({
        email: email.trim(),
        password,
        facebook: false,
      });
      await persistAndAnnounce(creds.authKey, creds.email);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Stremio login failed.');
      setPhase('error');
    }
  };

  // Navigate THIS popup window to Stremio's FB login page. Before
  // navigating, hand the state token to the opener (Settings panel) so
  // it can poll Stremio's /login-fb-get-acc/<state>, convert the FB
  // token to a Stremio authKey, store it, and close this window. Once
  // navigation happens our JS is gone — all the heavy lifting moves to
  // the parent.
  const handleFacebookClick = () => {
    if (!window.opener) {
      setErrorMessage(
        'Facebook sign-in needs to be triggered from Blissful Settings. ' +
          'Use email and password below instead.',
      );
      return;
    }
    const { state, stremioUrl } = prepareFacebookFlow();
    try {
      window.opener.postMessage(
        { type: 'bliss:fb-init', state },
        window.location.origin,
      );
    } catch {
      setErrorMessage('Could not signal Blissful Settings. Try email/password below.');
      return;
    }
    window.location.href = stremioUrl;
  };

  // Stremio's brand purple. Used for accents and the primary CTA so the
  // popup feels like it belongs to the linked service, not Blissful's
  // usual teal.
  const stremioPurple = '#7B5BF5';

  return (
    <div className="min-h-screen w-full bg-[#0a0a16] text-white flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div
            className="flex items-center justify-center"
            style={{ filter: `drop-shadow(0 10px 30px ${stremioPurple}55)` }}
          >
            <StremioLogo size={56} />
          </div>
          <div className="text-center">
            <div className="text-xl font-semibold tracking-wide">Sign in to Stremio</div>
            <div className="mt-1 text-xs text-white/55 leading-relaxed">
              Linking your account to Blissful for two-way library sync.
            </div>
          </div>
        </div>

        {phase === 'success' ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-6 text-center">
            <div className="text-emerald-300 text-lg font-semibold mb-1">Linked.</div>
            <div className="text-xs text-white/60">
              You can close this window. Closing automatically in {closeIn}s…
            </div>
            <button
              type="button"
              onClick={() => {
                try { window.close(); } catch { /* ignore */ }
              }}
              className="mt-4 rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
            >
              Close now
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Primary CTA: FB via Stremio. Navigates THIS popup to
                https://www.strem.io/login-fb/<state>, where the URL bar
                literally shows strem.io. Parent Blissful Settings tab
                handles the rest. */}
            <button
              type="button"
              onClick={handleFacebookClick}
              disabled={phase === 'submitting'}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ background: '#1877F2', boxShadow: '0 8px 24px #1877F255' }}
            >
              {/* Facebook glyph — inline SVG to avoid an extra fetch. */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
                aria-hidden
              >
                <path d="M13.5 21v-7.5h2.55l.38-3h-2.93V8.55c0-.86.24-1.45 1.48-1.45h1.58V4.43A21.4 21.4 0 0 0 14.27 4.2c-2.28 0-3.84 1.39-3.84 3.95v2.35H7.88v3h2.55V21h3.07Z" />
              </svg>
              Continue with Facebook
            </button>
            <div className="text-[11px] text-white/45 text-center -mt-1">
              This window will navigate to Stremio's official Facebook login page.
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-white/10" />
              <div className="text-[10px] uppercase tracking-widest text-white/35">or</div>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <form className="space-y-3" onSubmit={handlePasswordSubmit}>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1">
                  Stremio email
                </div>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={phase === 'submitting'}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[var(--stremio-accent)]"
                  style={{ '--stremio-accent': stremioPurple } as React.CSSProperties}
                />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1">
                  Stremio password
                </div>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={phase === 'submitting'}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[var(--stremio-accent)]"
                  style={{ '--stremio-accent': stremioPurple } as React.CSSProperties}
                />
              </div>

              <button
                type="submit"
                disabled={phase === 'submitting' || !email.trim() || !password}
                className="w-full rounded-full py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
                style={{ background: stremioPurple, boxShadow: `0 8px 24px ${stremioPurple}40` }}
              >
                {phase === 'submitting' ? 'Signing in…' : 'Sign in with email & password'}
              </button>
            </form>

            {errorMessage ? (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                try { window.close(); } catch { /* ignore */ }
              }}
              className="block mx-auto text-xs text-white/50 hover:text-white/70 underline-offset-2 hover:underline"
            >
              Cancel and return to Blissful
            </button>
          </div>
        )}

        <div className="mt-6 text-center text-[10px] uppercase tracking-widest text-white/30">
          Blissful · Stremio link
        </div>
      </div>
    </div>
  );
}
