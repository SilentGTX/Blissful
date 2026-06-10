// Top-center transient pills for watch-party activity — 1:1 with the desktop
// WatchPartyActivityToast. Shows when ANOTHER participant joins / leaves / plays /
// pauses / seeks / becomes host. Your own play/pause/seek are suppressed (the hook
// doesn't echo them, and we double-guard here). Auto-dismisses after 3.5s.
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import type { WatchPartyActivity } from '../../lib/watchParty';

function fmtT(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const sec = Math.floor(s % 60);
  const min = Math.floor((s / 60) % 60);
  const h = Math.floor(s / 3600);
  const mm = h > 0 && min < 10 ? `0${min}` : `${min}`;
  return `${h > 0 ? `${h}:` : ''}${mm}:${sec < 10 ? `0${sec}` : sec}`;
}

function textFor(a: WatchPartyActivity): string {
  switch (a.kind) {
    case 'play': return `${a.who.displayName} resumed`;
    case 'pause': return `${a.who.displayName} paused at ${fmtT(a.currentTime)}`;
    case 'seek': return `${a.who.displayName} jumped to ${fmtT(a.currentTime)}`;
    case 'joined': return `${a.who.displayName} joined the party`;
    case 'left': return `${a.who.displayName} left the party`;
    case 'host-changed': return `${a.who.displayName} is now the host`;
  }
}

export function WatchPartyToast({ activity, selfUserId }: { activity: WatchPartyActivity[]; selfUserId: string | null }) {
  const m = useMetrics();
  const [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (activity.length === 0) return;
    const latest = activity[activity.length - 1];
    if (latest.id === lastIdRef.current) return;
    lastIdRef.current = latest.id;
    // Suppress your own play/pause/seek.
    if ((latest.kind === 'play' || latest.kind === 'pause' || latest.kind === 'seek') && latest.who.userId === selfUserId) return;
    setToast({ id: latest.id, text: textFor(latest) });
  }, [activity, selfUserId]);

  useEffect(() => {
    if (!toast) return;
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(({ finished }) => { if (finished) setToast(null); });
    }, 3500);
    return () => clearTimeout(t);
  }, [toast, opacity]);

  if (!toast) return null;
  return (
    <Animated.View style={[styles.wrap, { opacity, top: m.s(28) }]} pointerEvents="none">
      <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: m.s(20), paddingVertical: m.s(10) }}>
        <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(17), color: '#fff' }}>{toast.text}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 60 },
});
