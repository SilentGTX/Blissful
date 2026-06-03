import { useCallback, useEffect, useRef, useState } from 'react';
import { FocusableButton } from '../spatial/FocusableButton';
import { notifySuccess, notifyWarning } from '../lib/toastQueues';
import {
  disconnectTrakt,
  getTraktUser,
  isTraktConnected,
  pollDeviceToken,
  requestDeviceCode,
  type DeviceCode,
  type TraktUser,
} from '../lib/traktApi';
import { isTraktConfigured } from '../lib/traktConfig';

// "Linked Accounts -> Trakt" panel for the Settings page. Mirrors
// SettingsStremioPanel.tsx (dark glassy pill buttons, status row, inline
// banners) but drives Trakt's TV-friendly DEVICE-CODE OAuth flow instead of
// an email/password form:
//
//   1. requestDeviceCode() -> { user_code, verification_url, interval, ... }
//   2. Render the user_code BIG + "go to trakt.tv/activate" (no QR lib in this
//      build, so it's large plain text the user types on another device).
//   3. Poll pollDeviceToken(device_code) every `interval` seconds until the
//      user authorises (status 'authorized' -> token already persisted), the
//      code expires/denies, etc.
//
// Everything is gated on isTraktConfigured(): when traktConfig.ts has no
// client_id/secret the panel shows a "paste your API keys" hint and NO connect
// button, and never calls the (no-op) API. The feature is fully inert until
// the user pastes their Trakt app credentials.

type Phase = 'idle' | 'requesting' | 'awaiting' | 'finalizing';

