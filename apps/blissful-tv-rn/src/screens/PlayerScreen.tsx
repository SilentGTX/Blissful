import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';

type PlayerRoute = RouteProp<RootStackParamList, 'Player'>;
const SEEK_STEP = 10; // seconds
const CONTROLS_TIMEOUT = 3500;

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 && m < 10 ? `0${m}` : `${m}`;
  return `${h > 0 ? `${h}:` : ''}${mm}:${s < 10 ? `0${s}` : s}`;
}

// Any debrid "File was removed… copyright infringement" placeholder is ~30s.
// No real movie/episode is this short, so a loaded duration at/under this means
// the chosen stream is dead — auto-advance to the next playable one.
const DMCA_MAX_SECONDS = 45;

export function PlayerScreen() {
  const { params } = useRoute<PlayerRoute>();
  const navigation = useNavigation();

  // Ranked playable list (from the picker) so we can skip a dead stream; falls
  // back to the single url (e.g. Continue-Watching resume).
  const playlist = params.playlist?.length ? params.playlist : [{ url: params.url, title: params.title }];
  const [index, setIndex] = useState(Math.min(params.startIndex ?? 0, playlist.length - 1));
  const current = playlist[index] ?? playlist[0];
  const skippedRef = useRef(false);

  const player = useVideoPlayer(current.url, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.play();
  });

  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // When idx changes (auto-skip), swap the source and reset state.
  useEffect(() => {
    player.replace(current.url);
    player.play();
    setReady(false);
    setTime(0);
    setDuration(0);
    skippedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Auto-skip the DMCA placeholder: once a real duration loads and it's ≤45s,
  // advance to the next playable stream (if any).
  useEffect(() => {
    if (skippedRef.current) return;
    if (duration > 0 && duration <= DMCA_MAX_SECONDS && index < playlist.length - 1) {
      skippedRef.current = true;
      setIndex((i) => i + 1);
    }
  }, [duration, index, playlist.length]);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // dedupe keydown/keyup + auto-repeat double-fire of the same TV event
  const lastEvt = useRef<{ type: string; at: number }>({ type: '', at: 0 });

  const bumpControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_TIMEOUT);
  };

  // Poll player state at ~2.5Hz (engine-agnostic; survives the eventual swap
  // to the bespoke BlissPlayer module).
  useEffect(() => {
    bumpControls();
    const id = setInterval(() => {
      setTime(player.currentTime ?? 0);
      const d = player.duration ?? 0;
      if (d > 0) setDuration(d);
      setPlaying(player.playing);
      if (d > 0 && !ready) setReady(true);
    }, 400);
    return () => {
      clearInterval(id);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const togglePlay = () => {
    if (player.playing) player.pause();
    else player.play();
    setPlaying(!player.playing);
    bumpControls();
  };

  const seek = (delta: number) => {
    player.seekBy(delta);
    bumpControls();
  };

  useTVEventHandler((evt) => {
    const type = evt?.eventType;
    if (!type) return;
    const now = Date.now();
    if (lastEvt.current.type === type && now - lastEvt.current.at < 220) return;
    lastEvt.current = { type, at: now };

    switch (type) {
      case 'playPause':
        // OK/'select' is handled by the focusable root Pressable's onPress to
        // avoid a double-toggle; this covers the dedicated media play/pause key.
        togglePlay();
        break;
      case 'play':
        player.play();
        bumpControls();
        break;
      case 'pause':
        player.pause();
        bumpControls();
        break;
      case 'right':
      case 'fastForward':
        seek(SEEK_STEP);
        break;
      case 'left':
      case 'rewind':
        seek(-SEEK_STEP);
        break;
      default:
        bumpControls();
    }
  });

  const pct = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <Pressable style={styles.root} hasTVPreferredFocus focusable onPress={togglePlay}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />

      {!ready ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : null}

      {controlsVisible ? <View style={styles.scrim} pointerEvents="none" /> : null}

      {controlsVisible ? (
        <View style={styles.controls} pointerEvents="none">
          <Text style={styles.title} numberOfLines={1}>
            {current.title}
          </Text>
          <View style={styles.barRow}>
            <Text style={styles.time}>{fmt(time)}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct * 100}%` }]} />
            </View>
            <Text style={styles.time}>{fmt(duration)}</Text>
          </View>
          <Text style={styles.hint}>
            {playing ? 'Playing' : 'Paused'} · OK play/pause · ←/→ {SEEK_STEP}s · Back to exit
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { ...absFill(), alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 260, backgroundColor: 'rgba(0,0,0,0.6)' },
  controls: {
    position: 'absolute',
    left: 48,
    right: 48,
    bottom: 44,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '700', marginBottom: 14 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  time: { color: colors.textDim, fontSize: 14, width: 64, textAlign: 'center' },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  hint: { color: colors.textFaint, fontSize: 13, marginTop: 12 },
});

function absFill() {
  return { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
}
