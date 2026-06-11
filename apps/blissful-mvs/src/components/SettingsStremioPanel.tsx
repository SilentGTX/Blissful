import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthProvider';
import { StremioLogo } from '../icons/StremioLogo';
import { pollFacebookCredentials } from '../lib/stremioFacebook';
import {
  exchangeStremioCredentialsForAuthKey,
  fetchStremioLinkStatus,
  linkStremioWithToken,
  setStremioLinked,
  syncStremioNow,
  unlinkStremioAccount,
  type StremioLinkStatus,
} from '../lib/stremioLinkApi';

// "Linked Accounts → Stremio" panel for the Settings page. Backed by
// /stremio/{link-token,unlink,status,sync} on blissful-storage; the server
// runs a 15-min cron that mirrors Stremio's library ↔ Blissful's library
// so progress from the official Stremio app shows up in Continue
// Watching, and vice versa.
//
// Sign-in flow: opens /link-stremio in a popup. Two paths from there:
//
//   - Email/password — the popup runs the exchange itself, posts the
//     resulting authKey to /stremio/link-token, postMessages us
//     `bliss:stremio-linked` and auto-closes.
//
//   - Facebook — the popup postMessages us `bliss:fb-init` with a state
//     token, then navigates ITSELF to www.strem.io/login-fb/<state>
//     (URL bar shows strem.io). We poll Stremio from this tab, convert
//     the FB token to a Stremio authKey via api.strem.io/api/login
//     (browser-direct, password-free), store it via /stremio/link-token,
//     and close the popup.

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 640;

