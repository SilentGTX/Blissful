import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { colors, font, radius } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { useToast } from '../Toast';
import { Button } from '../ui/Button';
import {
  disconnectTrakt,
  getTraktUser,
  isTraktConnected,
  pollDeviceToken,
  requestDeviceCode,
  type DeviceCode,
  type TraktUser,
} from '../../lib/traktApi';
import { isTraktConfigured } from '../../lib/traktConfig';

type M = ReturnType<typeof useMetrics>;
type Phase = 'idle' | 'requesting' | 'awaiting' | 'finalizing';

// "Linked Accounts -> Trakt" panel. Ported 1:1 from
// apps/web-blissful/src/components/SettingsTraktPanel.tsx: the TV-friendly
// device-code OAuth flow (big code + "go to trakt.tv/activate" + poll loop).
// Fully inert until isTraktConfigured() — empty creds show a "paste your API
// keys" hint with no connect button and never hit the network.
export function SettingsTraktPanel({ m }: { m: M }) {
  const toast = useToast();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [user, setUser] = useState<TraktUser | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const pollDeadlineRef = useRef(0);

  const busy = phase !== 'idle';

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

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

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      clearPollTimer();
    };
  }, [clearPollTimer]);

  const pollLoopRef = useRef<(deviceCode: string, intervalMs: number) => void>(() => {});
  pollLoopRef.current = (deviceCode: string, intervalMs: number) => {
    clearPollTimer();
    pollTimerRef.current = setTimeout(async () => {
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
          setActionInfo('Connected. Loading your Trakt profile...');
          await refreshStatus();
          if (cancelledRef.current) return;
          setPhase('idle');
          setActionInfo('Trakt connected.');
          toast.show('Trakt connected');
          return;
        }
        case 'pending':
          pollLoopRef.current(deviceCode, intervalMs);
          return;
        case 'slow_down':
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
          pollLoopRef.current(deviceCode, intervalMs);
          return;
      }
    }, intervalMs);
  };

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
    pollDeadlineRef.current = Date.now() + (code.expires_in || 600) * 1000;
    setPhase('awaiting');
    const intervalMs = Math.max(1, code.interval || 5) * 1000;
    pollLoopRef.current(code.device_code, intervalMs);
  }, [busy]);

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
    toast.show('Trakt disconnected');
  }, [clearPollTimer, toast]);

  const configured = isTraktConfigured();
  const connectedLabel = user?.name || (user?.username ? `@${user.username}` : 'Connected');
  const statusLine = (() => {
    if (!configured) return 'Not configured';
    if (connected === null) return 'Loading...';
    if (connected) return user?.username ? `${connectedLabel} · syncing` : connectedLabel;
    return 'Not connected';
  })();

  const cardStyle = {
    borderRadius: m.s(20),
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    padding: m.s(18),
    gap: m.s(14),
  } as const;

  return (
    <View style={cardStyle}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(14) }}>
        {/* Self-contained Trakt monogram (no PNG/icon asset exists). */}
        <View
          style={{
            width: m.s(36),
            height: m.s(36),
            borderRadius: 999,
            backgroundColor: '#ed1c24',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(13), color: '#ffffff', letterSpacing: 1 }}>Tkt</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: colors.text }}>Trakt</Text>
          <Text numberOfLines={1} style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textFaint, marginTop: m.s(2) }}>
            {statusLine}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: m.s(10) }}>
          {!configured ? null : connected === null ? null : connected ? (
            <Button label="Disconnect" onPress={handleDisconnect} disabled={busy} atRowStart />
          ) : phase === 'idle' ? (
            <Button label="Connect Trakt" onPress={() => void handleConnect()} atRowStart />
          ) : (
            <Button label="Cancel" onPress={handleCancel} atRowStart />
          )}
        </View>
      </View>

      {/* Not-configured hint. */}
      {!configured ? (
        <Banner
          m={m}
          kind="info"
          text="Add your Trakt API keys in src/lib/traktConfig.ts to enable Trakt sync. Create an app at trakt.tv -> Settings -> Your API Apps and paste the Client ID + Client Secret."
        />
      ) : null}

      {/* Device-code activation card. */}
      {configured && (phase === 'requesting' || phase === 'awaiting' || phase === 'finalizing') ? (
        <View
          style={{
            alignItems: 'center',
            gap: m.s(12),
            borderRadius: radius.field,
            borderWidth: 1,
            borderColor: colors.hairline,
            backgroundColor: 'rgba(0,0,0,0.3)',
            paddingHorizontal: m.s(18),
            paddingVertical: m.s(22),
          }}
        >
          {phase === 'requesting' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10) }}>
              <ActivityIndicator color={colors.accent} />
              <Text style={{ fontFamily: font.body, fontSize: m.s(17), color: colors.textDim }}>Starting...</Text>
            </View>
          ) : device ? (
            <>
              <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: colors.textFaint, textTransform: 'uppercase', letterSpacing: 1 }}>
                On your phone or computer, go to
              </Text>
              <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(22), color: colors.accent }}>
                {device.verification_url}
              </Text>
              <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: colors.textFaint, textTransform: 'uppercase', letterSpacing: 1 }}>
                and enter this code
              </Text>
              <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(44), color: colors.text, letterSpacing: m.s(8) }}>
                {device.user_code}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10) }}>
                <ActivityIndicator color={colors.accent} />
                <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textFaint }}>
                  Waiting for you to authorize...
                </Text>
              </View>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10) }}>
              <ActivityIndicator color={colors.accent} />
              <Text style={{ fontFamily: font.body, fontSize: m.s(17), color: colors.textDim }}>Finishing up...</Text>
            </View>
          )}
        </View>
      ) : null}

      {actionError ? <Banner m={m} kind="error" text={actionError} /> : null}
      {actionInfo ? <Banner m={m} kind="info" text={actionInfo} /> : null}
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
