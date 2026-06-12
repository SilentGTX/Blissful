import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, useTVEventHandler, View } from 'react-native';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useToast } from '../components/Toast';
import { BufferingVeil } from '../components/player/BufferingVeil';
import { PauseOverlay } from '../components/player/PauseOverlay';
import { SettingsDrawer, type DrawerAudioTrack, type DrawerRelease, type DrawerSubtitleTrack } from '../components/player/SettingsDrawer';
import { EpisodesDrawer, isUnaired, type DrawerEpisode } from '../components/player/EpisodesDrawer';
import { WatchPartyDrawer } from '../components/player/WatchPartyDrawer';
import { WatchPartyToast } from '../components/player/WatchPartyToast';
import { useWatchPartyRoom } from '../lib/useWatchPartyRoom';
import { createWatchPartyRoom, getOrCreateGuestUserId, getStashedWatchPartyPassword, getStoredGuestName, getWatchPartyRoom, stashWatchPartyPassword, clearWatchPartyPassword, type WatchPartyRoomInfo } from '../lib/watchParty';
import { AudioIcon, BackPill, EpisodesIcon, NextEpisodeIcon, PlayIcon, PlayerIconBtn, PlayerLabelBtn, ReleasesIcon, SourceBadges, SubsIcon, WatchPartyButton } from '../components/player/PlayerControls';
import { detectSource, is4kTitle, isHdrTitle, normColor, toRgba } from '../lib/colorUtils';
import { readTvSettings, writeTvSettings } from '../lib/tvSettings';
import { subtitleLangLabel, loadSubtitles, type SubtitleTrack } from '../lib/subtitles';
import { activeCueText, fetchSubtitleCues, type SubtitleCue } from '../lib/subtitleCues';
import { SubtitleOverlay } from '../components/player/SubtitleOverlay';
import { formatFullDate } from '../lib/releaseInfo';
import { setCurrentActivity, clearCurrentActivity } from '../lib/presence';
import { loadStreams, type PickerStream } from '../lib/streamPicker';
import { resolveMeta } from '../lib/metaResolver';
import { useAuth } from '../context/AuthContext';
import { getStorageBaseUrl, normalizeStremioImage, updateBlissfulLibraryProgress } from '@blissful/core';
import type { RootStackParamList } from '../navigation/types';

type PlayerRoute = RouteProp<RootStackParamList, 'Player'>;
type PlayerNav = StackNavigationProp<RootStackParamList, 'Player'>;
const SEEK_STEP = 10;
const CONTROLS_TIMEOUT = 3500;
const DMCA_MAX_SECONDS = 45;