export function SettingsTraktPanel() {
  // `null` while we haven't read connection state yet (parity with the Stremio
  // panel's loadingStatus). Resolved synchronously from localStorage below.
  const [connected, setConnected] = useState<boolean | null>(null);
  const [user, setUser] = useState<TraktUser | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  // Poll loop guards. `pollTimer` is the pending setTimeout id; `cancelled`
  // short-circuits an in-flight poll whose component unmounted or whose flow
  // the user cancelled.
  const pollTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  // Absolute deadline (epoch ms) past which we stop polling — the device code's
  // own lifetime. Guards against an unbounded poll on a persistent 'error'
  // status (e.g. a missing prod /trakt proxy route, or a bad client_secret
  // returning an unlisted HTTP status).
  const pollDeadlineRef = useRef(0);

  const busy = phase !== 'idle';

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Read connection state + (if connected) the display name. No-ops cheaply
  // when not configured: isTraktConnected() is false and getTraktUser()
  // returns null without a network call.
  const refreshStatus = useCallback(async () => {
    if (!isTraktConfigured()) {
      setConnected(false);
      setUser(null);
      return;
    }
    const isConn = isTraktConnected();
    setConnected(isConn);
    if (!isConn) {
      setUser(null);
      return;
    }
    try {
      const u = await getTraktUser();
      setUser(u);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Tear down any pending poll on unmount.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      clearPollTimer();
    };
  }, [clearPollTimer]);

  // Step 2/3: the self-scheduling poll loop. It polls once, then re-arms a
  // setTimeout for the next poll (or finishes) based on the typed status.
  // `intervalMs` widens on 'slow_down' per Trakt's guidance. Stored in a ref
  // so the recursive `setTimeout` self-reference doesn't need a forward
  // declaration / circular useCallback dependency.
  const pollLoopRef = useRef<(deviceCode: string, intervalMs: number) => void>(() => {});

  pollLoopRef.current = (deviceCode: string, intervalMs: number) => {
    clearPollTimer();
    pollTimerRef.current = window.setTimeout(async () => {
      if (cancelledRef.current) return;
      if (Date.now() >= pollDeadlineRef.current) {
        clearPollTimer();
        setPhase('idle');
        setDevice(null);
        setActionError('The code expired before you authorized it. Try connecting again.');
        return;
      }
      const result = await pollDeviceToken(deviceCode);
      if (cancelledRef.current) return;
      switch (result.status) {
        case 'authorized': {
          clearPollTimer();
          setPhase('finalizing');
          setDevice(null);
          setActionInfo('Connected. Loading your Trakt profile…');
          await refreshStatus();
          if (cancelledRef.current) return;
          setPhase('idle');
          setActionInfo('Trakt connected.');
          notifySuccess('Trakt connected', 'Your watch history will now sync to Trakt.');
          return;
        }
        case 'pending':
          // User hasn't entered the code yet — keep waiting.
          pollLoopRef.current(deviceCode, intervalMs);
          return;
        case 'slow_down':
          // Back off: widen the interval by 1s and continue.
          pollLoopRef.current(deviceCode, intervalMs + 1000);
          return;
        case 'expired':
          clearPollTimer();
          setPhase('idle');
          setDevice(null);
          setActionError('The code expired before you authorized it. Try connecting again.');
          return;
        case 'denied':
          clearPollTimer();
          setPhase('idle');
          setDevice(null);
          setActionError('Authorization was denied on Trakt.');
          return;
        case 'used':
          clearPollTimer();
          setPhase('idle');
          setDevice(null);
          setActionError('That code was already used. Try connecting again.');
          return;
        case 'invalid':
          clearPollTimer();
          setPhase('idle');
          setDevice(null);
          setActionError('Trakt rejected the code. Try connecting again.');
          return;
        case 'error':
        default:
          // Transient/network error — keep polling rather than aborting the
          // whole flow over one bad request.
          pollLoopRef.current(deviceCode, intervalMs);
          return;
      }
    }, intervalMs);
  };

  // Step 1: ask Trakt for a device code, then start the poll loop.
  const handleConnect = useCallback(async () => {
    if (!isTraktConfigured() || busy) return;
    cancelledRef.current = false;
    setActionError(null);
    setActionInfo(null);
    setPhase('requesting');
    const code = await requestDeviceCode();
    if (cancelledRef.current) return;
    if (!code) {
      setPhase('idle');
      setActionError('Could not start the Trakt connection. Check your API keys and try again.');
      return;
    }
    setDevice(code);
    // Bound the poll loop by the device code's lifetime (default 10 min).
    pollDeadlineRef.current = Date.now() + (code.expires_in || 600) * 1000;
    setPhase('awaiting');
    // Trakt's interval is in seconds; convert to ms (default 5s if absent).
    const intervalMs = Math.max(1, code.interval || 5) * 1000;
    pollLoopRef.current(code.device_code, intervalMs);
  }, [busy]);

  // Cancel an in-progress device-code flow (before authorization completes).
  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    clearPollTimer();
    setDevice(null);
    setPhase('idle');
    setActionInfo(null);
    setActionError(null);
  }, [clearPollTimer]);

  const handleDisconnect = useCallback(() => {
    cancelledRef.current = true;
    clearPollTimer();
    disconnectTrakt();
    setConnected(false);
    setUser(null);
    setDevice(null);
    setPhase('idle');
    setActionError(null);
    setActionInfo('Trakt disconnected.');
    notifyWarning('Trakt disconnected');
  }, [clearPollTimer]);

  // Dark glassy pill button — matches the linked-accounts row mockup
  // (identical to SettingsStremioPanel's pillBtnClass).
  const pillBtnClass =
    'rounded-full border border-white/10 bg-white/[0.06] px-5 py-2 text-sm font-medium text-white transition hover:bg-white/[0.12] disabled:opacity-50';

  // Small inline Trakt mark — no PNG asset / icon component exists for Trakt
  // (unlike StremioLogo), so we render a self-contained circular monogram in
  // the brand red instead of importing a missing file.
  const traktMark = (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#ed1c24] text-[10px] font-bold uppercase tracking-wider text-white"
      aria-hidden
    >
      Tkt
    </div>
  );

  const configured = isTraktConfigured();

  // The connected user's display label (name, then @handle, then a fallback).
  const connectedLabel = user?.name || (user?.username ? `@${user.username}` : 'Connected');

  // Status sub-line under the title, mirroring the Stremio panel's secondary text.
  const statusLine = (() => {
    if (!configured) return 'Not configured';
    if (connected === null) return 'Loading...';
    if (connected) {
      return user?.username ? `${connectedLabel} · syncing` : `${connectedLabel}`;
    }
    return 'Not connected';
  })();

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {traktMark}
        <div className="flex min-w-0 flex-col">
          <div className="text-sm font-medium leading-tight">Trakt</div>
          <div className="truncate text-xs text-foreground/55">{statusLine}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {!configured ? null : connected === null ? null : connected ? (
            <FocusableButton
              className={pillBtnClass}
              onPress={handleDisconnect}
              disabled={busy}
              focusableTv={!busy}
            >
              Disconnect
            </FocusableButton>
          ) : phase === 'idle' ? (
            <FocusableButton className={pillBtnClass} onPress={() => void handleConnect()}>
              Connect Trakt
            </FocusableButton>
          ) : (
            <FocusableButton className={pillBtnClass} onPress={handleCancel}>
              Cancel
            </FocusableButton>
          )}
        </div>
      </div>

      {/* Not-configured hint: tell the user where to paste their API keys. */}
      {!configured ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground/70">
          Add your Trakt API keys in{' '}
          <span className="font-mono text-foreground/90">src/lib/traktConfig.ts</span> to enable
          Trakt sync. Create an app at{' '}
          <a
            href="https://trakt.tv/oauth/applications"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--bliss-accent)] underline-offset-2 hover:underline"
          >
            trakt.tv → Settings → Your API Apps
          </a>{' '}
          and paste the Client ID + Client Secret.
        </div>
      ) : null}

      {/* Device-code activation card: BIG code + the activation URL + spinner.
          Shown while we're requesting or awaiting authorization. */}
      {configured && (phase === 'requesting' || phase === 'awaiting' || phase === 'finalizing') ? (
        <div className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-5 text-center">
          {phase === 'requesting' ? (
            <div className="flex items-center gap-2 text-sm text-foreground/70">
              <Spinner />
              Starting…
            </div>
          ) : device ? (
            <>
              <div className="text-xs uppercase tracking-wide text-foreground/55">
                On your phone or computer, go to
              </div>
              <a
                href={device.verification_url}
                target="_blank"
                rel="noreferrer"
                className="text-lg font-semibold text-[var(--bliss-accent)] underline-offset-2 hover:underline"
              >
                {device.verification_url}
              </a>
              <div className="text-xs uppercase tracking-wide text-foreground/55">
                and enter this code
              </div>
              <div className="select-all font-mono text-4xl font-bold tracking-[0.25em] text-white">
                {device.user_code}
              </div>
              <div className="flex items-center gap-2 text-xs text-foreground/55">
                <Spinner />
                Waiting for you to authorize…
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-foreground/70">
              <Spinner />
              Finishing up…
            </div>
          )}
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {actionError}
        </div>
      ) : null}
      {actionInfo ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground/70">
          {actionInfo}
        </div>
      ) : null}
    </div>
  );
}

// Minimal CSS spinner (no extra dependency) — a spinning ring in the accent
// color, matching the panel's "waiting" affordance.
function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-[var(--bliss-accent)]"
      aria-hidden
    />
  );
}
