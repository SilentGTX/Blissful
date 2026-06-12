import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { colors, font, radius } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Toast';
import { StremioLogo } from '../../icons/StremioLogo';
import { TvTextField } from './TvTextField';
import { Button } from '../ui/Button';
import {
  exchangeStremioCredentialsForAuthKey,
  fetchStremioLinkStatus,
  linkStremioWithToken,
  syncStremioNow,
  unlinkStremioAccount,
  type StremioLinkStatus,
} from '../../lib/stremioLink';

type M = ReturnType<typeof useMetrics>;

// "Linked Accounts -> Stremio" panel. Ported 1:1 from
// apps/web-blissful/src/components/SettingsStremioPanel.tsx: status row,
// inline email/password sign-in (no popup — TV-friendly), Sync now / Unlink
// pills with a 30s cooldown on Sync. The password goes browser-direct to
// Stremio; only the authKey reaches blissful-storage.

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

const SYNC_BUTTON_COOLDOWN_MS = 30_000;

export function SettingsStremioPanel({ m }: { m: M }) {
  const { token } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<StremioLinkStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const refreshStatus = useCallback(async () => {
    if (!token) {
      setStatus(null);
      setLoadingStatus(false);
      return;
    }
    try {
      const next = await fetchStremioLinkStatus(token);
      setStatus(next);
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, [token]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleLink = async () => {
    if (!token || busy) return;
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
      await linkStremioWithToken(token, { authKey: creds.authKey, email: creds.email });
      setLinkOpen(false);
      setPassword('');
      setActionInfo(`Linked as ${creds.email}. Syncing...`);
      await refreshStatus();
      try {
        const result = await syncStremioNow(token);
        setActionInfo(`Linked as ${creds.email}. Pulled ${result.pulled}, pushed ${result.pushed}.`);
        await refreshStatus();
      } catch {
        // the 15-min cron heals; status still shows linked
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Stremio sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    if (!token || busy) return;
    setBusy(true);
    setActionError(null);
    setActionInfo(null);
    try {
      await unlinkStremioAccount(token);
      setActionInfo('Stremio account unlinked.');
      await refreshStatus();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Unlink failed');
    } finally {
      setBusy(false);
    }
  };

  const [syncCooldownUntil, setSyncCooldownUntil] = useState(0);
  const [tickMs, setTickMs] = useState(0);
  useEffect(() => {
    if (syncCooldownUntil <= 0) return;
    const id = setInterval(() => setTickMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [syncCooldownUntil]);
  const syncCooldownSecondsLeft = Math.max(0, Math.ceil((syncCooldownUntil - tickMs) / 1000));
  const syncOnCooldown = syncCooldownSecondsLeft > 0;

  const handleSync = async () => {
    if (!token || busy || syncOnCooldown) return;
    setBusy(true);
    setActionError(null);
    setActionInfo(null);
    try {
      const result = await syncStremioNow(token);
      setActionInfo(`Sync done. Pulled ${result.pulled}, pushed ${result.pushed}.`);
      toast.show('Stremio synced');
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

  const cardStyle = {
    borderRadius: m.s(20),
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    padding: m.s(18),
    gap: m.s(14),
  } as const;

  if (!token) {
    return (
      <View style={cardStyle}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(14) }}>
          <StremioLogo size={m.s(36)} />
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: colors.text }}>Stremio Sync</Text>
          <Text style={{ marginLeft: 'auto', fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost }}>
            Sign in to Blissful first
          </Text>
        </View>
      </View>
    );
  }

  const statusLine = loadingStatus
    ? 'Loading...'
    : status?.linked
      ? `${status.email ?? 'unknown'} · last sync: ${relativeTime(status.lastSyncAt)}`
      : 'Not connected';

  return (
    <View style={cardStyle}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(14) }}>
        <StremioLogo size={m.s(36)} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: colors.text }}>Stremio Sync</Text>
          <Text numberOfLines={1} style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textFaint, marginTop: m.s(2) }}>
            {statusLine}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: m.s(10) }}>
          {loadingStatus ? null : status?.linked ? (
            <>
              <Button
                label={busy ? 'Working...' : syncOnCooldown ? `Wait ${syncCooldownSecondsLeft}s` : 'Sync now'}
                onPress={() => void handleSync()}
                disabled={busy || syncOnCooldown}
                atRowStart
              />
              <Button label="Unlink" onPress={() => void handleUnlink()} disabled={busy} />
            </>
          ) : (
            <Button
              label={linkOpen ? 'Cancel' : 'Authenticate'}
              onPress={() => {
                setActionError(null);
                setLinkOpen((v) => !v);
              }}
              atRowStart
            />
          )}
        </View>
      </View>

      {/* Inline Stremio sign-in (only when not linked + opened). */}
      {!loadingStatus && !status?.linked && linkOpen ? (
        <View style={{ gap: m.s(12), marginTop: m.s(4) }}>
          <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textFaint, lineHeight: m.s(21) }}>
            Sign in with your Stremio account. Your password is sent straight to Stremio — it never touches Blissful's servers.
          </Text>
          <TvTextField
            label="Stremio email"
            value={email}
            placeholder="Stremio email"
            onChange={setEmail}
            m={m}
            atRowStart
          />
          <TvTextField
            label="Stremio password"
            value={password}
            placeholder="Stremio password"
            onChange={setPassword}
            onSubmit={() => void handleLink()}
            secureMask
            m={m}
            atRowStart
          />
          <View style={{ flexDirection: 'row' }}>
            <Button
              label={busy ? 'Linking...' : 'Link account'}
              onPress={() => void handleLink()}
              disabled={busy}
              busy={busy}
              atRowStart
            />
          </View>
        </View>
      ) : null}

      {!loadingStatus && status?.linked && status.lastSyncError ? (
        <Banner m={m} text={`Last sync error: ${status.lastSyncError}`} kind="error" />
      ) : null}
      {actionError ? <Banner m={m} text={actionError} kind="error" /> : null}
      {actionInfo ? <Banner m={m} text={actionInfo} kind="info" /> : null}
    </View>
  );
}

function Banner({ m, text, kind }: { m: M; text: string; kind: 'error' | 'info' }) {
  const isError = kind === 'error';
  return (
    <View
      style={{
        borderRadius: radius.field,
        borderWidth: 1,
        borderColor: isError ? 'rgba(255,107,107,0.4)' : colors.hairline,
        backgroundColor: isError ? 'rgba(255,107,107,0.1)' : colors.surface,
        paddingHorizontal: m.s(14),
        paddingVertical: m.s(10),
      }}
    >
      <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: isError ? colors.danger : colors.textDim, lineHeight: m.s(21) }}>
        {text}
      </Text>
    </View>
  );
}
