import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, useTVEventHandler, View } from 'react-native';
import { font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useToast } from '../components/Toast';
import { BufferingVeil } from '../components/player/BufferingVeil';
import { PauseOverlay } from '../components/player/PauseOverlay';
import { SettingsDrawer, type DrawerItem } from '../components/player/SettingsDrawer';
import { AudioIcon, BackPill, PlayIcon, PlayerIconBtn, SourceBadges, SubsIcon, WatchPartyButton } from '../components/player/PlayerControls';
import { detectSource, is4kTitle, isHdrTitle } from '../lib/colorUtils';
import type { RootStackParamList } from '../navigation/types';

type PlayerRoute = RouteProp<RootStackParamList, 'Player'>;
const SEEK_STEP = 10;
const CONTROLS_TIMEOUT = 3500;
const ACCENT = '#95a2ff';
const DMCA_MAX_SECONDS = 45;

// Two playback control rows (TV has no volume/mute/fullscreen — the remote owns
// volume and the app is always fullscreen). Walked by virtual index.
type Row = 'none' | 'bottom' | 'top';
type Drawer = 'none' | 'audio' | 'subtitles';
const BOTTOM = ['play', 'subtitles', 'audio'] as const;
const TOP = ['back', 'watchparty'] as const;

type Track = { id: string; label?: string | null; language?: string | null };

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
  const toast = useToast();

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
  const [errored, setErrored] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Embedded audio / subtitle tracks (expo-video — external subs aren't supported
  // by the engine; that waits for the native player).
  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [subTracks, setSubTracks] = useState<Track[]>([]);
  const [curAudio, setCurAudio] = useState<string | null>(null);
  const [curSub, setCurSub] = useState<string | null>(null);

  // Virtual focus position (playback rows) + the settings drawer.
  const [row, setRow] = useState<Row>('none');
  const [idx, setIdx] = useState(0);
  const [drawer, setDrawer] = useState<Drawer>('none');
  const [drawerIdx, setDrawerIdx] = useState(0);
  const rowRef = useRef<Row>('none');
  const idxRef = useRef(0);
  const drawerRef = useRef<Drawer>('none');
  const drawerIdxRef = useRef(0);
  const drawerItemsRef = useRef<DrawerItem[]>([]);
  const playingRef = useRef(true);
  playingRef.current = playing;

  useEffect(() => {
    player.replace(current.url);
    player.play();
    setRevealed(false);
    setTime(0);
    setDuration(0);
    setErrored(false);
    setAudioTracks([]);
    setSubTracks([]);
    skippedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (errored && !skippedRef.current && index < playlist.length - 1) {
      skippedRef.current = true;
      setIndex((i) => i + 1);
    }
  }, [errored, index, playlist.length]);

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

  useEffect(() => {
    if (skippedRef.current) return;
    if (duration > 0 && duration <= DMCA_MAX_SECONDS && index < playlist.length - 1) {
      skippedRef.current = true;
      setIndex((i) => i + 1);
    }
  }, [duration, index, playlist.length]);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEvt = useRef<{ type: string; at: number }>({ type: '', at: 0 });
  const lastOk = useRef(0);

  const bumpControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (rowRef.current === 'none' && drawerRef.current === 'none' && playingRef.current) setControlsVisible(false);
    }, CONTROLS_TIMEOUT);
  };

  const goRow = (r: Row, i = 0) => {
    rowRef.current = r;
    idxRef.current = i;
    setRow(r);
    setIdx(i);
    bumpControls();
  };

  const openDrawer = (d: Drawer) => {
    drawerRef.current = d;
    drawerIdxRef.current = 0;
    setDrawer(d);
    setDrawerIdx(0);
    setControlsVisible(true);
  };
  const closeDrawer = () => {
    drawerRef.current = 'none';
    setDrawer('none');
    goRow('bottom', BOTTOM.indexOf(drawer === 'audio' ? 'audio' : 'subtitles'));
  };

  useEffect(() => {
    bumpControls();
    const id = setInterval(() => {
      setTime(player.currentTime ?? 0);
      const d = player.duration ?? 0;
      if (d > 0) setDuration(d);
      setPlaying(player.playing);
      if ((player as { status?: string }).status === 'error') setErrored(true);
      const p = player as unknown as {
        availableAudioTracks?: Track[];
        availableSubtitleTracks?: Track[];
        audioTrack?: Track | null;
        subtitleTrack?: Track | null;
      };
      if (p.availableAudioTracks) setAudioTracks(p.availableAudioTracks);
      if (p.availableSubtitleTracks) setSubTracks(p.availableSubtitleTracks);
      setCurAudio(p.audioTrack?.id ?? null);
      setCurSub(p.subtitleTrack?.id ?? null);
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

  // Build the drawer item list for the active tab.
  const trackLabel = (t: Track, fallback: string) => t.label || t.language || fallback;
  const drawerItems: DrawerItem[] =
    drawer === 'audio'
      ? audioTracks.map((t) => ({ id: t.id, label: trackLabel(t, 'Audio'), meta: t.language, active: t.id === curAudio }))
      : drawer === 'subtitles'
        ? [{ id: 'off', label: 'Off', meta: 'No Subtitles', active: curSub == null }, ...subTracks.map((t) => ({ id: t.id, label: trackLabel(t, 'Subtitle'), meta: t.language, active: t.id === curSub }))]
        : [];
  drawerItemsRef.current = drawerItems;

  const applyDrawer = () => {
    const items = drawerItemsRef.current;
    const it = items[drawerIdxRef.current];
    if (!it) return;
    const p = player as unknown as { audioTrack?: Track | null; subtitleTrack?: Track | null };
    if (drawerRef.current === 'audio') {
      const t = audioTracks.find((x) => x.id === it.id);
      if (t) { p.audioTrack = t; setCurAudio(t.id); toast.show(`Audio: ${it.label}`); }
    } else {
      if (it.id === 'off') { p.subtitleTrack = null; setCurSub(null); toast.show('Subtitles: Off'); }
      else {
        const t = subTracks.find((x) => x.id === it.id);
        if (t) { p.subtitleTrack = t; setCurSub(t.id); toast.show(`Subtitles: ${it.label}`); }
      }
    }
    closeDrawer();
  };

  const runBottom = (id: (typeof BOTTOM)[number]) => {
    if (id === 'play') { togglePlay(); return false; }
    if (id === 'subtitles') { openDrawer('subtitles'); return true; }
    if (id === 'audio') { openDrawer('audio'); return true; }
    return false;
  };
  const runTop = (id: (typeof TOP)[number]) => {
    if (id === 'back') navigation.goBack();
    // watchparty: backlog
  };

  useTVEventHandler((evt) => {
    const type = evt?.eventType;
    if (!type) return;
    const now = Date.now();
    if (lastEvt.current.type === type && now - lastEvt.current.at < 180) return;
    lastEvt.current = { type, at: now };

    // ---- Drawer owns the D-pad while open (Left/Back closes it) ----
    if (drawerRef.current !== 'none') {
      const len = drawerItemsRef.current.length;
      switch (type) {
        case 'down':
          drawerIdxRef.current = Math.min(len - 1, drawerIdxRef.current + 1);
          setDrawerIdx(drawerIdxRef.current);
          break;
        case 'up':
          drawerIdxRef.current = Math.max(0, drawerIdxRef.current - 1);
          setDrawerIdx(drawerIdxRef.current);
          break;
        case 'left':
        case 'rewind':
          closeDrawer();
          break;
        case 'select':
          if (now - lastOk.current < 300) break;
          lastOk.current = now;
          applyDrawer();
          break;
        case 'playPause':
          togglePlay();
          break;
        default:
          break;
      }
      return;
    }

    const r = rowRef.current;
    const i = idxRef.current;
    switch (type) {
      case 'select': {
        if (now - lastOk.current < 300) break;
        lastOk.current = now;
        if (r === 'bottom') { const stay = runBottom(BOTTOM[i]); if (!stay) goRow('none'); }
        else if (r === 'top') { runTop(TOP[i]); goRow('none'); }
        else {
          const wasPlaying = playingRef.current;
          togglePlay();
          if (wasPlaying) goRow('bottom', 0);
        }
        break;
      }
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
      case 'down':
        if (r === 'none') goRow('bottom', 0);
        else if (r === 'top') goRow('none');
        else bumpControls();
        break;
      case 'up':
        if (r === 'none') goRow('top', 0);
        else if (r === 'bottom') goRow('none');
        else bumpControls();
        break;
      case 'right':
      case 'fastForward':
        if (r === 'bottom') goRow('bottom', Math.min(BOTTOM.length - 1, i + 1));
        else if (r === 'top') goRow('top', Math.min(TOP.length - 1, i + 1));
        else seek(SEEK_STEP);
        break;
      case 'left':
      case 'rewind':
        if (r === 'bottom') goRow('bottom', Math.max(0, i - 1));
        else if (r === 'top') goRow('top', Math.max(0, i - 1));
        else seek(-SEEK_STEP);
        break;
      default:
        bumpControls();
    }
  });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawerRef.current !== 'none') { closeDrawer(); return true; }
      if (rowRef.current !== 'none') { goRow('none'); return true; }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer]);

  const pct = duration > 0 ? Math.min(1, time / duration) : 0;
  const badges = [detectSource(current.url)?.code, is4kTitle(current.title) ? '4K' : null, isHdrTitle(current.title) ? 'HDR' : null].filter(Boolean) as string[];
  const bf = (id: (typeof BOTTOM)[number]) => row === 'bottom' && BOTTOM[idx] === id;
  const tf = (id: (typeof TOP)[number]) => row === 'top' && TOP[idx] === id;
  const drawerOpen = drawer !== 'none';

  return (
    <View style={styles.root} focusable hasTVPreferredFocus>
      <VideoView player={player} style={[StyleSheet.absoluteFill, { opacity: revealed ? 1 : 0 }]} contentFit="contain" nativeControls={false} />

      <BufferingVeil visible={!revealed} logo={params.logo} />

      <PauseOverlay
        visible={!playing && revealed && !drawerOpen}
        logo={params.logo}
        title={params.title}
        description={params.description}
        releaseInfo={params.releaseInfo}
        imdbId={params.imdbId}
        rating={params.rating}
        duration={duration}
      />

      {/* TOP OVERLAY */}
      {controlsVisible && !drawerOpen ? (
        <LinearGradient colors={['rgba(0,0,0,0.8)', 'rgba(0,0,0,0.5)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: m.s(24), paddingTop: m.s(24), paddingBottom: m.s(16) }} pointerEvents="none">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m.s(12) }}>
            <BackPill m={m} title={params.title} focused={tf('back')} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(12) }}>
              <SourceBadges m={m} badges={badges} />
              <WatchPartyButton m={m} focused={tf('watchparty')} />
            </View>
          </View>
        </LinearGradient>
      ) : null}

      {/* BOTTOM CONTROLS — scrub strip + transport row (play / subtitles / audio). */}
      {controlsVisible && !drawerOpen ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} pointerEvents="none">
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']} style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(16), paddingHorizontal: m.s(22), paddingTop: m.s(40), paddingBottom: m.s(6) }}>
            <Text style={timeStyle(m)}>{fmt(time)}</Text>
            <View style={{ flex: 1, height: m.s(4), borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center' }}>
              <View style={{ position: 'absolute', left: 0, height: m.s(4), borderRadius: 999, width: `${pct * 100}%`, backgroundColor: ACCENT }} />
              <View style={{ position: 'absolute', left: `${pct * 100}%`, width: m.s(12), height: m.s(12), borderRadius: 999, marginLeft: -m.s(6), backgroundColor: '#fff' }} />
            </View>
            <Text style={[timeStyle(m), { textAlign: 'right' }]}>{fmt(duration)}</Text>
          </LinearGradient>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: m.s(18), paddingVertical: m.s(10) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
              <PlayerIconBtn m={m} focused={bf('play')}>{(c) => <PlayIcon m={m} paused={!playing} color={c} />}</PlayerIconBtn>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(4) }}>
              <PlayerIconBtn m={m} focused={bf('subtitles')}>{(c) => <SubsIcon m={m} color={c} />}</PlayerIconBtn>
              <PlayerIconBtn m={m} focused={bf('audio')}>{(c) => <AudioIcon m={m} color={c} />}</PlayerIconBtn>
            </View>
          </View>
        </View>
      ) : null}

      {/* Settings drawer (Audio / Subtitles) — slides in from the right. */}
      <SettingsDrawer open={drawerOpen} tab={drawer === 'audio' ? 'audio' : 'subtitles'} items={drawerItems} selIdx={drawerIdx} />
    </View>
  );
}

function timeStyle(m: ReturnType<typeof useMetrics>) {
  return { minWidth: m.s(56), fontFamily: font.body, fontSize: m.s(16), color: '#fff' } as const;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
