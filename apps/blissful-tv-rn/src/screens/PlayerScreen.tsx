import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, useTVEventHandler, View } from 'react-native';
import { font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useToast } from '../components/Toast';
import { BufferingVeil } from '../components/player/BufferingVeil';
import { PauseOverlay } from '../components/player/PauseOverlay';
import { SettingsDrawer, type DrawerAudioTrack, type DrawerRelease, type DrawerSubtitleTrack } from '../components/player/SettingsDrawer';
import { AudioIcon, BackPill, PlayIcon, PlayerIconBtn, ReleasesIcon, SourceBadges, SubsIcon, WatchPartyButton } from '../components/player/PlayerControls';
import { detectSource, is4kTitle, isHdrTitle, normColor, toRgba } from '../lib/colorUtils';
import { readTvSettings, writeTvSettings } from '../lib/tvSettings';
import { subtitleLangLabel, loadSubtitles, type SubtitleTrack } from '../lib/subtitles';
import { activeCueText, fetchSubtitleCues, type SubtitleCue } from '../lib/subtitleCues';
import { SubtitleOverlay } from '../components/player/SubtitleOverlay';
import { loadStreams, type PickerStream } from '../lib/streamPicker';
import { useAuth } from '../context/AuthContext';
import { updateBlissfulLibraryProgress } from '@blissful/core';
import type { RootStackParamList } from '../navigation/types';

type PlayerRoute = RouteProp<RootStackParamList, 'Player'>;
type PlayerNav = StackNavigationProp<RootStackParamList, 'Player'>;
const SEEK_STEP = 10;
const CONTROLS_TIMEOUT = 3500;
const ACCENT = '#95a2ff';
const DMCA_MAX_SECONDS = 45;

// Two playback control rows (TV has no volume/mute/fullscreen — the remote owns
// volume and the app is always fullscreen). Walked by virtual index. `releases`
// is the cloud button that opens the drawer's Releases tab (switch torrent),
// mirroring OpenCode's BlissfulPlayer bottom controls.
type Row = 'none' | 'bottom' | 'top';
type Drawer = 'none' | 'audio' | 'subtitles' | 'releases';
const BOTTOM = ['play', 'subtitles', 'audio', 'releases'] as const;
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

// The subtitle text-color is stored in TV settings as rgba (the account format).
// Normalise (strip spaces / lowercase) so the player's Customize Appearance grid
// can highlight the saved swatch — and any custom colour still renders.
function seedSubColor(stored: string | null | undefined): string {
  return normColor(toRgba(stored));
}