// Two playback control rows (TV has no volume/mute/fullscreen — the remote owns
// volume and the app is always fullscreen). Walked by virtual index. `releases`
// is the cloud button that opens the drawer's Releases tab (switch torrent),
// mirroring OpenCode's BlissfulPlayer bottom controls. Series additionally get
// `next` (instant next-episode jump) + `episodes` (the episode-selector drawer),
// matching the desktop BottomControls order.
type Row = 'none' | 'bottom' | 'top';
type Drawer = 'none' | 'audio' | 'subtitles' | 'releases' | 'episodes' | 'watchparty';
const BOTTOM_SERIES = ['play', 'next', 'episodes', 'subtitles', 'audio', 'releases'] as const;
const BOTTOM_MOVIE = ['play', 'subtitles', 'audio', 'releases'] as const;
type BottomId = (typeof BOTTOM_SERIES)[number];
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
  const { token, user } = useAuth();

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

  // ── Series episodes (next-episode button + the Episodes drawer) ────────────
  const isSeries = params.streamTarget?.type === 'series';
  const bottom: readonly BottomId[] = isSeries ? BOTTOM_SERIES : BOTTOM_MOVIE;
  // The show's full episode list (sorted by season/episode, specials last) from
  // the show meta — fetched once (core caches metas ~5 min, so this is usually
  // instant after the Detail page).
  const [seriesVideos, setSeriesVideos] = useState<DrawerEpisode[]>([]);
  useEffect(() => {
    if (!isSeries || !params.detailId) return;
    let cancelled = false;
    // Route through the OWNING addon — raw fetchMeta defaults to Cinemeta, which
    // has no addon-specific ids (e.g. Anime Kitsu's `kitsu:NNN`), so it 404s to an
    // empty meta and the Episodes drawer shows "No episodes found". resolveMeta is
    // the same addon-routed resolver the Detail page uses.
    resolveMeta('series', params.detailId, token)
      .then((r) => {
        if (cancelled || !r) return;
        const vids: DrawerEpisode[] = (r.meta.videos ?? []).map((v) => {
          const extra = v as { overview?: string; description?: string };
          return {
            id: v.id,
            title: v.title ?? v.name ?? null,
            season: typeof v.season === 'number' ? v.season : null,
            episode: typeof v.episode === 'number' ? v.episode : null,
            thumbnail: normalizeStremioImage(v.thumbnail) ?? null,
            released: v.released ?? null,
            description: extra.overview ?? extra.description ?? null,
          };
        });
        const ord = (s: number | null) => (s && s > 0 ? s : Number.MAX_SAFE_INTEGER); // specials (S0) last
        vids.sort((a, b) => ord(a.season) - ord(b.season) || (a.episode ?? 0) - (b.episode ?? 0));
        setSeriesVideos(vids);
      })
      .catch(() => { /* no meta — the next/episodes buttons stay dimmed/empty */ });
    return () => { cancelled = true; };
  }, [isSeries, params.detailId, token]);
  // The episode after the playing one in broadcast order (desktop nextEpisodeInfo).
  const nextEp = useMemo(() => {
    const id = params.streamTarget?.id;
    if (!id || seriesVideos.length === 0) return null;
    const i = seriesVideos.findIndex((v) => v.id === id);
    return i >= 0 ? seriesVideos[i + 1] ?? null : null;
  }, [seriesVideos, params.streamTarget?.id]);
  const nextUnaired = nextEp ? isUnaired(nextEp) : false;
  // The CURRENT episode (for the pause overlay's "Season N · Episode M" + title +
  // summary). From the loaded show videos, matched by the playing episode id.
  const currentEp = useMemo(() => {
    const id = params.streamTarget?.id;
    if (!isSeries || !id) return null;
    return seriesVideos.find((v) => v.id === id) ?? null;
  }, [seriesVideos, params.streamTarget?.id, isSeries]);
  // Ref mirror so the Back handler (exitToDetail) always reads the latest match
  // even though its BackHandler closure is only re-bound on `drawer` changes.
  const currentEpRef = useRef<DrawerEpisode | null>(currentEp);
  currentEpRef.current = currentEp;
  // The current episode's TMDB rating (the "6.3 IMDb" pill next to the episode
  // title in the pause overlay). Direct per-season lookup keyed by episode_number
  // via the backend's server-keyed proxy (the web player drawer's approach).
  const [episodeRating, setEpisodeRating] = useState<number | null>(null);
  useEffect(() => {
    setEpisodeRating(null);
    const imdb = params.detailId;
    const s = currentEp?.season;
    const e = currentEp?.episode;
    if (!isSeries || !imdb || s == null || e == null) return;
    let cancelled = false;
    const base = getStorageBaseUrl().replace(/\/storage\/?$/, '');
    void (async () => {
      try {
        const f = await fetch(`${base}/tmdb-find?imdbId=${encodeURIComponent(imdb)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const tid = f && typeof f.tmdbId === 'number' ? (f.tmdbId as number) : null;
        if (!tid || cancelled) return;
        const d = await fetch(`${base}/tmdb-season-info?tmdbId=${tid}&season=${s}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (cancelled) return;
        const ep = ((d?.episodes ?? []) as { episode_number?: number; vote_average?: number }[]).find((x) => x.episode_number === e);
        if (ep && typeof ep.vote_average === 'number' && ep.vote_average > 0) setEpisodeRating(ep.vote_average);
      } catch { /* no rating — title shows without the pill */ }
    })();
    return () => { cancelled = true; };
  }, [isSeries, params.detailId, currentEp?.season, currentEp?.episode]);
  // The drawer's Auto play switch = the account's binge-watching setting. When on,
  // reaching the end of an episode auto-advances to the next aired one (the
  // desktop's EndFile + bingeWatching path).
  const [autoPlay, setAutoPlay] = useState(() => readTvSettings().bingeWatching);
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  const toggleAutoPlay = () => {
    setAutoPlay((prev) => {
      const next = !prev;
      try { writeTvSettings({ ...readTvSettings(), bingeWatching: next }); } catch { /* local cache */ }
      return next;
    });
  };
  const nextEpRef = useRef<DrawerEpisode | null>(null);
  nextEpRef.current = nextEp;
  const endFiredRef = useRef(false);

  const player = useVideoPlayer(current.url, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.preservesPitch = true; // keep audio natural when the watch-party rate-syncs
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
  // When a drawer closes via OK-on-X, the same physical OK can fire a second
  // event (TVs emit select+playPause per press) that the now-active player handler
  // would read as "re-open episodes" (focus is parked on that button). Swallow
  // select/playPause for a beat after a close so the drawer doesn't bounce back.
  const drawerClosedAtRef = useRef(0);
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
    endFiredRef.current = false;
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
    drawerClosedAtRef.current = Date.now();
    setDrawer('none');
    // Watch Party lives on the TOP row; everything else on the bottom.
    if (was === 'watchparty') { goRow('top', TOP.indexOf('watchparty')); return; }
    const back: BottomId = was === 'audio' ? 'audio' : was === 'releases' ? 'releases' : was === 'episodes' ? 'episodes' : 'subtitles';
    goRow('bottom', Math.max(0, bottom.indexOf(back)));
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

  // Report presence "watching <title>" so friends can invite us to a party; clear
  // it when we leave the player (the heartbeat at the app root posts it every 30s).
  useEffect(() => {
    const st = params.streamTarget;
    setCurrentActivity({
      type: st?.type ?? 'movie',
      id: params.detailId ?? st?.id ?? null,
      name: params.title ?? null,
      videoId: st?.type === 'series' ? st?.id ?? null : null,
    });
    return () => clearCurrentActivity();
  }, [params.streamTarget, params.detailId, params.title]);

  // ── Switch to another episode (Next button / Episodes drawer pick) ─────────
  // Mirrors the desktop advanceToNextEpisode/onSelectEpisode: resolve the new
  // episode's ranked streams, then REPLACE the player route so the whole screen
  // remounts with fresh params (progress key, subtitles, badges). While resolving,
  // the black+logo veil covers the screen and merges into the new player's
  // buffering veil (the CW-resume pattern). No streams → the episode's Detail.
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  // Assigned after the watch-party hook below; let the host broadcast an episode
  // change so guests follow (guests don't re-announce).
  const announceEpisodeRef = useRef<(v: string | null) => void>(() => {});
  const isHostRef = useRef(false);
  const switchToEpisode = (video: DrawerEpisode) => {
    if (video.id === params.streamTarget?.id) { if (drawerRef.current !== 'none') closeDrawer(); return; }
    if (isUnaired(video)) {
      const d = formatFullDate(video.released);
      toast.show(d ? `Next episode airs ${d}` : "Next episode hasn't aired yet");
      return;
    }
    if (switchingRef.current) return;
    switchingRef.current = true;
    // Host tells the room to follow; guests just switch locally.
    if (params.roomCode && isHostRef.current) announceEpisodeRef.current(video.id);
    saveProgressRef.current(); // persist the leaving episode's position
    drawerRef.current = 'none';
    setDrawer('none');
    setSwitching(true);
    loadStreams(token, 'series', video.id)
      .then((streams) => {
        const playable = streams.filter((s) => s.url).map((s) => ({ url: s.url as string, title: s.title }));
        if (playable.length === 0) {
          // Desktop fallback: open the episode's Detail page (picker) instead.
          navigation.reset({
            index: 1,
            routes: [
              { name: 'Home' },
              { name: 'Detail', params: { id: params.detailId ?? video.id.split(':')[0], type: 'series', name: params.title, poster: params.poster ?? undefined, season: video.season ?? undefined, episode: video.episode ?? undefined } },
            ],
          });
          return;
        }
        navigation.replace('Player', {
          url: playable[0].url,
          title: params.title,
          playlist: playable,
          startIndex: 0,
          logo: params.logo,
          background: params.background,
          poster: params.poster,
          startSeconds: 0,
          description: params.description,
          releaseInfo: params.releaseInfo,
          imdbId: params.imdbId,
          rating: params.rating,
          streamTarget: { type: 'series', id: video.id, title: params.title },
          detailId: params.detailId,
          roomCode: params.roomCode, // keep the watch party across episode changes
        });
      })
      .catch(() => {
        switchingRef.current = false;
        setSwitching(false);
        toast.show('No streams found for that episode');
      });
  };
  // Fresh closure for the 400ms interval (binge auto-advance at end-of-episode).
  const switchToEpisodeRef = useRef(switchToEpisode);
  switchToEpisodeRef.current = switchToEpisode;

  // ── Watch Party ────────────────────────────────────────────────────────────
  // The room rides on `params.roomCode` (mirrors the desktop `?room=`). A guest
  // needs a display name; a password room needs the stashed password. The button
  // opens the drawer (Open / Join / Active room) — see the render below.
  const [guestId] = useState(() => getOrCreateGuestUserId());
  const [roomInfo, setRoomInfo] = useState<WatchPartyRoomInfo | null>(null);
  const [wpTab, setWpTab] = useState<'open' | 'join'>('open');
  const [creatingRoom, setCreatingRoom] = useState(false);
  const profileName = (user?.displayName ?? '').trim();
  const wpDisplayName = profileName && profileName !== 'Guest' ? profileName : getStoredGuestName();
  const partyPassword = params.roomCode ? getStashedWatchPartyPassword(params.roomCode) : null;
  // Fetch the room meta (hasPassword + gate) whenever the room code changes.
  useEffect(() => {
    if (!params.roomCode) { setRoomInfo(null); return; }
    let cancelled = false;
    getWatchPartyRoom(params.roomCode).then((r) => { if (!cancelled) setRoomInfo(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [params.roomCode]);
  const partyShouldConnect = !!params.roomCode && roomInfo != null && (!roomInfo.hasPassword || !!partyPassword) && !!wpDisplayName;

  const watchParty = useWatchPartyRoom({
    roomCode: partyShouldConnect ? params.roomCode ?? null : null,
    authToken: token,
    guestId: token ? null : guestId,
    displayName: wpDisplayName,
    password: partyPassword,
    onHostEpisodeChange: (videoId) => {
      // The host switched episode — follow them (resolves streams + replaces,
      // preserving the room code).
      const v = videoId ? seriesVideos.find((e) => e.id === videoId) : null;
      if (v) switchToEpisodeRef.current(v);
    },
    getTime: () => player.currentTime ?? 0,
    pausedRef: userPausedRef,
    seek: (s) => { try { player.currentTime = s; } catch { /* not ready */ } },
    play: () => { userPausedRef.current = false; player.play(); setPlaying(true); },
    pause: () => { userPausedRef.current = true; player.pause(); setPlaying(false); },
    setRate: (r) => { try { player.playbackRate = r; } catch { /* not ready */ } },
  });
  const watchPartyRef = useRef(watchParty);
  watchPartyRef.current = watchParty;
  announceEpisodeRef.current = watchParty.announceEpisode;
  isHostRef.current = watchParty.isHost;

  // Create a room for the title being watched — just adds ?roomCode to the player
  // params (you keep watching; the room is keyed to this title). Stashes a password.
  const createParty = async (password: string | null) => {
    if (!params.streamTarget || creatingRoom) return;
    setCreatingRoom(true);
    try {
      const code = await createWatchPartyRoom({
        authToken: token,
        guestId: token ? null : guestId,
        type: params.streamTarget.type === 'series' ? 'series' : 'movie',
        imdbId: params.detailId ?? params.streamTarget.id,
        videoId: params.streamTarget.type === 'series' ? params.streamTarget.id : null,
        password,
      });
      if (password) stashWatchPartyPassword(code, password);
      navigation.setParams({ roomCode: code });
      toast.show('Watch party started', { description: `Room ${code.toUpperCase()} — share the code from the panel.` });
    } catch {
      toast.show('Could not start the party');
    } finally {
      setCreatingRoom(false);
    }
  };
  const leaveParty = () => {
    if (params.roomCode) clearWatchPartyPassword(params.roomCode);
    watchPartyRef.current.leave();
    navigation.setParams({ roomCode: undefined });
    closeDrawer();
  };
  // Join from the drawer's Join view: a room I'm not in yet (different title) →
  // resolve its stream + open the player in that room. Same title → just set the code.
  const joinRoom = (room: WatchPartyRoomInfo) => {
    closeDrawer();
    if (params.detailId === room.imdbId || params.streamTarget?.id === room.videoId) {
      navigation.setParams({ roomCode: room.code });
      return;
    }
    const videoId = room.videoId ?? room.imdbId;
    loadStreams(token, room.type, videoId)
      .then((streams) => {
        const playable = streams.filter((s) => s.url).map((s) => ({ url: s.url as string, title: s.title }));
        if (playable.length === 0) { toast.show('No streams for that room\'s title'); return; }
        navigation.replace('Player', {
          url: playable[0].url, title: room.imdbId, playlist: playable, startIndex: 0, startSeconds: 0,
          streamTarget: { type: room.type, id: videoId, title: room.imdbId }, detailId: room.imdbId, roomCode: room.code,
        });
      })
      .catch(() => toast.show('Could not join that room'));
  };
  const inviteLink = `${getStorageBaseUrl().replace(/\/storage\/?$/, '')}/invite/${params.roomCode ?? ''}`;

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
      // Binge auto-advance — the desktop's EndFile(eof)+bingeWatching path: when
      // the episode plays to (within half a second of) its end and Auto play is
      // on, jump to the next aired episode. endFiredRef makes it one-shot per file.
      if (
        revealedRef.current &&
        !endFiredRef.current &&
        durationRef.current > DMCA_MAX_SECONDS &&
        timeRef.current >= durationRef.current - 0.5
      ) {
        endFiredRef.current = true;
        const next = nextEpRef.current;
        if (autoPlayRef.current && next && !isUnaired(next)) switchToEpisodeRef.current(next);
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

  // Auto-load the preferred-language subtitle for the file we actually land on —
  // prefer an EXTERNAL sub (we render it styled), falling back to embedded. Gated
  // on `revealed`: the player auto-advances PAST debrid-DMCA/errored releases, each
  // of which resets autoSubRef on the url change; since extTracks is content-keyed
  // (loaded once, always present), without this gate every skipped release re-fired
  // its own "Subtitles loaded" toast. Only the revealed (real) file applies + toasts.
  useEffect(() => {
    if (autoSubRef.current || !revealed) return;
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
  }, [extTracks, subTracks, revealed]);

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
    // Tell the watch party (echo-suppressed inside the hook so a remote-applied
    // play/pause doesn't bounce back).
    if (wantPlay) watchPartyRef.current.broadcastPlay();
    else watchPartyRef.current.broadcastPause();
    bumpControls();
  };
  const seek = (delta: number) => {
    player.seekBy(delta);
    watchPartyRef.current.broadcastSeek((player.currentTime ?? time) + delta);
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

  const runBottom = (id: BottomId) => {
    if (id === 'play') { togglePlay(); return false; }
    if (id === 'next') {
      // Dimmed when there's no next episode yet (last ep / meta still loading);
      // unaired next shows the air-date toast inside switchToEpisode.
      if (nextEp) switchToEpisode(nextEp);
      return true; // keep focus on the button (the veil/replace takes over)
    }
    if (id === 'episodes') { openDrawer('episodes'); return true; }
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
      // Open the Detail page on the episode that was playing. Take the season +
      // episode from the PLAYED VIDEO's own fields (looked up in the loaded show
      // meta) — this is correct for every addon, including Anime Kitsu whose ids
      // (`kitsu:showId:ep`) don't encode a season. We must NOT parse parts[-2] of a
      // Kitsu id as a season: the numeric middle part is the show id (e.g. 48363),
      // which matches no video and blanks Detail's episode list. Fall back to the
      // IMDb `tt…:S:E` shape only when the meta list hasn't loaded yet.
      let season: number | undefined;
      let episode: number | undefined;
      const cur = currentEpRef.current;
      if (st.type === 'series' && cur && cur.season != null && cur.episode != null) {
        season = cur.season;
        episode = cur.episode;
      } else if (st.type === 'series') {
        const parts = st.id.split(':');
        const sNum = Number(parts[parts.length - 2]);
        const eNum = Number(parts[parts.length - 1]);
        if (/^tt\d+$/.test(parts[0]) && parts.length >= 3 && Number.isFinite(sNum) && Number.isFinite(eNum)) {
          season = sNum;
          episode = eNum;
        }
      }
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
    else if (id === 'watchparty') { if (!params.roomCode) setWpTab('open'); openDrawer('watchparty'); }
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
        if (now - drawerClosedAtRef.current < 450) break; // ignore the OK that just closed a drawer
        if (now - lastOk.current < 300) break;
        lastOk.current = now;
        if (r === 'bottom') { const stay = runBottom(bottom[i]); if (!stay) goRow('none'); }
        else if (r === 'top') { runTop(TOP[i]); goRow('none'); }
        else {
          const wasPlaying = !userPausedRef.current;
          togglePlay();
          if (wasPlaying) goRow('bottom', 0);
        }
        break;
      }
      case 'playPause':
        if (now - drawerClosedAtRef.current < 450) break; // ignore the OK that just closed a drawer
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
        if (r === 'bottom') goRow('bottom', Math.min(bottom.length - 1, i + 1));
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
  const bf = (id: BottomId) => row === 'bottom' && bottom[idx] === id;
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
        // Series: show the CURRENT EPISODE (Season·Episode + title + episode summary);
        // movie: the show's release/rating + summary. Episode summary falls back to
        // the show summary until the episode list loads.
        description={(currentEp?.description ?? params.description) ?? null}
        releaseInfo={params.releaseInfo}
        imdbId={currentEp ? null : params.imdbId}
        rating={currentEp ? (episodeRating != null ? episodeRating.toFixed(1) : null) : params.rating}
        duration={duration}
        episodeLabel={currentEp && currentEp.season != null && currentEp.episode != null ? `Season ${currentEp.season} · Episode ${currentEp.episode}` : null}
        episodeTitle={currentEp?.title ?? null}
      />

      {/* TOP OVERLAY — full chrome (Back + badges + watch-party), shown over the
          buffering logo too so Back stays reachable while the torrent loads. */}
      {controlsVisible && !drawerOpen ? (
        <LinearGradient colors={['rgba(0,0,0,0.8)', 'rgba(0,0,0,0.5)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, paddingHorizontal: m.s(24), paddingTop: m.s(24), paddingBottom: m.s(16) }} pointerEvents="none">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m.s(12) }}>
            <BackPill m={m} title={params.title} focused={tf('back')} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(12) }}>
              <SourceBadges m={m} badges={badges} />
              <WatchPartyButton m={m} focused={tf('watchparty')} roomCode={params.roomCode} connected={watchParty.connected} participants={watchParty.participants} />
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
              <View style={{ position: 'absolute', left: 0, height: m.s(4), borderRadius: 999, width: `${pct * 100}%`, backgroundColor: colors.accent }} />
              <View style={{ position: 'absolute', left: `${pct * 100}%`, width: m.s(12), height: m.s(12), borderRadius: 999, marginLeft: -m.s(6), backgroundColor: '#fff' }} />
            </View>
            <Text style={[timeStyle(m), { textAlign: 'right' }]}>{revealed ? fmt(duration) : '--:--'}</Text>
          </LinearGradient>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: m.s(18), paddingVertical: m.s(10) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
              <PlayerIconBtn m={m} focused={bf('play')}>{(c) => <PlayIcon m={m} paused={!playing} color={c} />}</PlayerIconBtn>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(4) }}>
              {isSeries ? (
                <>
                  {/* Next episode — dimmed when none/unaired (desktop disabled look). */}
                  <PlayerIconBtn m={m} focused={bf('next')} dimmed={!nextEp || nextUnaired}>{(c) => <NextEpisodeIcon m={m} color={c} />}</PlayerIconBtn>
                  {/* Episodes drawer — icon + label pill (desktop parity). */}
                  <PlayerLabelBtn m={m} focused={bf('episodes')} label="Episodes">{(c) => <EpisodesIcon m={m} color={c} />}</PlayerLabelBtn>
                </>
              ) : null}
              <PlayerIconBtn m={m} focused={bf('subtitles')}>{(c) => <SubsIcon m={m} color={c} />}</PlayerIconBtn>
              <PlayerIconBtn m={m} focused={bf('audio')}>{(c) => <AudioIcon m={m} color={c} />}</PlayerIconBtn>
              <PlayerIconBtn m={m} focused={bf('releases')}>{(c) => <ReleasesIcon m={m} color={c} />}</PlayerIconBtn>
            </View>
          </View>
        </View>
      ) : null}

      {/* Episodes drawer (series) — the in-player episode selector, ported from
          the desktop EpisodesDrawer. Self-contained native focus; Back/X/Left
          close. Selection routes through switchToEpisode. */}
      {drawer === 'episodes' ? (
        <EpisodesDrawer
          episodes={seriesVideos}
          currentId={params.streamTarget?.id ?? null}
          imdbId={params.imdbId ?? (params.detailId && /^tt\d{5,}$/.test(params.detailId) ? params.detailId : null)}
          fallbackArt={params.background ?? params.poster ?? null}
          currentProgressPct={revealed && duration > 0 ? (time / duration) * 100 : 0}
          autoPlay={autoPlay}
          onToggleAutoPlay={toggleAutoPlay}
          onSelectEpisode={switchToEpisode}
          onClose={closeDrawer}
        />
      ) : null}

      {/* Watch Party drawer — Open / Join / Active room (people + chat). Self-
          contained native focus + FocusTrap; Back/X close. */}
      {drawer === 'watchparty' ? (
        <WatchPartyDrawer
          onClose={closeDrawer}
          tab={wpTab}
          onTabChange={setWpTab}
          roomCode={params.roomCode ?? null}
          connected={watchParty.connected}
          selfUserId={watchParty.selfUserId}
          hostUserId={watchParty.hostUserId}
          participants={watchParty.participants}
          chat={watchParty.chat}
          reactions={watchParty.reactions}
          typingNames={watchParty.typingNames}
          hasPassword={roomInfo?.hasPassword ?? false}
          error={watchParty.error}
          inviteLink={inviteLink}
          sendChat={watchParty.sendChat}
          sendTyping={watchParty.sendTyping}
          toggleReaction={watchParty.toggleReaction}
          onLeave={leaveParty}
          canCreate={!!params.streamTarget}
          creatingRoom={creatingRoom}
          onCreateRoom={createParty}
          onNavigateToRoom={joinRoom}
        />
      ) : null}

      {/* Settings drawer (Releases / Audio / Subtitles) — slides in from the
          right, native D-pad focus (X / Back / Left closes). Mounted only while
          open so the focus trap reliably claims focus on entry. */}
      {drawer === 'audio' || drawer === 'subtitles' || drawer === 'releases' ? (
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

      {/* Watch-party activity pills (join/leave/play/pause/seek by others). */}
      {watchParty.connected ? <WatchPartyToast activity={watchParty.activity} selfUserId={watchParty.selfUserId} /> : null}

      {/* Episode-switch veil — black + the title's logo while the next episode's
          streams resolve; merges into the replacing player's own buffering veil
          (the CW-resume hand-off pattern). */}
      {switching ? <BufferingVeil visible black logo={params.logo} /> : null}
    </View>
  );
}

function timeStyle(m: ReturnType<typeof useMetrics>) {
  return { minWidth: m.s(56), fontFamily: font.body, fontSize: m.s(16), color: '#fff' } as const;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
