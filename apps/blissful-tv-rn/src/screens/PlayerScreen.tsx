import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useTVEventHandler, View } from 'react-native';
import { font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { BufferingVeil } from '../components/player/BufferingVeil';
import {
  AudioIcon,
  BackPill,
  FullscreenIcon,
  MuteIcon,
  PlayIcon,
  PlayerIconBtn,
  SourceBadges,
  SubsIcon,
  VolumeSlider,
  WatchPartyButton,
} from '../components/player/PlayerControls';
import { detectSource, is4kTitle, isHdrTitle } from '../lib/colorUtils';
import type { RootStackParamList } from '../navigation/types';

type PlayerRoute = RouteProp<RootStackParamList, 'Player'>;
const SEEK_STEP = 10; // seconds
const CONTROLS_TIMEOUT = 3500;
const ACCENT = '#95a2ff'; // --bliss-accent (lavender) — scrub fill
const DMCA_MAX_SECONDS = 45; // the debrid "removed" placeholder is ~30s

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 && m < 10 ? `0${m}` : `${m}`;
  return `${h > 0 ? `${h}:` : ''}${mm}:${s < 10 ? `0${s}` : s}`;
}

export function PlayerScreen() {
  const { params } = useRoute<PlayerRoute>();
  const navigation = useNavigation();
  const m = useMetrics();

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
  const [revealed, setRevealed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  // Whether a control button (not the root playback surface) holds focus. Seek
  // (Left/Right) only fires in plain playback; while a control is focused the
  // native engine walks the buttons instead.
  const [controlFocused, setControlFocused] = useState(false);
  const controlFocusedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const volume = 1; // 0..2 (unity); slider is a styled indicator for now

  const setCtrlFocus = (f: boolean) => {
    controlFocusedRef.current = f;
    setControlFocused(f);
  };

  useEffect(() => {
    player.replace(current.url);
    player.play();
    setRevealed(false);
    setTime(0);
    setDuration(0);
    skippedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  // Reveal the video only once a real duration loads (> the placeholder length),
  // and on the first reveal seek to the Continue-Watching resume position.
  const seekedRef = useRef(false);
  useEffect(() => {
    if (duration > DMCA_MAX_SECONDS) {
      if (!seekedRef.current) {
        seekedRef.current = true;
        const start = params.startSeconds ?? 0;
        if (start > 0 && start < duration - 5) player.currentTime = start;
      }
      setRevealed(true);
    }
  }, [duration]);

  // Auto-skip the DMCA placeholder.
  useEffect(() => {
    if (skippedRef.current) return;
    if (duration > 0 && duration <= DMCA_MAX_SECONDS && index < playlist.length - 1) {
      skippedRef.current = true;
      setIndex((i) => i + 1);
    }
  }, [duration, index, playlist.length]);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEvt = useRef<{ type: string; at: number }>({ type: '', at: 0 });

  const bumpControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // Don't auto-hide while a control is focused (else the focused button vanishes).
    hideTimer.current = setTimeout(() => {
      if (!controlFocusedRef.current) setControlsVisible(false);
    }, CONTROLS_TIMEOUT);
  };

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
        if (!controlFocusedRef.current) seek(SEEK_STEP); // seek only in plain playback
        else bumpControls();
        break;
      case 'left':
      case 'rewind':
        if (!controlFocusedRef.current) seek(-SEEK_STEP);
        else bumpControls();
        break;
      default:
        bumpControls();
    }
  });

  const pct = duration > 0 ? Math.min(1, time / duration) : 0;
  const badges = [detectSource(current.url)?.code, is4kTitle(current.title) ? '4K' : null, isHdrTitle(current.title) ? 'HDR' : null].filter(Boolean) as string[];

  return (
    <Pressable
      style={styles.root}
      hasTVPreferredFocus
      focusable
      onFocus={() => setCtrlFocus(false)}
      onPress={togglePlay}
    >
      <VideoView player={player} style={[StyleSheet.absoluteFill, { opacity: revealed ? 1 : 0 }]} contentFit="contain" nativeControls={false} />

      <BufferingVeil visible={!revealed} logo={params.logo} />

      {/* TOP OVERLAY — back pill (left), source badges + Watch Party (right). */}
      {controlsVisible ? (
        <LinearGradient colors={['rgba(0,0,0,0.8)', 'rgba(0,0,0,0.5)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: m.s(24), paddingTop: m.s(24), paddingBottom: m.s(16) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m.s(12) }}>
            <BackPill m={m} title={current.title} onPress={() => navigation.goBack()} onFocusChange={setCtrlFocus} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(12) }}>
              <SourceBadges m={m} badges={badges} />
              <WatchPartyButton m={m} onPress={() => { /* watch party — backlog */ }} onFocusChange={setCtrlFocus} />
            </View>
          </View>
        </LinearGradient>
      ) : null}

      {/* BOTTOM CONTROLS — scrub strip + transport row. */}
      {controlsVisible ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']} style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(16), paddingHorizontal: m.s(22), paddingTop: m.s(40), paddingBottom: m.s(6) }} pointerEvents="none">
            <Text style={timeStyle(m)}>{fmt(time)}</Text>
            <View style={{ flex: 1, height: m.s(4), borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center' }}>
              <View style={{ position: 'absolute', left: 0, height: m.s(4), borderRadius: 999, width: `${pct * 100}%`, backgroundColor: ACCENT }} />
              <View style={{ position: 'absolute', left: `${pct * 100}%`, width: m.s(12), height: m.s(12), borderRadius: 999, marginLeft: -m.s(6), backgroundColor: '#fff' }} />
            </View>
            <Text style={[timeStyle(m), { textAlign: 'right' }]}>{fmt(duration)}</Text>
          </LinearGradient>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: m.s(18), paddingVertical: m.s(10) }}>
            {/* LEFT: play, mute, volume slider */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
              <PlayerIconBtn m={m} onPress={togglePlay} onFocusChange={setCtrlFocus}>{(c) => <PlayIcon m={m} paused={!playing} color={c} />}</PlayerIconBtn>
              <PlayerIconBtn m={m} onPress={() => { setMuted((v) => !v); bumpControls(); }} onFocusChange={setCtrlFocus}>{(c) => <MuteIcon m={m} level={volume} muted={muted} color={c} />}</PlayerIconBtn>
              <VolumeSlider m={m} level={muted ? 0 : volume} focused={false} />
            </View>
            {/* RIGHT: subtitles, audio, fullscreen */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(4) }}>
              <PlayerIconBtn m={m} onPress={() => { /* subtitles menu — next chunk */ bumpControls(); }} onFocusChange={setCtrlFocus}>{(c) => <SubsIcon m={m} color={c} />}</PlayerIconBtn>
              <PlayerIconBtn m={m} onPress={() => { /* audio menu — next chunk */ bumpControls(); }} onFocusChange={setCtrlFocus}>{(c) => <AudioIcon m={m} color={c} />}</PlayerIconBtn>
              <PlayerIconBtn m={m} onPress={() => { /* always fullscreen on TV */ bumpControls(); }} onFocusChange={setCtrlFocus}>{(c) => <FullscreenIcon m={m} color={c} />}</PlayerIconBtn>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
