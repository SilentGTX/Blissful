import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useTVEventHandler, View } from 'react-native';
import { font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { BufferingVeil } from '../components/player/BufferingVeil';
import type { RootStackParamList } from '../navigation/types';

type PlayerRoute = RouteProp<RootStackParamList, 'Player'>;
const SEEK_STEP = 10; // seconds
const CONTROLS_TIMEOUT = 3500;
const ACCENT = '#95a2ff'; // --bliss-accent (lavender) — scrub fill

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
  // The video stays HIDDEN behind the buffering veil until a real duration
  // (>45s) confirms this stream isn't the ~30s debrid placeholder — so its
  // "File was removed…" frame never paints. Latches once revealed.
  const [revealed, setRevealed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // When idx changes (auto-skip), swap the source and reset state.
  useEffect(() => {
    player.replace(current.url);
    player.play();
    setRevealed(false);
    setTime(0);
    setDuration(0);
    skippedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Reveal the video only once a real duration loads (> the placeholder length).
  useEffect(() => {
    if (duration > DMCA_MAX_SECONDS) setRevealed(true);
  }, [duration]);

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
  const m = useMetrics();
  const iconColor = 'rgba(255,255,255,0.85)';

  return (
    <Pressable style={styles.root} hasTVPreferredFocus focusable onPress={togglePlay}>
      <VideoView player={player} style={[StyleSheet.absoluteFill, { opacity: revealed ? 1 : 0 }]} contentFit="contain" nativeControls={false} />

      {/* Buffering veil — title logo pulsing over black; stays up (hiding the
          video) until a real duration confirms this isn't the DMCA placeholder. */}
      <BufferingVeil visible={!revealed} logo={params.logo} />

      {/* TOP OVERLAY — back pill with the title inside (top-left). */}
      {controlsVisible ? (
        <LinearGradient colors={['rgba(0,0,0,0.8)', 'rgba(0,0,0,0.5)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: m.s(24), paddingTop: m.s(24), paddingBottom: m.s(16) }} pointerEvents="none">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8), alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: m.s(14), paddingVertical: m.s(9), maxWidth: '60%' }}>
            <Ionicons name="chevron-back" size={m.s(22)} color="#fff" />
            <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: '#fff' }}>{current.title}</Text>
          </View>
        </LinearGradient>
      ) : null}

      {/* BOTTOM CONTROLS — two stacked strips. */}
      {controlsVisible ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} pointerEvents="none">
          {/* STRIP 1 — scrub + time labels over a transparent gradient. */}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']} style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(16), paddingHorizontal: m.s(22), paddingTop: m.s(40), paddingBottom: m.s(6) }}>
            <Text style={timeStyle(m)}>{fmt(time)}</Text>
            <View style={{ flex: 1, height: m.s(4), borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center' }}>
              <View style={{ position: 'absolute', left: 0, height: m.s(4), borderRadius: 999, width: `${pct * 100}%`, backgroundColor: ACCENT }} />
              <View style={{ position: 'absolute', left: `${pct * 100}%`, width: m.s(12), height: m.s(12), borderRadius: 999, marginLeft: -m.s(6), backgroundColor: '#fff' }} />
            </View>
            <Text style={[timeStyle(m), { textAlign: 'right' }]}>{fmt(duration)}</Text>
          </LinearGradient>

          {/* STRIP 2 — transport row (solid). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: m.s(18), paddingVertical: m.s(10) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
              <View style={iconBtn(m)}><Ionicons name={playing ? 'pause' : 'play'} size={m.s(28)} color={iconColor} /></View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(4) }}>
              <View style={iconBtn(m)}><Ionicons name="text-outline" size={m.s(22)} color={iconColor} /></View>
              <View style={iconBtn(m)}><Ionicons name="volume-medium-outline" size={m.s(22)} color={iconColor} /></View>
            </View>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

function timeStyle(m: ReturnType<typeof useMetrics>) {
  return { minWidth: m.s(56), fontFamily: font.body, fontSize: m.s(16), color: '#fff' } as const;
}
function iconBtn(m: ReturnType<typeof useMetrics>) {
  return { width: m.s(40), height: m.s(40), borderRadius: 999, alignItems: 'center', justifyContent: 'center' } as const;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
