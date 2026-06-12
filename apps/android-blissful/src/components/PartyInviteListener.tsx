// Global watch-party invite pills + the friends' active-party tracker. Mounted at
// the app root so it shows on every screen. Two transient cards (bottom-right,
// 60s TTL):
//   • party:invite-request  -> a friend asks YOU (you're watching) to start a
//     party. Accept -> POST /party-invite/accept -> {code}, join on the current player.
//   • party:invite-accepted -> the friend you invited started a room. Join ->
//     resolve a stream + open the player in that room. Also recorded in the
//     activeParties store so that friend's accordion shows "Join party".
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { acceptPartyInvite, fetchMeta } from '@blissful/core';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';
import { useUserSocketEvent, type PartyInviteAccepted, type PartyInviteRequest } from '../context/UserSocketContext';
import { navigationRef } from '../lib/navigationRef';
import { joinWatchPartyRoom } from '../lib/joinWatchParty';
import { clearActiveParties, removeActivePartyByCode, setActiveParty } from '../lib/activeParties';
import { Img } from './Img';
import { useToast } from './Toast';

type M = ReturnType<typeof useMetrics>;
const DISMISS_AFTER_MS = 60_000;

let inviteOverlayActive = false;
export function isInviteOverlayActive(): boolean { return inviteOverlayActive; }

function posterFor(imdbId: string | null | undefined): string | null {
  if (!imdbId || !/^tt\d{5,}$/.test(imdbId)) return null;
  return `https://images.metahub.space/poster/small/${imdbId}/img`;
}

export function PartyInviteListener() {
  const m = useMetrics();
  const toast = useToast();
  const { token } = useAuth();
  const [inbound, setInbound] = useState<PartyInviteRequest | null>(null);
  const [accepted, setAccepted] = useState<PartyInviteAccepted | null>(null);
  const [busy, setBusy] = useState(false);

  useUserSocketEvent('party:invite-request', (msg) => setInbound(msg));
  useUserSocketEvent('party:invite-accepted', (msg) => {
    setAccepted(msg);
    // The friend (host) now has an open room — light up "Join party" on their row.
    setActiveParty({ hostUserId: msg.host.userId, code: msg.code, type: msg.type, imdbId: msg.imdbId, videoId: msg.videoId });
  });
  useUserSocketEvent('party:room-closed', (msg) => {
    removeActivePartyByCode(msg.code);
    setAccepted((a) => (a && a.code === msg.code ? null : a));
  });
  useEffect(() => { if (!token) clearActiveParties(); }, [token]);

  useEffect(() => { if (!inbound) return; const t = setTimeout(() => setInbound(null), DISMISS_AFTER_MS); return () => clearTimeout(t); }, [inbound]);
  useEffect(() => { if (!accepted) return; const t = setTimeout(() => setAccepted(null), DISMISS_AFTER_MS); return () => clearTimeout(t); }, [accepted]);
  useEffect(() => { inviteOverlayActive = !!(inbound || accepted); return () => { inviteOverlayActive = false; }; }, [inbound, accepted]);

  const onAccept = async () => {
    if (!token || !inbound || busy) return;
    setBusy(true);
    try {
      const { code } = await acceptPartyInvite(token, { requesterUserId: inbound.from.userId, type: inbound.activity.type, imdbId: inbound.activity.id, videoId: inbound.activity.videoId });
      setInbound(null);
      navigationRef.current?.dispatch(CommonActions.setParams({ roomCode: code }));
    } catch { toast.show('Could not start the party'); } finally { setBusy(false); }
  };
  const onJoin = async () => {
    if (!accepted || busy) return;
    const target = accepted;
    setAccepted(null);
    setBusy(true);
    const res = await joinWatchPartyRoom(token, { code: target.code, type: target.type, imdbId: target.imdbId, videoId: target.videoId, hasPassword: false, participantCount: 0 });
    if (!res.ok) toast.show(res.reason ?? 'Could not join the party');
    setBusy(false);
  };

  if (!inbound && !accepted) return null;
  return (
    <View style={[styles.root, { right: m.s(40), bottom: m.s(40), gap: m.s(12) }]} pointerEvents="box-none">
      {inbound ? (
        <InviteCard
          m={m}
          imdbId={inbound.activity.id}
          type={inbound.activity.type}
          knownName={inbound.activity.name}
          line={`${inbound.from.displayName} wants to watch with you`}
          action={busy ? '...' : 'Accept'}
          onAction={onAccept}
          onDismiss={() => setInbound(null)}
        />
      ) : null}
      {accepted ? (
        <InviteCard
          m={m}
          imdbId={accepted.imdbId}
          type={accepted.type}
          line={`${accepted.host.displayName} started a watch party`}
          action={busy ? '...' : 'Join'}
          onAction={onJoin}
          onDismiss={() => setAccepted(null)}
        />
      ) : null}
    </View>
  );
}

function InviteCard({ m, imdbId, type, knownName, line, action, onAction, onDismiss }: { m: M; imdbId: string; type: string; knownName?: string | null; line: string; action: string; onAction: () => void; onDismiss: () => void }) {
  const [name, setName] = useState<string | null>(knownName ?? null);
  useEffect(() => {
    if (knownName || !imdbId) return;
    let cancelled = false;
    fetchMeta({ type: (type === 'series' ? 'series' : 'movie'), id: imdbId }).then((r) => { if (!cancelled) setName(r.meta.name ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [imdbId, type, knownName]);
  const poster = posterFor(imdbId);
  return (
    <View style={{ width: m.s(420), borderRadius: m.s(18), borderWidth: 1, borderColor: 'rgba(149,162,255,0.35)', backgroundColor: 'rgba(16,17,22,0.98)', padding: m.s(14), shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: m.s(20), shadowOffset: { width: 0, height: m.s(8) } }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(13) }}>
        {poster ? (
          <View style={{ width: m.s(52), height: m.s(78), borderRadius: m.s(8), overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <Img uri={poster} style={StyleSheet.absoluteFill} contentFit="cover" />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(6), marginBottom: m.s(3) }}>
            <Ionicons name="people" size={m.s(15)} color={colors.accent} />
            <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(12), letterSpacing: m.s(1.2), textTransform: 'uppercase', color: colors.accent }}>Watch party</Text>
          </View>
          <Text numberOfLines={1} style={{ fontFamily: font.bodyMed, fontSize: m.s(16), color: '#fff' }}>{line}</Text>
          {name ? <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: 'rgba(255,255,255,0.95)', marginTop: m.s(1) }}>{name}</Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: m.s(8), marginTop: m.s(12) }}>
        <CardBtn m={m} label={action} primary autoFocus onPress={onAction} />
        <CardBtn m={m} label="Dismiss" onPress={onDismiss} />
      </View>
    </View>
  );
}

function CardBtn({ m, label, primary, autoFocus, onPress }: { m: M; label: string; primary?: boolean; autoFocus?: boolean; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable hasTVPreferredFocus={autoFocus} onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(6), borderRadius: 999, paddingHorizontal: m.s(18), paddingVertical: m.s(9), backgroundColor: primary ? colors.accent : f ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)', borderWidth: m.s(2), borderColor: f ? (primary ? '#fff' : colors.accent) : 'transparent' }}>
      {primary ? <Ionicons name="play" size={m.s(14)} color={colors.accentInk} style={{ marginLeft: -m.s(2) }} /> : null}
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(15), color: primary ? colors.accentInk : '#fff' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', zIndex: 300, alignItems: 'flex-end' },
});