function relativeTime(ms: number | null): string {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 30_000) return 'just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function SettingsStremioPanel() {
  const { authKey } = useAuth();
  const [status, setStatus] = useState<StremioLinkStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!authKey) {
      setStatus(null);
      setLoadingStatus(false);
      return;
    }
    try {
      const next = await fetchStremioLinkStatus(authKey);
      setStatus(next);
      setStremioLinked(next.linked);
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, [authKey]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Drive the FB flow from this tab: poll Stremio for the FB
  // credentials, convert them to a Stremio authKey browser-direct, push
  // only the authKey to blissful-storage, then close the popup window
  // (which is by now sitting on strem.io's login page).
  const completeFacebookFlow = useCallback(
    async (state: string) => {
      if (!authKey) return;
      setBusy(true);
      setActionError(null);
      setActionInfo('Waiting for you to finish on Stremio…');
      // If the user closes the popup mid-flow, abort polling instead of
      // waiting out the ~2-min timeout. We can read popupRef.current.closed
      // even across origins (after the popup navigates to strem.io) — it's
      // one of the few cross-origin Window properties browsers allow.
      const controller = new AbortController();
      const closedTicker = window.setInterval(() => {
        if (popupRef.current?.closed) {
          controller.abort();
          window.clearInterval(closedTicker);
        }
      }, 1000);
      try {
        const fbCreds = await pollFacebookCredentials(state, { signal: controller.signal });
        const creds = await exchangeStremioCredentialsForAuthKey({
          email: fbCreds.email,
          password: fbCreds.fbLoginToken,
          facebook: true,
        });
        await linkStremioWithToken(authKey, { authKey: creds.authKey, email: creds.email });
        setActionInfo(`Linked as ${creds.email}.`);
        if (popupRef.current && !popupRef.current.closed) {
          try { popupRef.current.close(); } catch { /* cross-origin or already gone */ }
        }
        await refreshStatus();
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Facebook sign-in failed');
      } finally {
        window.clearInterval(closedTicker);
        setBusy(false);
      }
    },
    [authKey, refreshStatus],
  );

  // Listen for the popup's messages. Same-origin check is critical: without
  // it, any other tab on the web could postMessage us and trigger a false
  // "linked" state.
  //   `bliss:stremio-linked`  — email/password path finished in the popup
  //   `bliss:fb-init`         — popup is about to navigate to strem.io;
  //                              we drive the rest from here
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; email?: string; state?: string } | null;
      if (!data) return;
      if (data.type === 'bliss:stremio-linked') {
        setActionInfo(`Linked as ${data.email ?? 'your Stremio account'}.`);
        setActionError(null);
        void refreshStatus();
      } else if (data.type === 'bliss:fb-init' && typeof data.state === 'string') {
        void completeFacebookFlow(data.state);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refreshStatus, completeFacebookFlow]);

  const openLinkPopup = () => {
    if (!authKey) return;
    setActionError(null);
    setActionInfo(null);
    const left = Math.max(0, Math.round((window.screen.availWidth - POPUP_WIDTH) / 2));
    const top = Math.max(0, Math.round((window.screen.availHeight - POPUP_HEIGHT) / 2));
    const features = `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},resizable=yes,scrollbars=yes`;
    // Path is /link-stremio (not /stremio-link): Vite dev proxy and
    // Traefik prod both catch /stremio* and forward to www.strem.io,
    // so a /stremio-* path 404s on the Stremio site.
    const win = window.open('/link-stremio', 'bliss-stremio-link', features);
    if (!win) {
      setActionError('Pop-up blocked. Allow pop-ups for this site and try again.');
      return;
    }
    popupRef.current = win;
    try { win.focus(); } catch { /* ignore */ }
  };

  const handleUnlink = async () => {
    if (!authKey || busy) return;
    setBusy(true);
    setActionError(null);
    setActionInfo(null);
    try {
      await unlinkStremioAccount(authKey);
      setActionInfo('Stremio account unlinked.');
      await refreshStatus();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Unlink failed');
    } finally {
      setBusy(false);
    }
  };

  // Anti-spam cooldown for the manual "Sync now" button. Independent
  // from the module-level cooldown in stremioLinkApi (which gates the
  // home-page auto-trigger) so a recent auto-sync doesn't lock the user
  // out of an explicit click.
  const SYNC_BUTTON_COOLDOWN_MS = 30_000;
  const [syncCooldownUntil, setSyncCooldownUntil] = useState(0);
  const [tickMs, setTickMs] = useState(() => Date.now());
  useEffect(() => {
    if (syncCooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => setTickMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [syncCooldownUntil]);
  const syncCooldownSecondsLeft = Math.max(
    0,
    Math.ceil((syncCooldownUntil - tickMs) / 1000),
  );
  const syncOnCooldown = syncCooldownSecondsLeft > 0;

  const handleSync = async () => {
    if (!authKey || busy || syncOnCooldown) return;
    setBusy(true);
    setActionError(null);
    setActionInfo(null);
    try {
      const result = await syncStremioNow(authKey);
      setActionInfo(`Sync done. Pulled ${result.pulled}, pushed ${result.pushed}.`);
      await refreshStatus();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
      setSyncCooldownUntil(Date.now() + SYNC_BUTTON_COOLDOWN_MS);
    }
  };

  // Dark glassy pill button — matches the linked-accounts row mockup
  // (subtle border, no Blissful accent). Keeps the row reading as
  // "service + action" rather than a Blissful CTA.
  const pillBtnClass =
    'rounded-full border border-white/10 bg-white/[0.06] px-5 py-2 text-sm font-medium text-white transition hover:bg-white/[0.12] disabled:opacity-50';

  if (!authKey) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-3">
          <StremioLogo size={32} />
          <div className="text-sm font-medium">Stremio Sync</div>
          <div className="ml-auto text-xs text-foreground/50">Sign in to Blissful first</div>
        </div>
      </div>
    );
  }

  // Compact single-row layout:
  //   [logo] Stremio Sync                     [Authenticate]      (unlinked)
  //   [logo] Stremio Sync · foo@bar · 2m ago  [Sync now] [Unlink] (linked)
  // Errors / info banners drop below the row.
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StremioLogo size={32} />
        <div className="flex flex-col min-w-0">
          <div className="text-sm font-medium leading-tight">Stremio Sync</div>
          {loadingStatus ? (
            <div className="text-xs text-foreground/50">Loading…</div>
          ) : status?.linked ? (
            <div className="text-xs text-foreground/55 truncate">
              {status.email ?? 'unknown'} · last sync: {relativeTime(status.lastSyncAt)}
            </div>
          ) : (
            <div className="text-xs text-foreground/50">Not connected</div>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {loadingStatus ? null : status?.linked ? (
            <>
              <button
                type="button"
                className={pillBtnClass}
                onClick={() => void handleSync()}
                disabled={busy || syncOnCooldown}
                title={syncOnCooldown ? `Try again in ${syncCooldownSecondsLeft}s` : undefined}
              >
                {busy
                  ? 'Working…'
                  : syncOnCooldown
                    ? `Wait ${syncCooldownSecondsLeft}s`
                    : 'Sync now'}
              </button>
              <button
                type="button"
                className={pillBtnClass}
                onClick={() => void handleUnlink()}
                disabled={busy}
              >
                Unlink
              </button>
            </>
          ) : (
            <button type="button" className={pillBtnClass} onClick={openLinkPopup}>
              Authenticate
            </button>
          )}
        </div>
      </div>

      {!loadingStatus && status?.linked && status.lastSyncError ? (
        <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          Last sync error: {status.lastSyncError}
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