export function PlayerScreen() {
  const { params } = useRoute<PlayerRoute>();
  const navigation = useNavigation<PlayerNav>();
  const m = useMetrics();
  const toast = useToast();
  const { token } = useAuth();

  // The ranked playable list + start index (auto-advances past a debrid DMCA
  // placeholder). The Releases tab swaps the whole list to a different release's
  // ranked playlist (keyed by url, so the player reloads).
  const [playlist, setPlaylist] = useState(params.playlist?.length ? params.playlist : [{ url: params.url, title: params.title }]);
  const [index, setIndex] = useState(Math.min(params.startIndex ?? 0, playlist.length - 1));
  const current = playlist[index] ?? playlist[0];
  // All releases for this title (full picker rows), lazily fetched when the
  // Releases tab is opened. loadStreams caches per-title so it's instant after
  // the Detail page already loaded them.
  const [releases, setReleases] = useState<PickerStream[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const releasesFetched = useRef(false);
  const skippedRef = useRef(false);
  const autoSubRef = useRef(false); // whether we've auto-loaded the preferred subtitle for this file

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

  // Embedded audio / subtitle tracks (from expo-video).
  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [subTracks, setSubTracks] = useState<Track[]>([]);
  const [curAudio, setCurAudio] = useState<string | null>(null);
  const [curSub, setCurSub] = useState<string | null>(null);
  // Addon-provided EXTERNAL subtitles — these we fetch + parse + render ourselves
  // (SubtitleOverlay) so the saved colour/background/outline/size apply (expo-video
  // can't style its native subtitle rendering; the web styles cues via ::cue, mpv
  // via sub-color). `cues` = the active external sub's parsed cues; `curExtId` =
  // the selected external sub.
  const [extTracks, setExtTracks] = useState<SubtitleTrack[]>([]);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [curExtId, setCurExtId] = useState<string | null>(null);
  const cueLoadRef = useRef(0);

  // Subtitle appearance. Text colour/size/delay are tweakable in the player drawer;
  // background + outline come from the saved profile. Seeded from TV settings.
  const tvs = readTvSettings();
  const [subSizePx, setSubSizePx] = useState(tvs.subtitlesSizePx ?? 28);
  const [subColor, setSubColor] = useState(() => seedSubColor(tvs.subtitlesTextColor));
  const [subDelay, setSubDelay] = useState(0);
  const subBg = toRgba(tvs.subtitlesBackgroundColor);
  const subOutline = toRgba(tvs.subtitlesOutlineColor);

  // Virtual focus position (playback rows) + the settings drawer. The drawer is
  // self-contained — it owns its own D-pad, so we only track which one is open.
  const [row, setRow] = useState<Row>('none');
  const [idx, setIdx] = useState(0);
  const [drawer, setDrawer] = useState<Drawer>('none');
  const rowRef = useRef<Row>('none');
  const idxRef = useRef(0);
  const drawerRef = useRef<Drawer>('none');
  const revealedRef = useRef(false);
  revealedRef.current = revealed;
  // THE single source of truth for play/pause. `userPausedRef.current === false`
  // means "the user wants it playing". We never branch the toggle on the engine's
  // `player.playing` getter — in expo-video that getter is unreliable right after
  // a load/seek (it reports the wrong value), which made OK pick the wrong branch
  // so you couldn't unpause. The engine is only ever READ in the interval to
  // RE-ASSERT this intent (drift after a seek/rebuffer), never to flip it.
  const userPausedRef = useRef(false);
  // Collapses a single physical OK press that fires BOTH `select` and `playPause`
  // into one toggle (otherwise the pair double-toggles back to paused).
  const lastToggleRef = useRef(0);

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
    autoSubRef.current = false;
    // Key on the URL (not just index) so switching to a different release via the
    // Sources picker — which may land on the same index — still reloads the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.url]);

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
        // The resume seek can leave the engine paused — keep it playing.
        player.play();
        setPlaying(true);
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

  // Timestamp of the last "show controls" / user activity. The idle auto-hide is
  // driven by the 400ms playback interval (below) comparing against this — NOT a
  // setTimeout — so nothing can clear/re-arm it into staying open forever.
  const lastActivityRef = useRef(0);
  const lastEvt = useRef<{ type: string; at: number }>({ type: '', at: 0 });
  const lastOk = useRef(0);

  // Auto-hide controls (copied 1:1 from the desktop NativeMpvPlayer.showControls):
  // show + clear the timer, and ONLY arm the 3s idle-hide once the first frame has
  // rendered (timeRef > 0) and we're not user-paused. The timer itself just hides
  // unconditionally — no re-check on fire (that was what kept it open). While the
  // torrent buffers (time === 0) the chrome stays pinned so Back is reachable.
  const bumpControls = () => {
    setControlsVisible(true);
    lastActivityRef.current = Date.now();
  };

  const goRow = (r: Row, i = 0) => {
    rowRef.current = r;
    idxRef.current = i;
    setRow(r);
    setIdx(i);
    bumpControls();
  };

  // Mirrors the desktop's `hasFirstFrame` effect: once the video is ready
  // (revealed = past the buffering veil), call showControls so the 3s idle-hide
  // timer is armed. Before that the chrome stays pinned.
  useEffect(() => {
    if (revealed) bumpControls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);


  const openDrawer = (d: Drawer) => {
    drawerRef.current = d;
    setDrawer(d);
    setControlsVisible(true);
  };
  const closeDrawer = () => {
    const was = drawerRef.current;
    drawerRef.current = 'none';
    setDrawer('none');
    const back = was === 'audio' ? 'audio' : was === 'releases' ? 'releases' : 'subtitles';
    goRow('bottom', BOTTOM.indexOf(back));
  };

  // Lazily load the full release list for the Releases tab (cached in
  // streamPicker, so this is instant once the Detail page has loaded it).
  const fetchReleases = () => {
    if (releasesFetched.current || !params.streamTarget) return;
    releasesFetched.current = true;
    setReleasesLoading(true);
    loadStreams(token, params.streamTarget.type, params.streamTarget.id)
      .then(setReleases)
      .catch(() => { /* keep empty — the tab shows "no releases" */ })
      .finally(() => setReleasesLoading(false));
  };
  // Switch to a different release: rebuild the ranked playable playlist starting
  // at the chosen url (so DMCA auto-advance still works), then close the drawer.
  const onSelectRelease = (url: string) => {
    const playable = releases.filter((r) => r.url).map((r) => ({ url: r.url as string, title: r.title }));
    const idx = Math.max(0, playable.findIndex((p) => p.url === url));
    if (playable.length) { setPlaylist(playable); setIndex(idx); }
    closeDrawer();
  };

  // Persist watch progress to the cloud library so Continue Watching tracks it
  // (mirrors the desktop player's periodic save). Library item id = the SHOW/movie
  // id (detailId); videoId = the episode id for series. Throttled to ~15s while
  // playing + one final write on unmount (Back / app exit).
  const timeRef = useRef(0);
  const durationRef = useRef(0);
  const lastSaveRef = useRef(0);
  const saveProgress = () => {
    const st = params.streamTarget;
    const t = timeRef.current;
    const d = durationRef.current;
    if (!token || !st || !params.detailId || d <= 0 || t <= 0) return;
    void updateBlissfulLibraryProgress(token, {
      id: params.detailId,
      type: st.type,
      videoId: st.type === 'series' ? st.id : null,
      timeSeconds: t,
      durationSeconds: d,
      name: params.title,
      poster: params.poster ?? null,
      streamUrl: current.url,
      streamTitle: current.title,
    }).catch(() => { /* best-effort; offline = retry next tick */ });
  };
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  // Final write when leaving the player.
  useEffect(() => () => saveProgressRef.current(), []);

  useEffect(() => {
    bumpControls();
    const id = setInterval(() => {
      setTime(player.currentTime ?? 0);
      const d = player.duration ?? 0;
      if (d > 0) setDuration(d);
      // Track latest position for the progress save (refs so the save closure +
      // unmount handler read fresh values).
      timeRef.current = player.currentTime ?? 0;
      durationRef.current = d > 0 ? d : durationRef.current;
      if (revealedRef.current && player.playing && Date.now() - lastSaveRef.current > 15000) {
        lastSaveRef.current = Date.now();
        saveProgressRef.current();
      }
      // Drive the engine to match the user's INTENT (userPausedRef) — expo-video
      // drifts (a seek/rebuffer leaves it paused; a stale play() leaves it
      // playing), so re-assert every tick. Display mirrors INTENT, never the flaky
      // getter, so the pause overlay/icon don't flicker during buffering/seek.
      if (revealedRef.current) {
        if (!userPausedRef.current) {
          if (!player.playing && (player.currentTime ?? 0) < (player.duration ?? 1) - 1) player.play();
        } else if (player.playing) {
          player.pause();
        }
        setPlaying(!userPausedRef.current);
      }
      // Idle auto-hide (the desktop's 3s mouse-idle hide, TV-shaped): once the
      // video is revealed, not user-paused, and no drawer is open, hide the chrome
      // after CONTROLS_TIMEOUT of no activity. setControlsVisible(false) is a no-op
      // when already hidden, so this is cheap to re-check every tick.
      if (revealedRef.current && !userPausedRef.current && drawerRef.current === 'none' && Date.now() - lastActivityRef.current > CONTROLS_TIMEOUT) {
        setControlsVisible(false);
      }
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // Fetch the addon EXTERNAL subtitles for this content (per-title, cached).
  useEffect(() => {
    const st = params.streamTarget;
    if (!st) return;
    let cancelled = false;
    const ctrl = new AbortController();
    loadSubtitles({ type: st.type, id: st.id, token, signal: ctrl.signal })
      .then((res) => { if (!cancelled) setExtTracks(res.tracks); })
      .catch(() => { /* no addon subs — embedded still available */ });
    return () => { cancelled = true; ctrl.abort(); };
  }, [params.streamTarget, token]);

  // Auto-load the preferred-language subtitle once tracks are available — prefer
  // an EXTERNAL sub (we render it styled), falling back to embedded. Fires once.
  useEffect(() => {
    if (autoSubRef.current) return;
    const pref = (tvs.subtitlesLanguage ?? '').trim().toLowerCase();
    if (!pref || pref === 'none') return;
    const matches = (lang: string | null | undefined) => {
      const l = (lang ?? '').toLowerCase();
      return !!l && (pref.startsWith(l) || l.startsWith(pref) || l === pref);
    };
    // Built-in (embedded) first — the old app's order — then external.
    const emb = subTracks.find((t) => matches(t.language));
    if (emb) { autoSubRef.current = true; applySubtitle(emb.id); return; }
    const ext = extTracks.find((t) => matches(t.lang) || matches(t.langName));
    if (ext) { autoSubRef.current = true; applySubtitle(ext.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extTracks, subTracks]);

  const togglePlay = () => {
    const now = Date.now();
    if (now - lastToggleRef.current < 250) return; // collapse select+playPause pair
    lastToggleRef.current = now;
    // Pure intent toggle — flip OUR state, drive the engine to match. Never reads
    // player.playing (unreliable post-load). wantPlay = "were we paused?".
    const wantPlay = userPausedRef.current;
    userPausedRef.current = !wantPlay;
    if (wantPlay) player.play();
    else player.pause();
    setPlaying(wantPlay);
    bumpControls();
  };
  const seek = (delta: number) => {
    player.seekBy(delta);
    bumpControls();
  };

  // Map the engine tracks to the drawer's shapes (embedded tracks only today).
  // Both audio AND subtitle rows/toasts use the CANONICAL English language name,
  // never the engine's embedded label — that comes back localized to the device
  // locale ("английски" on a Bulgarian-locale TV), which we never want to show.
  const langLabel = (t: Track, fallback: string) => {
    const lang = (t.language ?? '').trim();
    return lang ? subtitleLangLabel(lang) : t.label || fallback;
  };
  const drawerAudio: DrawerAudioTrack[] = audioTracks.map((t) => ({ id: t.id, label: langLabel(t, 'Audio'), lang: t.language, codec: null }));
  const drawerSubs: DrawerSubtitleTrack[] = [
    // Built-in (embedded) subs first (the old app's order), then addon subs.
    ...subTracks.map((t) => ({ id: t.id, label: langLabel(t, 'Subtitle'), lang: t.language, embedded: true, origin: 'Embedded' })),
    ...extTracks.map((t) => ({ id: t.id, label: t.langName, lang: t.lang, embedded: false, origin: t.source })),
  ];
  const drawerReleases: DrawerRelease[] = releases.map((r) => ({
    key: r.key,
    quality: r.leftLabel,
    title: r.title,
    meta: [r.metaSize, r.metaSeeders].filter(Boolean).join('   ') || null,
    bucket: r.bucket,
    isRd: r.isRd,
    url: r.url,
  }));

  const applyAudio = (id: string) => {
    const t = audioTracks.find((x) => x.id === id);
    const p = player as unknown as { audioTrack?: Track | null };
    if (t) { p.audioTrack = t; setCurAudio(t.id); toast.show(`Audio: ${langLabel(t, 'Audio')}`); }
  };
  const applySubtitle = (id: string | null) => {
    const p = player as unknown as { subtitleTrack?: Track | null };
    if (id == null) { p.subtitleTrack = null; setCurSub(null); setCurExtId(null); setCues([]); toast.show('Subtitles: Off'); return; }
    const ext = extTracks.find((x) => x.id === id);
    if (ext) {
      // External sub — we render it ourselves (styled overlay); disable the
      // engine's own subtitle so it isn't drawn twice.
      p.subtitleTrack = null; setCurSub(null); setCurExtId(ext.id); setCues([]);
      const my = ++cueLoadRef.current;
      fetchSubtitleCues(ext.url).then((c) => { if (cueLoadRef.current === my) setCues(c); }).catch(() => toast.show('Subtitle failed to load'));
      toast.show('Subtitles loaded', { description: `${ext.langName} - ${ext.source}` });
      return;
    }
    const t = subTracks.find((x) => x.id === id);
    if (t) { p.subtitleTrack = t; setCurSub(t.id); setCurExtId(null); setCues([]); toast.show('Subtitles loaded', { description: `${langLabel(t, 'Subtitle')} - Embedded` }); }
  };

  const runBottom = (id: (typeof BOTTOM)[number]) => {
    if (id === 'play') { togglePlay(); return false; }
    if (id === 'releases') { fetchReleases(); openDrawer('releases'); return true; }
    if (id === 'subtitles') { openDrawer('subtitles'); return true; }
    if (id === 'audio') { openDrawer('audio'); return true; }
    return false;
  };
  // Back from the player lands on the title's Detail page (mirrors the desktop
  // NativeMpvPlayer.onBack). We RESET the stack to [Home, Detail] so the player
  // is gone and Back from that Detail goes Home — regardless of how the player
  // was reached (CW resume straight from Home, or Detail -> Watch).
  const exitToDetail = () => {
    const st = params.streamTarget;
    const id = params.detailId ?? (st ? st.id.split(':')[0] : null);
    if (id && st) {
      // For a series, carry the season/episode (from the episode id imdb:S:E) so
      // the Detail page opens on the episode that was playing. Guard non-numeric
      // ids (e.g. kitsu) → undefined.
      const parts = st.id.split(':');
      const sNum = Number(parts[parts.length - 2]);
      const eNum = Number(parts[parts.length - 1]);
      const hasSE = st.type === 'series' && parts.length >= 3 && Number.isFinite(sNum) && Number.isFinite(eNum);
      const season = hasSE ? sNum : undefined;
      const episode = hasSE ? eNum : undefined;
      navigation.reset({
        index: 1,
        routes: [
          { name: 'Home' },
          { name: 'Detail', params: { id, type: st.type, name: params.title, poster: params.poster ?? undefined, season, episode } },
        ],
      });
    } else {
      navigation.goBack();
    }
  };
  const runTop = (id: (typeof TOP)[number]) => {
    if (id === 'back') exitToDetail();
    // watchparty: backlog
  };

  useTVEventHandler((evt) => {
    const type = evt?.eventType;
    if (!type) return;
    const now = Date.now();
    if (lastEvt.current.type === type && now - lastEvt.current.at < 180) return;
    lastEvt.current = { type, at: now };

    // The self-contained drawer owns the D-pad while open — stand our handler
    // down so two handlers never both act on the same key.
    if (drawerRef.current !== 'none') return;

    const r = rowRef.current;
    const i = idxRef.current;
    switch (type) {
      case 'select': {
        if (now - lastOk.current < 300) break;
        lastOk.current = now;
        if (r === 'bottom') { const stay = runBottom(BOTTOM[i]); if (!stay) goRow('none'); }
        else if (r === 'top') { runTop(TOP[i]); goRow('none'); }
        else {
          const wasPlaying = !userPausedRef.current;
          togglePlay();
          if (wasPlaying) goRow('bottom', 0);
        }
        break;
      }
      case 'playPause':
        togglePlay();
        break;
      case 'play':
        userPausedRef.current = false;
        player.play();
        setPlaying(true);
        bumpControls();
        break;
      case 'pause':
        userPausedRef.current = true;
        player.pause();
        setPlaying(false);
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
      // Back always exits to the title's Detail page (incl. while buffering).
      exitToDetail();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer]);

  // During initial buffering (no real duration yet) the scrub shows --:-- and sits
  // at 0% — mirrors the desktop BottomControls.formatTime, which returns --:-- for
  // an invalid time. Once the real video reveals (duration > placeholder), the
  // real times appear.
  const pct = revealed && duration > 0 ? Math.min(1, time / duration) : 0;
  const badges = [detectSource(current.url)?.code, is4kTitle(current.title) ? '4K' : null, isHdrTitle(current.title) ? 'HDR' : null].filter(Boolean) as string[];
  const bf = (id: (typeof BOTTOM)[number]) => row === 'bottom' && BOTTOM[idx] === id;
  const tf = (id: (typeof TOP)[number]) => row === 'top' && TOP[idx] === id;
  const drawerOpen = drawer !== 'none';

  return (
    <View style={styles.root} focusable hasTVPreferredFocus>
      <VideoView player={player} style={[StyleSheet.absoluteFill, { opacity: revealed ? 1 : 0 }]} contentFit="contain" nativeControls={false} />

      {/* Buffering logo overlay — the title's logo pulsing on the black root while
          the torrent loads, with the full player chrome shown ON TOP (z below the
          controls). Matches the desktop BufferingOverlay (logo, not a blocking
          black sheet) so the Back pill / controls stay reachable. */}
      <BufferingVeil visible={!revealed} logo={params.logo} />

      {/* Styled subtitle overlay — we render the active external cue ourselves so
          the saved colour/background/outline/size apply (expo-video can't style
          its native subtitle rendering). */}
      {revealed ? (
        <SubtitleOverlay
          text={curExtId ? activeCueText(cues, time, subDelay) : null}
          sizePx={subSizePx}
          color={subColor}
          bg={subBg}
          outline={subOutline}
          m={m}
        />
      ) : null}

      <PauseOverlay
        visible={!playing && revealed}
        logo={params.logo}
        title={params.title}
        description={params.description}
        releaseInfo={params.releaseInfo}
        imdbId={params.imdbId}
        rating={params.rating}
        duration={duration}
      />

      {/* TOP OVERLAY — full chrome (Back + badges + watch-party), shown over the
          buffering logo too so Back stays reachable while the torrent loads. */}
      {controlsVisible && !drawerOpen ? (
        <LinearGradient colors={['rgba(0,0,0,0.8)', 'rgba(0,0,0,0.5)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, paddingHorizontal: m.s(24), paddingTop: m.s(24), paddingBottom: m.s(16) }} pointerEvents="none">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m.s(12) }}>
            <BackPill m={m} title={params.title} focused={tf('back')} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(12) }}>
              <SourceBadges m={m} badges={badges} />
              <WatchPartyButton m={m} focused={tf('watchparty')} />
            </View>
          </View>
        </LinearGradient>
      ) : null}

      {/* BOTTOM CONTROLS — scrub strip + transport row (play / subtitles / audio).
          Shown during buffering too (scrub reads --:--), z above the logo overlay. */}
      {controlsVisible && !drawerOpen ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20 }} pointerEvents="none">
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']} style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(16), paddingHorizontal: m.s(22), paddingTop: m.s(40), paddingBottom: m.s(6) }}>
            <Text style={timeStyle(m)}>{revealed ? fmt(time) : '--:--'}</Text>
            <View style={{ flex: 1, height: m.s(4), borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center' }}>
              <View style={{ position: 'absolute', left: 0, height: m.s(4), borderRadius: 999, width: `${pct * 100}%`, backgroundColor: ACCENT }} />
              <View style={{ position: 'absolute', left: `${pct * 100}%`, width: m.s(12), height: m.s(12), borderRadius: 999, marginLeft: -m.s(6), backgroundColor: '#fff' }} />
            </View>
            <Text style={[timeStyle(m), { textAlign: 'right' }]}>{revealed ? fmt(duration) : '--:--'}</Text>
          </LinearGradient>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: m.s(18), paddingVertical: m.s(10) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
              <PlayerIconBtn m={m} focused={bf('play')}>{(c) => <PlayIcon m={m} paused={!playing} color={c} />}</PlayerIconBtn>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(4) }}>
              <PlayerIconBtn m={m} focused={bf('subtitles')}>{(c) => <SubsIcon m={m} color={c} />}</PlayerIconBtn>
              <PlayerIconBtn m={m} focused={bf('audio')}>{(c) => <AudioIcon m={m} color={c} />}</PlayerIconBtn>
              <PlayerIconBtn m={m} focused={bf('releases')}>{(c) => <ReleasesIcon m={m} color={c} />}</PlayerIconBtn>
            </View>
          </View>
        </View>
      ) : null}

      {/* Settings drawer (Releases / Audio / Subtitles) — slides in from the
          right, native D-pad focus (X / Back / Left closes). Mounted only while
          open so the focus trap reliably claims focus on entry. */}
      {drawerOpen ? (
        <SettingsDrawer
          initialTab={drawer === 'audio' ? 'audio' : drawer === 'releases' ? 'releases' : 'subtitles'}
          onClose={closeDrawer}
          releases={drawerReleases}
          releasesLoading={releasesLoading}
          currentReleaseUrl={current.url}
          onSelectRelease={onSelectRelease}
          audioTracks={drawerAudio}
          currentAudioId={curAudio}
          onApplyAudio={applyAudio}
          subtitleTracks={drawerSubs}
          currentSubtitleId={curExtId ?? curSub}
          onApplySubtitle={applySubtitle}
          subtitleSizePx={subSizePx}
          onSubtitleSizePxChange={setSubSizePx}
          subtitleColor={subColor}
          onSubtitleColorChange={setSubColor}
          subtitleDelay={subDelay}
          onSubtitleDelayChange={setSubDelay}
          onSaveAppearance={() => {
            // Persist size + colour to TV settings (rgba) so reopening highlights
            // the saved swatch; mirrors the desktop SettingsPanel "Save to account".
            try {
              writeTvSettings({ ...readTvSettings(), subtitlesSizePx: subSizePx, subtitlesTextColor: subColor });
            } catch {
              /* best-effort local cache */
            }
            toast.show('Subtitle appearance saved');
            closeDrawer();
          }}
          defaultSubtitleSizePx={tvs.subtitlesSizePx ?? 28}
          defaultSubtitleColor={seedSubColor(tvs.subtitlesTextColor)}
        />
      ) : null}
    </View>
  );
}

function timeStyle(m: ReturnType<typeof useMetrics>) {
  return { minWidth: m.s(56), fontFamily: font.body, fontSize: m.s(16), color: '#fff' } as const;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
