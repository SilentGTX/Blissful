import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthProvider';
import { FocusableButton } from '../spatial/FocusableButton';
import { TvTextInput } from '../spatial/TvTextInput';
import { StremioLogo } from '../icons/StremioLogo';
import {
  exchangeStremioCredentialsForAuthKey,
  fetchStremioLinkStatus,
  linkStremioWithToken,
  syncStremioNow,
  unlinkStremioAccount,
  type StremioLinkStatus,
} from '../lib/stremioLinkApi';

// "Linked Accounts -> Stremio" panel for the Settings page. Backed by
// /stremio/{link-token,unlink,status,sync} on blissful-storage; the server
// runs a 15-min cron that mirrors Stremio's library <-> Blissful's library
// so progress + per-episode watched (the WatchedBitField) from the official
// Stremio app show up here, and vice versa.
//
// Linking: an INLINE email/password form (no popup). The credentials go
// browser-direct to api.strem.io/api/login via
// exchangeStremioCredentialsForAuthKey — the password NEVER reaches the
// Blissful backend; only the resulting Stremio authKey is posted to
// /stremio/link-token. This replaces the old window.open('/link-stremio')
// popup, which (a) has no page in this build and (b) can't work on a TV box
// (no popup windows / cross-window text entry). The inline form is D-pad +
// IME friendly via TvTextInput / FocusableButton.

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
  const [linkOpen, setLinkOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const refreshStatus = useCallback(async () => {
    if (!authKey) {
      setStatus(null);
      setLoadingStatus(false);
      return;
    }
    try {
      const next = await fetchStremioLinkStatus(authKey);
      setStatus(next);
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, [authKey]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Email/password -> Stremio authKey (browser-direct to api.strem.io) ->
  // store the authKey on blissful-storage -> sync immediately so watched +
  // progress show without waiting for the 15-min cron.
  const handleLink = async () => {
    if (!authKey || busy) return;
    const emailTrimmed = email.trim();
    if (!emailTrimmed || !password) {
      setActionError('Enter your Stremio email and password.');
      return;
    }
    setBusy(true);
    setActionError(null);
    setActionInfo(null);
    try {
      const creds = await exchangeStremioCredentialsForAuthKey({
        email: emailTrimmed,
        password,
        facebook: false,
      });
      await linkStremioWithToken(authKey, { authKey: creds.authKey, email: creds.email });
      setLinkOpen(false);
      setPassword('');
      setActionInfo(`Linked as ${creds.email}. Syncing…`);
      await refreshStatus();
      // Immediate first sync so the user doesn't have to wait for the cron.
      try {
        const result = await syncStremioNow(authKey);
        setActionInfo(`Linked as ${creds.email}. Pulled ${result.pulled}, pushed ${result.pushed}.`);
        await refreshStatus();
      } catch {
        /* the 15-min cron heals; status still shows linked */
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Stremio sign-in failed');
    } finally {
      setBusy(false);
    }
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

  // Anti-spam cooldown for the manual "Sync now" button. Independent from the
  // module-level cooldown in stremioLinkApi (which gates the home-page
  // auto-trigger) so a recent auto-sync doesn't lock the user out of a click.
  const SYNC_BUTTON_COOLDOWN_MS = 30_000;
  const [syncCooldownUntil, setSyncCooldownUntil] = useState(0);
  const [tickMs, setTickMs] = useState(0);
  useEffect(() => {
    if (syncCooldownUntil <= 0) return;
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
      const now = Date.now();
      setTickMs(now);
      setSyncCooldownUntil(now + SYNC_BUTTON_COOLDOWN_MS);
    }
  };

  // Dark glassy pill button — matches the linked-accounts row mockup.
  const pillBtnClass =
    'rounded-full border border-white/10 bg-white/[0.06] px-5 py-2 text-sm font-medium text-white transition hover:bg-white/[0.12] disabled:opacity-50';
  const fieldClass =
    'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30';

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

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StremioLogo size={32} />
        <div className="flex flex-col min-w-0">
          <div className="text-sm font-medium leading-tight">Stremio Sync</div>
          {loadingStatus ? (
            <div className="text-xs text-foreground/50">Loading...</div>
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
              <FocusableButton
                className={pillBtnClass}
                onPress={() => void handleSync()}
                disabled={busy || syncOnCooldown}
                focusableTv={!(busy || syncOnCooldown)}
                title={syncOnCooldown ? `Try again in ${syncCooldownSecondsLeft}s` : undefined}
              >
                {busy
                  ? 'Working...'
                  : syncOnCooldown
                    ? `Wait ${syncCooldownSecondsLeft}s`
                    : 'Sync now'}
              </FocusableButton>
              <FocusableButton
                className={pillBtnClass}
                onPress={() => void handleUnlink()}
                disabled={busy}
                focusableTv={!busy}
              >
                Unlink
              </FocusableButton>
            </>
          ) : (
            <FocusableButton
              className={pillBtnClass}
              onPress={() => {
                setActionError(null);
                setLinkOpen((v) => !v);
              }}
            >
              {linkOpen ? 'Cancel' : 'Authenticate'}
            </FocusableButton>
          )}
        </div>
      </div>

      {/* Inline Stremio sign-in (only when not linked + opened). */}
      {!loadingStatus && !status?.linked && linkOpen ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="text-xs text-foreground/55">
            Sign in with your Stremio account. Your password is sent straight to Stremio —
            it never touches Blissful&rsquo;s servers.
          </div>
          <TvTextInput
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="Stremio email"
            ariaLabel="Stremio email"
            inputClassName={fieldClass}
          />
          <TvTextInput
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="Stremio password"
            ariaLabel="Stremio password"
            inputClassName={fieldClass}
            onSubmit={() => void handleLink()}
          />
          <div className="flex gap-2">
            <FocusableButton
              className={pillBtnClass}
              onPress={() => void handleLink()}
              disabled={busy}
              focusableTv={!busy}
            >
              {busy ? 'Linking…' : 'Link account'}
            </FocusableButton>
          </div>
        </div>
      ) : null}

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
