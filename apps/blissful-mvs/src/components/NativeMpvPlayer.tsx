// Phase 4 iteration 1 — libmpv-backed player rendered as a sibling of
// SimplePlayer. PlayerPage picks NativeMpvPlayer when isNativeShell()
// returns true, SimplePlayer otherwise.
//
// What this gets us over SimplePlayer:
//   - libmpv plays every codec the build supports (HEVC HDR, E-AC-3, TrueHD,
//     FLAC, DV P5/P7, etc.) without Chrome's <video>-element limits.
//   - No HLS transcoding — we feed mpv the direct stremio-service torrent
//     URL `/{infoHash}/{fileIdx}?tr=...`, same shape Stremio Desktop uses.
//   - Hardware decode via d3d11va (already wired in libmpv config).
//
// What this DOESN'T have yet (iteration 2):
//   - Audio/subtitle track switching menus
//   - Subtitle styling controls + addon-fetched subs
//   - Settings dropdown / up-next overlay
//   - Volume slider (mpv default volume stands)
//   - Stream-history "you last played" overlay
// All of those exist in SimplePlayer — porting them is per-feature work
// against this player's state, not a fundamental architecture lift.
//
// Rendering: the libmpv-rendered video is BEHIND the WebView2 (compositing
// proven in Phase 0). This component renders only the controls overlay,
// styled identically to SimplePlayer's translucent strips so users get the
// same look. The middle of the screen is transparent so mpv shows through.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { playbackClock, TIME_POS_STATE_THROTTLE_MS } from './NativeMpvPlayer/playbackClock';
import { BottomControls } from './NativeMpvPlayer/BottomControls';
import { TopOverlay } from './NativeMpvPlayer/TopOverlay';
import { PauseOverlay, type PauseOverlayVideo } from './NativeMpvPlayer/PauseOverlay';
import {
  WatchPartyActivityToast,
  WatchPartyButton,
  WatchPartyDrawer,
  WatchPartyNamePrompt,
  WatchPartyPasswordPrompt,
} from './WatchParty';
import type { WatchPartyDrawerTab } from './WatchParty/WatchPartyDrawer';
import { BufferingOverlay } from './NativeMpvPlayer/BufferingOverlay';
import { usePlayerReady } from '../context/PlayerReadyProvider';
import { triggerStremioItemSync } from '../lib/stremioLinkApi';
import { UpNextOverlay } from './NativeMpvPlayer/UpNextOverlay';
import { SettingsPanel, type SettingsTab } from './NativeMpvPlayer/SettingsPanel';
import { SkipChapterButton } from './NativeMpvPlayer/SkipChapterButton';
import { useChapterSkip } from './NativeMpvPlayer/useChapterSkip';
import { useSkipSegments } from './NativeMpvPlayer/useSkipSegments';
import { subtitleLangLabel } from './NativeMpvPlayer/subtitleHelpers';
import { EpisodesDrawer, type EpisodeVideo, type DrawerSeasonInfo } from './NativeMpvPlayer/EpisodesDrawer';
import { useNavigate } from 'react-router-dom';
import { ChromePicker, type ColorResult } from 'react-color';
import { desktop, type MpvTrack } from '../lib/desktop';
import type { StremioIconName } from './PlayerControlIcons';
import type { AddonDescriptor } from '../lib/stremioApi';
import { setProgress } from '../lib/progressStore';
import { updateBlissfulLibraryProgress } from '../lib/blissfulAuthApi';
import { fetchSubtitles, fetchOpenSubHash } from '../lib/stremioAddon';
import { getLastStreamSelection, setLastStreamSelection } from '../lib/streamHistory';
import { notifyError, notifyInfo, notifySuccess } from '../lib/toastQueues';
import {
  writeStoredPlayerSettings,
  type PlayerSettings,
} from '../lib/playerSettings';
import { useWatchPartyMpv } from '../lib/useWatchPartyMpv';
import {
  buildRoomPlayerUrl,
  createWatchPartyRoom,
  getOrCreateGuestUserId,
  getStoredGuestName,
  getWatchPartyPassword,
  getWatchPartyRoom,
  setStoredGuestName,
  stashWatchPartyPassword,
  clearWatchPartyPassword,
  type WatchPartyRoomInfo,
} from '../lib/watchParty';
import { useStorage } from '../context/StorageProvider';
import type { NextEpisodeInfo } from '../pages/PlayerPage';

// ── Color helpers (mirrors SimplePlayer 1:1) ───────────────────────────
function parseColor(value: string): { hex: string; alpha: number } {
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hexMatch) return { hex: `#${hexMatch[1]}`, alpha: 1 };
  const m =
    /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/i.exec(value.trim()) ||
    /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(value.trim());
  if (m) {
    const r = Math.min(255, Math.max(0, Number(m[1])));
    const g = Math.min(255, Math.max(0, Number(m[2])));
    const b = Math.min(255, Math.max(0, Number(m[3])));
    const alpha = m[4] ? Math.min(1, Math.max(0, Number(m[4]))) : 1;
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    return { hex, alpha };
  }
  return { hex: '#ffffff', alpha: 1 };
}

function buildRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return hex;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return { r: 255, g: 255, b: 255 };
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

// ── SRT/VTT parser + cue lookup ────────────────────────────────────────
// Stremio (stremio-video/withHTMLSubtitles) renders addon subs as an
// HTML overlay over the video, NOT via mpv's `sub-add`. mpv only
// handles embedded sid. Reason: sub-add has subtle timing/sid race
// issues against ASS rendering. Doing it in HTML side-steps all of
// that and lets us style subs trivially via CSS. This parser is the
// HTML-side cousin of mpv's libass.
type SubCue = { start: number; end: number; text: string };

function parseSrtOrVtt(input: string): SubCue[] {
  const cues: SubCue[] = [];
  // Normalize CRLF → LF, strip WEBVTT header line, strip BOM.
  const text = input
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '');
  // Each cue is separated by a blank line.
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    let tsLine: string | undefined;
    let bodyStart = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        tsLine = lines[i];
        bodyStart = i + 1;
        break;
      }
    }
    if (!tsLine) continue;
    const m =
      /(\d+):(\d+):(\d+)[,.](\d{1,3})\s*-->\s*(\d+):(\d+):(\d+)[,.](\d{1,3})/.exec(tsLine);
    if (!m) continue;
    const toSec = (h: string, mm: string, s: string, ms: string) =>
      Number(h) * 3600 + Number(mm) * 60 + Number(s) + Number(ms) / 1000;
    const start = toSec(m[1], m[2], m[3], m[4]);
    const end = toSec(m[5], m[6], m[7], m[8]);
    const body = lines
      .slice(bodyStart)
      .join('\n')
      .replace(/<\/?(?:b|i|u|font|c|ruby|rt|v)[^>]*>/gi, '') // strip basic SSA/HTML tags
      .replace(/\{\\[^}]+\}/g, '') // strip ASS inline overrides
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}

function findCueAt(cues: SubCue[], time: number): SubCue | null {
  // Linear is fine for typical subtitle counts (~1500 lines/film). Sorted
  // by start time. Find latest cue whose start <= time and end > time.
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.start <= time && time < c.end) return c;
    if (c.start > time) return null;
  }
  return null;
}

// ── Subtitle helpers (mirrors SimplePlayer) ────────────────────────────
type AddonSubtitleTrack = {
  key: string;
  lang: string;
  label: string;
  origin: string;
  url: string;
  /** OpenSubtitles "good" rating (number of downloads/ratings).
   *  Used by auto-pick to prefer the highest-rated variant when
   *  multiple subs exist for the same language — matches Stremio's
   *  selection behavior. Missing → treated as 0. */
  rating: number;
};

const LANGUAGE_ALIASES: Record<string, string[]> = {
  en: ['en', 'eng'], eng: ['en', 'eng'],
  es: ['es', 'spa'], spa: ['es', 'spa'],
  fr: ['fr', 'fre', 'fra'], fre: ['fr', 'fre', 'fra'], fra: ['fr', 'fre', 'fra'],
  de: ['de', 'ger', 'deu'], ger: ['de', 'ger', 'deu'], deu: ['de', 'ger', 'deu'],
  it: ['it', 'ita'], ita: ['it', 'ita'],
  pt: ['pt', 'por', 'pob', 'ptbr'], por: ['pt', 'por', 'pob', 'ptbr'],
  ru: ['ru', 'rus'], rus: ['ru', 'rus'],
  ja: ['ja', 'jpn'], jpn: ['ja', 'jpn'],
  ko: ['ko', 'kor'], kor: ['ko', 'kor'],
  zh: ['zh', 'zho', 'chi'], zho: ['zh', 'zho', 'chi'], chi: ['zh', 'zho', 'chi'],
  pl: ['pl', 'pol'], pol: ['pl', 'pol'],
  nl: ['nl', 'nld', 'dut'], nld: ['nl', 'nld', 'dut'], dut: ['nl', 'nld', 'dut'],
  ar: ['ar', 'ara'], ara: ['ar', 'ara'],
  tr: ['tr', 'tur'], tur: ['tr', 'tur'],
  uk: ['uk', 'ukr'], ukr: ['uk', 'ukr'],
};

// Re-export under the original name so the rest of NativeMpvPlayer
// can keep using `subtitleLangLabel(...)` unchanged. New file is
// `./NativeMpvPlayer/subtitleHelpers.ts` — see that file for the
// table + the labelling rules.

function languageMatch(target: string | null, candidate: string | null): boolean {
  if (!target || !candidate) return false;
  const t = target.trim().toLowerCase();
  const c = candidate.trim().toLowerCase();
  if (!t || !c) return false;
  if (t === c) return true;
  const aliases = LANGUAGE_ALIASES[t] ?? [t];
  return aliases.includes(c);
}

function scoreSubtitleTrack(t: AddonSubtitleTrack): number {
  const origin = t.origin.toLowerCase();
  let s = 0;
  if (origin.includes('opensubtitles')) s += 50;
  if (origin.includes('subtitles')) s += 20;
  if (t.url.endsWith('.vtt')) s += 10;
  if (t.url.endsWith('.srt')) s += 5;
  return s;
}

interface NativeMpvPlayerProps {
  url: string;
  title?: string;
  metaTitle?: string;
  poster?: string;
  /** Wide 16:9 backdrop image (Stremio's `meta.background`). When
   *  available, the buffering veil uses this instead of `poster` so the
   *  initial loading screen isn't a stretched-vertical movie poster. */
  background?: string;
  logo?: string;
  startTimeSeconds?: number;
  type: 'movie' | 'series';
  id: string;
  videoId: string | null;
  addons: AddonDescriptor[];
  authKey: string | null;
  playerSettings: PlayerSettings;
  savePlayerSettings: (settings: PlayerSettings) => Promise<void>;
  nextEpisodeInfo: NextEpisodeInfo | null;
  /** Show-level description for the PauseOverlay. */
  description?: string;
  /** Show-level IMDb rating for the PauseOverlay. */
  imdbRating?: string;
  /** Release info string (e.g. "2022" or "2022-03-04") for the PauseOverlay. */
  releaseInfo?: string;
  /** Episode video list for the PauseOverlay per-episode metadata. */
  videos?: Array<{
    id: string;
    title?: string;
    season?: number;
    episode?: number;
    thumbnail?: string;
    released?: string;
    overview?: string;
    description?: string;
    rating?: string | number;
  }>;
  /** Watch-party room code (from `?room=...` on the URL). When
   *  present, the player connects to the room over WS and stays in
   *  lock-step with the host's timeline. */
  roomCode?: string | null;
}

const STREAMING_SERVER_URL = 'http://127.0.0.1:11470';

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.openbittorrent.com:80/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
];

function parseMagnetInfo(value: string) {
  if (!value.startsWith('magnet:?')) return null;
  const idx = value.indexOf('?');
  if (idx === -1) return null;
  const params = new URLSearchParams(value.slice(idx + 1));
  const xt = params.get('xt') ?? '';
  const infoHash = xt.startsWith('urn:btih:') ? xt.slice('urn:btih:'.length) : '';
  if (!infoHash) return null;
  const trackers = params.getAll('tr').filter((t) => t.length > 0);
  const rawFileIdx = params.get('fileIdx') ?? params.get('fileIndex');
  const parsedFileIdx = rawFileIdx === null ? null : Number.parseInt(rawFileIdx, 10);
  const fileIdx =
    parsedFileIdx !== null && Number.isInteger(parsedFileIdx) && parsedFileIdx >= 0
      ? parsedFileIdx
      : null;
  return { infoHash, trackers, fileIdx };
}

/**
 * Pre-formed stremio-service URLs look like
 * `http://127.0.0.1:11470/{40-hex-infohash}/{fileIdx}?tr=...&tr=...`.
 * Stremio Web calls `/{infoHash}/create` with aggressive peerSearch
 * BEFORE issuing the GET, so by the time mpv reads the URL the swarm is
 * already warm. When addons hand us this URL form directly (skipping the
 * magnet step) we have to do the same kick-start ourselves — otherwise
 * cold 4K torrents take 15-20s to first frame because mpv's GET races
 * the streaming server's DHT/tracker discovery from zero.
 */
function parseStreamingServerInfo(value: string) {
  const m = value.match(
    /^https?:\/\/[^/]+\/([0-9a-fA-F]{40})\/(-?\d+)(?:\?(.*))?$/,
  );
  if (!m) return null;
  const infoHash = m[1].toLowerCase();
  const fileIdx = Number.parseInt(m[2], 10);
  const trackers = m[3]
    ? new URLSearchParams(m[3]).getAll('tr').filter((t) => t.length > 0)
    : [];
  return {
    infoHash,
    trackers,
    fileIdx: Number.isInteger(fileIdx) && fileIdx >= 0 ? fileIdx : null,
  };
}

/**
 * Tell the streaming server to start fetching the torrent.
 *
 * STRICT per-session dedup. Repeated `/create` POSTs RESET the engine's
 * piece-fetch progress server-side — verified in the access log: every
 * extra POST is immediately followed by `bytes=0- → bytes=END- → bytes=6-`
 * (mpv restarting MKV probe from scratch). When the user is on a cold
 * torrent and the component remounts or HMR re-runs the effect, that
 * cycle keeps the playback from EVER reaching its first frame.
 *
 * The dedup Set is pinned to `window` so Vite HMR replacing this module
 * doesn't reset it and re-trigger /create.
 */
// Per-hash dedup with a short TTL (30 s) instead of forever. The earlier
// permanent dedup blocked re-POSTing /create on a hash whose engine had
// already been destroyed server-side (engines auto-destroy after ~10
// minutes of inactivity). Re-clicking such a torrent would skip the
// POST and let mpv's GET auto-recreate the engine with weak default
// opts (dht:false, tracker:false, peerSearch min:40/max:150) — that's
// the "stuck at bytes=0-" pattern visible in the access log.
// The 30 s TTL is short enough to catch any real re-click (engine
// would still be alive) and long enough to absorb HMR / quick remounts
// during the same playback session.
const DEDUP_TTL_MS = 30 * 1000;
function getCreatedMap(): Map<string, number> {
  const w = window as Window & { __blissCreatedAt?: Map<string, number> };
  if (!w.__blissCreatedAt) w.__blissCreatedAt = new Map<string, number>();
  return w.__blissCreatedAt;
}

async function createTorrentOnServer(
  infoHash: string,
  trackers: string[],
  serverUrl: string,
  signal: AbortSignal,
): Promise<void> {
  const key = infoHash.toLowerCase();
  const map = getCreatedMap();
  const now = Date.now();
  const last = map.get(key);
  if (last !== undefined && now - last < DEDUP_TTL_MS) return;
  map.set(key, now);
  const trackerList = trackers.length > 0 ? trackers : DEFAULT_TRACKERS;
  const sources = Array.from(
    new Set([`dht:${infoHash}`, ...trackerList.map((t) => `tracker:${t}`)]),
  );
  // stremio-runtime's /create handler:
  //   createEngine(infoHash, body, cb)
  //     options = util._extend(defaults, body)
  //     if (isNew && options.peerSearch) new PeerSearch(...)
  //     if (isNew && options.swarmCap) ...
  // — verified against the extracted server.js. So:
  //   1. opts must be at the TOP level of the body (NOT nested under
  //      `opts`) so the runtime picks them up as options.peerSearch
  //      etc. Earlier we wrapped everything in `opts: {...}` which the
  //      runtime stored at engine.options.opts.* — a dead slot,
  //      visible in /stats.json but never activated. Net effect:
  //      peerSearch ran with runtime defaults (min:40/max:150, no DHT,
  //      no tracker, 0 connectionTries) and the swarm never found
  //      peers.
  //   2. PeerSearch / swarmCap are wired ONLY when `isNew === true`.
  //      POSTing /create on an existing engine just re-stores opts
  //      without activating them. So we MUST destroy any existing
  //      engine first (`GET /{hash}/remove`) to force isNew=true.
  const body = JSON.stringify({
    torrent: { infoHash },
    peerSearch: { sources, min: 200, max: 800 },
    dht: true,
    tracker: true,
    connections: 200,
    swarmCap: { minPeers: 50, maxSpeed: 209715200 },
    guessFileIdx: {},
  });
  try {
    // Destroy any existing engine so the next /create wires fresh
    // PeerSearch/swarmCap with our aggressive opts. Safe if no engine
    // exists — the handler is a 200 no-op in that case.
    await fetch(`${serverUrl}/${infoHash}/remove`, {
      method: 'GET',
      signal,
    }).catch(() => {});
    if (signal.aborted) return;
    await fetch(`${serverUrl}/${infoHash}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    });
  } catch {
    map.delete(key);
  }
}

function buildTorrentStreamUrl(
  infoHash: string,
  trackers: string[],
  serverUrl: string,
  fileIdx: number | null,
): string {
  const trackerList = trackers.length > 0 ? trackers : DEFAULT_TRACKERS;
  const params = new URLSearchParams();
  for (const t of trackerList) params.append('tr', t);
  const query = params.toString();
  const selectedFile = fileIdx !== null ? fileIdx : -1;
  return `${serverUrl}/${infoHash}/${selectedFile}${query ? `?${query}` : ''}`;
}

// `formatTime` lives in ./NativeMpvPlayer/ScrubBar.tsx — the only
// caller after the player decomposition. Re-import here if anything
// in this file ever needs to render a hh:mm:ss again.

export default function NativeMpvPlayer(props: NativeMpvPlayerProps) {
  const navigate = useNavigate();
  // PlayerReady — mount/unmount ONLY. No prop deps so it never
  // re-fires mid-lifecycle (which would flash the buffering screen).
  const { setReady: setPlayerReady } = usePlayerReady();
  useEffect(() => {
    setPlayerReady(true);
    return () => setPlayerReady(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stremio sync — on mount + unmount. Uses refs for the final
  // progress write so the cleanup captures the latest values without
  // needing prop deps that would re-fire the effect.
  const propsRef = useRef(props);
  propsRef.current = props;
  useEffect(() => {
    triggerStremioItemSync(propsRef.current.authKey ?? null, propsRef.current.id ?? null);
    return () => {
      const p = propsRef.current;
      const t = timePosRef.current;
      const d = durationRef.current;
      if (p.authKey && t > 0 && d > 0) {
        void updateBlissfulLibraryProgress(p.authKey, {
          id: p.id,
          type: p.type,
          videoId: p.videoId ?? null,
          timeSeconds: t,
          durationSeconds: d,
          name: p.metaTitle ?? p.title ?? null,
          poster: p.poster ?? null,
          streamUrl: p.url ?? null,
          streamTitle: p.title ?? null,
        }).then(() => {
          triggerStremioItemSync(p.authKey ?? null, p.id ?? null);
        }).catch(() => {
          triggerStremioItemSync(p.authKey ?? null, p.id ?? null);
        });
      } else {
        triggerStremioItemSync(p.authKey ?? null, p.id ?? null);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [timePos, setTimePos] = useState(0);
  // Last wall-clock time we wrote `timePos` through React state. Used
  // by the time-pos handler to skip setState calls that would land
  // inside the throttle window — the live value still flows to the
  // module-level `playbackClock` store every tick.
  const lastTimePosStateWriteRef = useRef(0);
  // Subtitle render clock — Stremio's pattern (from stremio-video's
  // withHTMLSubtitles). On every mpv `time-pos` tick we snapshot the
  // current value and the wall-clock instant. The rAF render loop
  // then computes `videoTime + (now - lastSyncAt)`, smoothly
  // extrapolating BETWEEN mpv events so cues don't lag the audio
  // even when libmpv reports time-pos at coarse intervals.
  const subClockRef = useRef<{ videoTime: number; lastSyncAt: number }>({
    videoTime: 0,
    lastSyncAt: Date.now(),
  });
  // Latch: once `playback-time` has fired at least once we ignore
  // `time-pos` for the subtitle clock. This prevents the two events,
  // which fire in arbitrary order on every tick, from racing each
  // other and overwriting the correct clock with time-pos's raw
  // (possibly offset) value.
  const hasPlaybackTimeRef = useRef(false);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  // Ref that tracks the latest paused state — needed by the watch
  // party hook (which fires before the periodic-progress ref block)
  // and the subtitle rAF loop. Declared early so both consumers can
  // read it without temporal dead-zone issues.
  const wpPausedRef = useRef(false);
  wpPausedRef.current = paused;
  const [buffering, setBuffering] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [instantHideControls, setInstantHideControls] = useState(false);
  // mpv `video-params/gamma` (transfer characteristic). "pq"/"hlg" =
  // HDR. Used to render the HDR badge top-right of the player —
  // matches Stremio's HDRLabel behavior 1:1.
  const [videoGamma, setVideoGamma] = useState<string | null>(null);
  // Display dimensions of the active video (post aspect-ratio correction).
  // Drives the "4K" badge top-right when dwidth >= 3840.
  const [videoDwidth, setVideoDwidth] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Phase 4 iter 2 state.
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [audioId, setAudioId] = useState<number | string | null>(null);
  // Track the shell's fullscreen state so the maximize/minimize icon
  // matches. Driven by desktop.onFullscreenChanged (fired from the Rust
  // shell after the toggle), with an initial seed from desktop.isFullscreen.
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Track list fetched from mpv after FileLoaded. Audio + sub menus draw
  // from this.
  const [tracks, setTracks] = useState<MpvTrack[]>([]);
  // Legacy popover state -- kept as setters for the openSettings
  // callback to close them if somehow left open. The popovers
  // themselves are replaced by the unified SettingsPanel.
  const [, setAudioMenuOpen] = useState(false);
  const [, setSubMenuOpen] = useState(false);
  // Unified settings panel state.
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('subtitles');
  // Addon-fetched subtitles + 3-column picker modal (mirrors SimplePlayer).
  const [addonSubs, setAddonSubs] = useState<AddonSubtitleTrack[]>([]);
  const addonUrlsKey = useMemo(
    () => props.addons.map((a) => a.transportUrl).join('|'),
    [props.addons]
  );
  const addonsRef = useRef(props.addons);
  addonsRef.current = props.addons;
  const [selectedSubLang, setSelectedSubLang] = useState<string | null>(null);
  // `embedded:<id>` for in-torrent tracks, `addon:<key>` for fetched, `off` for none.
  const [selectedSubKey, setSelectedSubKey] = useState<string>('off');
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  // Maps addon-track key -> mpv sub-track id assigned by `sub-add`. We
  // remember these so re-selecting an addon track doesn't re-download.
  const addonSubIdRef = useRef<Map<string, number>>(new Map());
  // Up-next overlay state (mirrors SimplePlayer's pattern).
  const [showUpNext, setShowUpNext] = useState(false);
  const [upNextCountdown, setUpNextCountdown] = useState(10);
  const upNextCancelledRef = useRef(false);
  const upNextFiredRef = useRef(false);
  // Settings popover state. Holds local subtitle size override that's
  // applied to mpv immediately AND persisted via writeStoredPlayerSettings
  // so the next mount + the Settings page reflect the new choice.
  const [subtitleSizePx, setSubtitleSizePx] = useState(
    props.playerSettings.subtitlesSizePx,
  );
  // Vertical position OFFSET from mpv's default position.
  // 0 = stay at mpv default (the position the file dictates),
  // positive = lift subs higher up the screen,
  // negative = push them lower (mostly clamped at the bottom edge).
  // Mapped to mpv `sub-pos` (0=top..100=bottom) as
  //   sub-pos = clamp(0, 100, 100 - offset)
  // so offset=0 → 100 (mpv default), offset=+50 → 50 (mid-screen).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [subtitleVerticalPercent, _setSubtitleVerticalPercent] = useState(0);
  // Local color overrides, editable from the modal's color pickers.
  // Seeded from playerSettings; on change we also persist back.
  const [subtitleColor, setSubtitleColor] = useState(
    props.playerSettings.subtitlesTextColor,
  );
  const [subtitleBackgroundColor, setSubtitleBackgroundColor] = useState(
    props.playerSettings.subtitlesBackgroundColor,
  );
  const [subtitleOutlineColor, setSubtitleOutlineColor] = useState(
    props.playerSettings.subtitlesOutlineColor,
  );
  // ChromePicker popover state.
  const [colorModal, setColorModal] = useState<'text' | 'bg' | 'outline' | null>(null);
  const [colorPopoverPos, setColorPopoverPos] = useState<{ top: number; left: number } | null>(null);
  // Parsed cues for the currently-selected addon subtitle and the text
  // we're currently displaying. Following Stremio's architecture: addon
  // subs are HTML-rendered, not fed through `sub-add`. mpv handles only
  // embedded `sid`. `null` cues means no addon sub active.
  const [addonSubCues, setAddonSubCues] = useState<SubCue[] | null>(null);
  const [overlayCueText, setOverlayCueText] = useState('');
  // Scrub state: while the user is dragging the seek bar we hold the
  // local position and DO NOT fire mpv seek on every onChange. mpv gets
  // a single absolute seek on release. Without this, each pixel of drag
  // sends a fresh seek command which mpv aborts/retargets — the bar
  // feels sluggish on torrent streams (every seek triggers piece-fetch).
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const lastProgressSaveRef = useRef(0);
  const controlsHideTimerRef = useRef<number | null>(null);
  // Initial seek target for the current `loadfile` or user seek. mpv
  // reports `time-pos = target` instantly after issuing the seek, BEFORE
  // any bytes have demuxed — treating that as "playback is advancing"
  // prematurely clears the buffering veil and the user sees a black
  // screen with no indicator.
  const initialSeekRef = useRef<number | null>(null);
  // Latch: false until we observe a `paused-for-cache=true` OR
  // `seeking=true` from mpv. While false, any `=false` echo from
  // those properties is ignored so the load splash isn't dismissed
  // by mpv's idle-state initial values that fire when observation
  // is first registered. Reset on every URL change.
  const observedBufferingTrueRef = useRef(false);
  // True once the playback head has actually moved past the seek target.
  // Gates EVERY auto-clear path (paused-for-cache=false, FileLoaded,
  // etc.) so they can't dismiss the veil before real frames arrive.
  // Reset to false on every loadfile and user seek.
  const playbackStartedRef = useRef(false);
  // True once the user has seen at least one real frame of this video.
  // Unlike `playbackStartedRef` (which resets on every seek), this
  // sticks for the lifetime of the player instance. The buffering veil
  // uses it to decide whether to paint the poster backdrop: yes on the
  const [, setHasShownVideo] = useState(false);
  // ── Episodes drawer state (series only) ──────────────────────────
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const toggleEpisodes = useCallback(() => setEpisodesOpen((v) => !v), []);
  // Coverflow refs + state (owned here, passed through to the drawer).
  const currentEpisodeCardRef = useRef<HTMLButtonElement | null>(null);
  const episodesListRef = useRef<HTMLDivElement | null>(null);
  const [episodesFocusIndex, setEpisodesFocusIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!episodesOpen) return;
    // Drawer mounts with focusIndex=null; it falls back to the
    // currently-playing episode's index, and the translateY math
    // centers the stack. No scrollIntoView needed — transform-driven.
    setEpisodesFocusIndex(null);
  }, [episodesOpen]);
  // Custom carousel scroll: input is intercepted and converted to
  // signed step counts that bump the focus index.
  const episodesCountRef = useRef(0);
  // Index of the currently-playing episode within the displayed (season +
  // search filtered) list — set by EpisodesDrawer each render. The wheel/touch
  // handler falls back to THIS when focusIndex is still null (drawer just
  // opened), so the first scroll steps from the open episode, not from ep 1.
  const episodesCurrentIndexRef = useRef(0);
  const wheelAccumRef = useRef(0);
  const advanceFocusByRef = useRef<((steps: number) => void) | null>(null);
  advanceFocusByRef.current = (steps: number) => {
    if (steps === 0) return;
    setEpisodesFocusIndex((prev) => {
      const total = episodesCountRef.current;
      if (total <= 0) return prev;
      const current = prev ?? episodesCurrentIndexRef.current;
      const next = Math.max(0, Math.min(total - 1, current + steps));
      if (next === current) return current;
      return next;
    });
  };
  useEffect(() => {
    if (!episodesOpen) return;
    const container = episodesListRef.current;
    if (!container) return;
    const WHEEL_THRESHOLD = 80;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (
        wheelAccumRef.current !== 0 &&
        Math.sign(e.deltaY) !== Math.sign(wheelAccumRef.current)
      ) {
        wheelAccumRef.current = 0;
      }
      wheelAccumRef.current += e.deltaY;
      if (Math.abs(wheelAccumRef.current) >= WHEEL_THRESHOLD) {
        const dir = wheelAccumRef.current > 0 ? 1 : -1;
        wheelAccumRef.current = 0;
        advanceFocusByRef.current?.(dir);
      }
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    let touchLastY = 0;
    let touchAccum = 0;
    const SWIPE_THRESHOLD = 50;
    const onTouchStart = (e: TouchEvent) => {
      touchLastY = e.touches[0]?.clientY ?? 0;
      touchAccum = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      const dy = touchLastY - y;
      touchLastY = y;
      e.preventDefault();
      if (touchAccum !== 0 && Math.sign(dy) !== Math.sign(touchAccum)) {
        touchAccum = 0;
      }
      touchAccum += dy;
      if (Math.abs(touchAccum) >= SWIPE_THRESHOLD) {
        const dir = touchAccum > 0 ? 1 : -1;
        touchAccum = 0;
        advanceFocusByRef.current?.(dir);
      }
    };
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
    };
  }, [episodesOpen]);
  const episodesScrollRaf = useRef<number | null>(null);
  const episodesScrollLockUntilRef = useRef<number>(0);
  const lockEpisodesScroll = useCallback((durationMs: number = 500) => {
    episodesScrollLockUntilRef.current = Date.now() + durationMs;
  }, []);
  const handleEpisodesScroll = useCallback(() => {
    if (Date.now() < episodesScrollLockUntilRef.current) return;
    if (episodesScrollRaf.current != null) return;
    episodesScrollRaf.current = requestAnimationFrame(() => {
      episodesScrollRaf.current = null;
      const container = episodesListRef.current;
      if (!container) return;
      const cards = container.querySelectorAll<HTMLElement>('[data-episode-idx]');
      if (cards.length === 0) return;
      const rect = container.getBoundingClientRect();
      const containerCenter = rect.top + rect.height / 2;
      let bestIdx = -1;
      let bestDist = Number.POSITIVE_INFINITY;
      cards.forEach((c) => {
        const r = c.getBoundingClientRect();
        const cardCenter = r.top + r.height / 2;
        const dist = Math.abs(cardCenter - containerCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = Number(c.dataset.episodeIdx);
        }
      });
      if (bestIdx >= 0) setEpisodesFocusIndex(bestIdx);
    });
  }, []);
  const [episodesSearch, setEpisodesSearch] = useState('');
  const [episodesSeason, setEpisodesSeason] = useState<number | null>(null);
  // Auto-next is the same boolean as the account-stored
  // `bingeWatching` PlayerSettings field. The Episodes drawer toggle
  // is a quick way to flip the account setting without going to the
  // Settings page; both surfaces stay in sync because they read /
  // write the same field via writeStoredPlayerSettings.
  const [autoNext, setAutoNextLocal] = useState(props.playerSettings.bingeWatching);
  useEffect(() => { setAutoNextLocal(props.playerSettings.bingeWatching); }, [props.playerSettings.bingeWatching]);
  const setAutoNext = useCallback(
    (value: boolean) => {
      setAutoNextLocal(value);
      const next = { ...props.playerSettings, bingeWatching: value };
      void props.savePlayerSettings(next);
    },
    [props.playerSettings, props.savePlayerSettings],
  );
  // Available seasons + current ep season (for default seasonSelect).
  const seriesSeasons = useMemo(() => {
    if (!props.videos) return [] as number[];
    const set = new Set<number>();
    for (const v of props.videos) if (v.season != null) set.add(v.season);
    return Array.from(set).sort((a, b) => a - b);
  }, [props.videos]);
  const currentEpisodeSeason = useMemo(() => {
    if (!props.videoId) return null;
    const parts = props.videoId.split(':');
    const s = parts.length >= 3 ? Number.parseInt(parts[parts.length - 2], 10) : NaN;
    return Number.isFinite(s) ? s : null;
  }, [props.videoId]);
  // Initialize seasonSelect to current episode's season when the
  // drawer first opens, falling back to the smallest season.
  useEffect(() => {
    if (!episodesOpen) return;
    if (episodesSeason != null) return;
    setEpisodesSeason(currentEpisodeSeason ?? seriesSeasons[0] ?? null);
  }, [episodesOpen, episodesSeason, currentEpisodeSeason, seriesSeasons]);
  // Per-season info — overview + per-episode runtime / description.
  // Fetched from TMDB lazily when the episodes drawer is open.
  const [seasonInfoCache, setSeasonInfoCache] = useState<Record<number, DrawerSeasonInfo>>({});
  const currentSeasonInfo = episodesSeason != null ? seasonInfoCache[episodesSeason] : undefined;
  useEffect(() => {
    if (!episodesOpen || episodesSeason == null) return;
    if (seasonInfoCache[episodesSeason]) return;
    const imdbId = props.id?.startsWith('tt') ? props.id : null;
    if (!imdbId) return;
    let cancelled = false;
    import('../lib/tmdb').then(({ fetchTmdbId }) =>
      fetchTmdbId(imdbId).then((lookup) => {
        if (cancelled || !lookup?.tmdbId) return;
        const url = `https://api.themoviedb.org/3/tv/${lookup.tmdbId}/season/${episodesSeason}?api_key=6e355fdb72b74620e1ce2354a7a574cd`;
        fetch(url).then((r) => r.json()).then((data: Record<string, unknown>) => {
          if (cancelled) return;
          const episodes: DrawerSeasonInfo['episodes'] = {};
          const eps = Array.isArray(data.episodes) ? data.episodes : [];
          for (const ep of eps) {
            const epNum = (ep as Record<string, unknown>).episode_number;
            if (typeof epNum === 'number') {
              episodes[epNum] = {
                runtime: typeof (ep as Record<string, unknown>).runtime === 'number' ? (ep as Record<string, unknown>).runtime as number : null,
                overview: typeof (ep as Record<string, unknown>).overview === 'string' ? (ep as Record<string, unknown>).overview as string : null,
              };
            }
          }
          setSeasonInfoCache((prev) => ({
            ...prev,
            [episodesSeason!]: {
              overview: typeof data.overview === 'string' ? data.overview : null,
              episodes,
            },
          }));
        }).catch(() => {});
      })
    ).catch(() => {});
    return () => { cancelled = true; };
  }, [episodesOpen, episodesSeason, seasonInfoCache, props.id]);
  // ── Watch party ──────────────────────────────────────────────────
  //
  // Full integration of the watch-party system using the mpv-adapted
  // hook (useWatchPartyMpv) which uses desktop.play/pause/seek
  // instead of a <video> element.
  const storageCtx = useStorage();
  const profileDisplayName = storageCtx.userProfile?.displayName?.trim() || '';
  const [storedGuestName, setStoredGuestNameState] = useState<string | null>(() => getStoredGuestName());
  const watchPartyDisplayName =
    profileDisplayName && profileDisplayName !== 'Guest'
      ? profileDisplayName
      : storedGuestName;
  const [guestId] = useState<string>(() => getOrCreateGuestUserId());

  const [roomInfo, setRoomInfo] = useState<{ hasPassword: boolean } | null>(null);
  const [partyPassword, setPartyPassword] = useState<string | null>(() =>
    props.roomCode ? getWatchPartyPassword(props.roomCode) : null
  );
  useEffect(() => {
    setPartyPassword(props.roomCode ? getWatchPartyPassword(props.roomCode) : null);
  }, [props.roomCode]);

  // Fetch room info to know if password is required.
  useEffect(() => {
    if (!props.roomCode) {
      setRoomInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const info = await getWatchPartyRoom(props.roomCode!);
      if (cancelled) return;
      setRoomInfo(info ? { hasPassword: info.hasPassword } : null);
    })();
    return () => { cancelled = true; };
  }, [props.roomCode]);

  const handleHostEpisodeChange = useCallback(
    (videoId: string | null) => {
      if (!videoId) return;
      const params = new URLSearchParams(window.location.search);
      // Keep room code on the URL so the next episode stays in the party.
      params.set('videoId', videoId);
      params.delete('t');
      params.delete('autoplay');
      navigate(`/player?${params.toString()}`, { replace: true });
    },
    [navigate]
  );

  // Gate: only connect when room info loaded, password supplied if
  // needed, and display name chosen.
  const partyShouldConnect =
    !!props.roomCode
    && roomInfo != null
    && (!roomInfo.hasPassword || !!partyPassword)
    && !!watchPartyDisplayName;

  const watchParty = useWatchPartyMpv({
    roomCode: partyShouldConnect ? props.roomCode ?? null : null,
    authToken: props.authKey,
    guestId: props.authKey ? null : guestId,
    displayName: watchPartyDisplayName ?? '',
    password: partyPassword,
    onHostEpisodeChange: handleHostEpisodeChange,
    pausedRef: wpPausedRef,
  });

  // Clear stale password on error.
  useEffect(() => {
    if (watchParty.error === 'incorrect password' && props.roomCode) {
      clearWatchPartyPassword(props.roomCode);
      setPartyPassword(null);
    }
  }, [watchParty.error, props.roomCode]);

  // Host broadcasts episode changes.
  const lastAnnouncedVideoIdRef = useRef<string | null>(props.videoId);
  useEffect(() => {
    if (!watchParty.isHost) return;
    if (lastAnnouncedVideoIdRef.current === props.videoId) return;
    lastAnnouncedVideoIdRef.current = props.videoId;
    watchParty.announceEpisode(props.videoId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchParty.isHost, watchParty.announceEpisode, props.videoId]);

  const [creatingRoom, setCreatingRoom] = useState(false);
  const [watchPartyOpen, setWatchPartyOpen] = useState(false);
  const [watchPartyTab, setWatchPartyTab] = useState<WatchPartyDrawerTab>('open');
  const [watchPartyActiveTab, setWatchPartyActiveTab] = useState<'people' | 'chat'>('people');

  // Unread chat badge.
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const lastSeenChatLenRef = useRef(0);
  const didInitChatLenRef = useRef(false);
  useEffect(() => {
    if (!watchParty.connected) {
      didInitChatLenRef.current = false;
      lastSeenChatLenRef.current = 0;
      return;
    }
    const len = watchParty.chat.length;
    if (!didInitChatLenRef.current) {
      didInitChatLenRef.current = true;
      lastSeenChatLenRef.current = len;
      return;
    }
    const chatVisible = watchPartyOpen && watchPartyActiveTab === 'chat';
    if (chatVisible) {
      lastSeenChatLenRef.current = len;
      if (unreadChatCount !== 0) setUnreadChatCount(0);
      return;
    }
    if (len <= lastSeenChatLenRef.current) {
      lastSeenChatLenRef.current = len;
      return;
    }
    const fresh = watchParty.chat.slice(lastSeenChatLenRef.current);
    const fromOthers = fresh.filter((m) => m.from.userId !== watchParty.selfUserId).length;
    lastSeenChatLenRef.current = len;
    if (fromOthers > 0) setUnreadChatCount((prev) => prev + fromOthers);
  }, [watchParty.connected, watchParty.chat, watchParty.selfUserId, watchPartyOpen, watchPartyActiveTab, unreadChatCount]);

  const createParty = useCallback(
    async (password: string | null) => {
      if (!props.id || !props.type || creatingRoom) return;
      setCreatingRoom(true);
      try {
        const partyType = props.type === 'series' ? 'series' : 'movie';
        const code = await createWatchPartyRoom({
          authToken: props.authKey,
          guestId: props.authKey ? null : guestId,
          type: partyType,
          imdbId: props.id,
          videoId: props.videoId,
          password,
        });
        if (password) stashWatchPartyPassword(code, password);
        const params = new URLSearchParams(window.location.search);
        params.set('room', code);
        navigate(`/player?${params.toString()}`, { replace: true });
        notifySuccess(
          'Watch party started',
          `Room ${code.toUpperCase()}${password ? ' -- password set' : ''}. Copy the code or invite link from the panel on the right.`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        notifyError('Failed to start watch party', message);
        throw err;
      } finally {
        setCreatingRoom(false);
      }
    },
    [props.authKey, props.id, props.type, props.videoId, creatingRoom, guestId, navigate]
  );

  const handleLeaveParty = useCallback(() => {
    if (props.roomCode) clearWatchPartyPassword(props.roomCode);
    watchParty.leave();
    const params = new URLSearchParams(window.location.search);
    params.delete('room');
    navigate(`/player?${params.toString()}`, { replace: true });
    setWatchPartyOpen(false);
  }, [props.roomCode, watchParty, navigate]);

  const handleNavigateToRoom = useCallback(
    async (room: WatchPartyRoomInfo) => {
      const url = await buildRoomPlayerUrl(room);
      navigate(url);
      setWatchPartyOpen(false);
    },
    [navigate]
  );

  // Password prompt gate.
  const showPasswordPrompt =
    !!props.roomCode && roomInfo?.hasPassword === true && !partyPassword;
  const handlePasswordSubmit = useCallback(
    (password: string) => {
      if (!props.roomCode) return;
      stashWatchPartyPassword(props.roomCode, password);
      setPartyPassword(password);
    },
    [props.roomCode]
  );
  const handlePasswordCancel = useCallback(() => {
    if (props.roomCode) clearWatchPartyPassword(props.roomCode);
    const params = new URLSearchParams(window.location.search);
    params.delete('room');
    navigate(`/player?${params.toString()}`, { replace: true });
  }, [props.roomCode, navigate]);

  // Name prompt gate.
  const showNamePrompt = !!props.roomCode && !watchPartyDisplayName;
  const handleNameSubmit = useCallback((name: string) => {
    setStoredGuestName(name);
    setStoredGuestNameState(name);
  }, []);
  const handleNameCancel = useCallback(() => {
    if (props.roomCode) clearWatchPartyPassword(props.roomCode);
    const params = new URLSearchParams(window.location.search);
    params.delete('room');
    navigate(`/player?${params.toString()}`, { replace: true });
  }, [props.roomCode, navigate]);

  // Watch party button slot for TopOverlay.
  const watchPartySlot = (
    <WatchPartyButton
      onClick={() => {
        if (!props.roomCode) setWatchPartyTab('open');
        setWatchPartyOpen(true);
      }}
      roomCode={props.roomCode ?? null}
      connected={watchParty.connected}
      hasPassword={roomInfo?.hasPassword ?? false}
      participants={watchParty.participants}
      unreadCount={unreadChatCount}
      busy={creatingRoom}
    />
  );

  // Override the CSS variable that drives AppShell's outer background
  // (`var(--dynamic-bg)` on AppShell's root div) plus html/body/#root
  // backgrounds AND inject a style sheet that hides chrome (SideNav etc.)
  // while the player is mounted. Without this, AppShell's dark background
  // and SideNav cover libmpv's output and you see opaque dark instead of
  // the video.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const prev = {
      html: html.style.background,
      body: body.style.background,
      root: root?.style.background ?? '',
      dynamicBg: html.style.getPropertyValue('--dynamic-bg'),
    };
    html.style.background = 'transparent';
    body.style.background = 'transparent';
    if (root) root.style.background = 'transparent';
    html.style.setProperty('--dynamic-bg', 'transparent');

    // Hide app chrome (SideNav, TopNav, mobile nav, content padding wrap)
    // while NativeMpvPlayer is on screen. AppShell still renders them in
    // the DOM but they'd otherwise float over mpv's render area.
    const style = document.createElement('style');
    style.setAttribute('data-bliss-native-player', '');
    style.textContent = `
      /* Kill scrollbars while the player is mounted — otherwise the
         scrollbar gutter shows as a white vertical strip on the right
         while React is in the middle of mounting/loading. */
      html, body {
        overflow: hidden !important;
        height: 100vh !important;
      }
      .bliss-vertical-nav, header[class*='top-nav'], nav[class*='bliss'],
      .bliss-content, .netflix-root {
        background: transparent !important;
      }
      .bliss-vertical-nav, header[class*='top-nav'], nav[class*='bliss'] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      html.style.background = prev.html;
      body.style.background = prev.body;
      if (root) root.style.background = prev.root;
      if (prev.dynamicBg) {
        html.style.setProperty('--dynamic-bg', prev.dynamicBg);
      } else {
        html.style.removeProperty('--dynamic-bg');
      }
      style.remove();
    };
  }, []);

  // Resolve the stream URL + hand it to libmpv on mount.
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      try {
        // 1. Bring up the streaming server.
        await desktop.ensureStreamingServer();
        if (cancelled) return;

        // 2. Resolve the URL.
        //    - magnet → build the streaming-server torrent URL.
        //    - existing streaming-server URL → use as-is.
        //    - anything else → direct play.
        //
        //    /create MUST be awaited. stremio-runtime IGNORES opts in
        //    subsequent /create POSTs for an already-created engine, so
        //    if mpv's GET reaches the server first and auto-creates the
        //    engine with weak defaults (dht:false, tracker:false, only the
        //    URL's tr= params), we're stuck — no DHT, no peer search,
        //    often zero peers, infinite buffering. Awaiting adds ~100ms
        //    of preflight+POST latency on localhost; the strict dedup
        //    above ensures this only happens once per infoHash per session.
        let resolved: string;
        const magnet = parseMagnetInfo(props.url);
        const serverInfo = magnet ? null : parseStreamingServerInfo(props.url);
        if (magnet) {
          await createTorrentOnServer(
            magnet.infoHash,
            magnet.trackers,
            STREAMING_SERVER_URL,
            ac.signal,
          );
          if (cancelled) return;
          resolved = buildTorrentStreamUrl(
            magnet.infoHash,
            magnet.trackers,
            STREAMING_SERVER_URL,
            magnet.fileIdx,
          );
        } else if (serverInfo) {
          await createTorrentOnServer(
            serverInfo.infoHash,
            serverInfo.trackers,
            STREAMING_SERVER_URL,
            ac.signal,
          );
          if (cancelled) return;
          resolved = props.url;
        } else {
          resolved = props.url;
        }

        // 3. Pre-load probe for the Real-Debrid DMCA placeholder.
        //    Real-Debrid serves a ~30s "file removed" video when a
        //    cached release has been DMCA'd. We probe the URL through
        //    our shell's `/resolve-url` (Rust-side HEAD, no CORS issue
        //    that a direct fetch from the WebView would hit) and check
        //    Content-Length — a real movie/episode is >100 MB even
        //    at low quality, the placeholder is <20 MB.
        //
        //    Only probe HTTPS URLs (debrid CDN). Skip torrent streams
        //    (http://127.0.0.1:11470/...) because the streaming server's
        //    Content-Length doesn't reflect the actual stream size.
        if (/^https:\/\//i.test(resolved)) {
          try {
            const probe = await fetch(
              `/resolve-url?url=${encodeURIComponent(resolved)}`,
              { signal: ac.signal },
            );
            if (probe.ok) {
              const data = (await probe.json()) as {
                contentLength?: number;
                status?: number;
              };
              const len = data.contentLength ?? 0;
              if (len > 0 && len < 20 * 1024 * 1024) {
                autoFallbackToNextStream();
                return;
              }
            }
          } catch {
            // ignore — if probe fails, fall through and let mpv try.
            // The post-load duration check is the safety net.
          }
          if (cancelled) return;
        }

        // 4. Load + start playback. Use mpv's `loadfile <url> replace
        //    <index> <options>` form so the start position is baked into
        //    the loadfile itself — previously we issued a separate seek
        //    600ms after loadfile, but that race fails on slow-loading
        //    torrents (mpv hasn't demuxed yet, seek is dropped, playback
        //    starts at 0). With start=N in options mpv applies the seek
        //    as soon as it has enough demux data, regardless of how long
        //    the first piece takes to arrive.
        const startTarget =
          props.startTimeSeconds && props.startTimeSeconds > 0.5
            ? Math.floor(props.startTimeSeconds)
            : 0;
        // Capture the seek target so the property observer can tell the
        // initial loadfile time-pos report apart from real playback
        // advancement. Without this, mpv's immediate `time-pos=N` echo
        // (before any demux) clears the buffering veil prematurely.
        initialSeekRef.current = startTarget;
        playbackStartedRef.current = false;
        observedBufferingTrueRef.current = false;
        setBuffering(true);
        playbackClock.set(0);
        setTimePos(0);
        setDuration(0);
        const opts = startTarget > 0 ? `start=${startTarget}` : '';
        await desktop.mpv.command('loadfile', resolved, 'replace', '-1', opts);
        if (cancelled) return;

        // Force unpause — mpv's pause state persists across loadfile,
        // so if anything else (PlayerSpikePage, prior session) left it
        // paused, the new file would silently sit on its first frame.
        desktop.play().catch(() => {});

        // Stream history seed so Continue Watching points back to this stream.
        try {
          setLastStreamSelection({
            authKey: props.authKey,
            type: props.type,
            id: props.id,
            videoId: props.videoId,
            url: props.url,
            title: props.title ?? null,
            logo: props.logo ?? null,
          });
        } catch {
          // ignore
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error)?.message ?? String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      // Stop playback on unmount so background mpv doesn't keep streaming
      // a torrent while the user is browsing the catalog.
      desktop.mpv.command('stop').catch(() => {});
    };
  }, [props.url]);

  // Subscribe to mpv state.
  useEffect(() => {
    // Stremio's canonical buffering pattern (stremio-video ShellVideo.js):
    // a SINGLE boolean fed by `paused-for-cache` AND `seeking`, both
    // writing the raw mpv flag straight into state. No debounce, no
    // timer, no time-pos cross-check. Either property going false
    // dismisses the loader. Trusts mpv to send both transitions
    // honestly — which it does. Our previous debounce + time-pos
    // watchdog made the state machine flap and could strand the
    // loader on flag-flap races.

    const unsubProp = desktop.onMpvPropChange(({ name, value }) => {
      switch (name) {
        case 'playback-time':
          // Drive the SUBTITLE rAF clock from `playback-time`, NOT
          // `time-pos`. They differ on files whose container has a
          // non-zero start_time (some MKV releases embed a positive
          // offset for sync alignment); time-pos exposes that raw
          // internal value, playback-time is rebased to 0 at first
          // frame. SRT cues are authored against the 0-based clock,
          // so anchoring the rAF extrapolator to playback-time is
          // what produces audio-aligned subtitles regardless of how
          // the encoder set start_time.
          if (typeof value === 'number') {
            hasPlaybackTimeRef.current = true;
            subClockRef.current = { videoTime: value, lastSyncAt: Date.now() };
          }
          break;
        case 'time-pos':
          if (typeof value === 'number') {
            // Always push the raw value to the live store so the
            // scrub bar's slider fill stays smooth at mpv's full
            // tick rate without re-rendering the rest of the player.
            playbackClock.set(value);
            // React state is rate-limited so the heavy component
            // body doesn't re-render at every mpv tick. Effects
            // keyed off `timePos` still see live-ish values (within
            // ~200 ms) which is well below any user-perceptible
            // threshold for the things that read it (up-next arming,
            // hasVideo gate, ref tracking).
            const now = Date.now();
            if (now - lastTimePosStateWriteRef.current >= TIME_POS_STATE_THROTTLE_MS) {
              lastTimePosStateWriteRef.current = now;
              setTimePos(value);
            }
            // Only anchor the subtitle clock from time-pos if we
            // haven't seen a playback-time tick yet (graceful
            // fallback on shells that don't observe playback-time).
            if (!hasPlaybackTimeRef.current) {
              subClockRef.current = { videoTime: value, lastSyncAt: Date.now() };
            }
            // Anchor "real playback has begun" once we cross the
            // initial seek/load target by >0.5s — flips
            // hasShownVideo so the buffering veil drops its solid-
            // black backdrop and reveals the live frame underneath.
            // This is purely a visual cue now; buffering itself is
            // driven exclusively by paused-for-cache + seeking
            // (Stremio's pattern).
            if (initialSeekRef.current === null) {
              initialSeekRef.current = value;
            } else if (value > initialSeekRef.current + 0.5) {
              playbackStartedRef.current = true;
              setHasShownVideo(true);
            }
          }
          break;
        case 'duration':
          if (typeof value === 'number') {
            setDuration(value);
            // Real-Debrid (and similar debrid services) replace DMCA'd
            // files with a ~30s "removed" placeholder video. A real
            // movie or episode is at least 5 minutes — anything shorter
            // is almost certainly that placeholder. Auto-fall back to
            // the next-best stream for this title instead of showing a
            // dead-end "Stream unavailable" overlay.
            if (value > 0 && value < 300) {
              desktop.pause().catch(() => {});
              autoFallbackToNextStream();
            }
          }
          break;
        case 'pause':
          if (typeof value === 'boolean') {
            setPaused(value);
            // Only show/lock controls when the USER explicitly paused
            // (via togglePlay). Buffering causes rapid pause/unpause
            // that would flash the controls.
            if (value && userPausedRef.current) {
              setControlsVisible(true);
              setInstantHideControls(false);
              if (controlsHideTimerRef.current != null) {
                window.clearTimeout(controlsHideTimerRef.current);
                controlsHideTimerRef.current = null;
              }
            } else if (!value && userPausedRef.current) {
              userPausedRef.current = false;
              if (controlsHideTimerRef.current != null) {
                window.clearTimeout(controlsHideTimerRef.current);
              }
              controlsHideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 3000);
            }
            // Re-anchor the subtitle clock on every pause/resume edge.
            // The rAF loop reads pausedRef (synced on each render) to
            // freeze elapsed time on pause; the snapshot keeps
            // videoTime at the right value for the upcoming resume.
            // Preserve the existing videoTime (which is playback-time
            // when available) rather than overwriting with raw
            // time-pos — those two values differ on files with a
            // non-zero start_time.
            subClockRef.current = {
              videoTime: hasPlaybackTimeRef.current
                ? subClockRef.current.videoTime
                : timePos,
              lastSyncAt: Date.now(),
            };
          }
          break;
        case 'paused-for-cache':
        case 'seeking':
          // Stremio's canonical buffering state machine: both
          // properties write the raw mpv flag directly into a single
          // `buffering` slot. Either property going true raises the
          // veil; either going false dismisses it. No debounce, no
          // time-pos cross-check. The `observedBufferingTrueRef` gate
          // exists ONLY so the initial idle-state echo of
          // paused-for-cache=false / seeking=false (emitted by mpv
          // when observation is registered, BEFORE the first load
          // starts cache pressure) can't dismiss the load splash.
          // Once we've seen at least one `true` from either property,
          // every subsequent value is trusted.
          if (typeof value === 'boolean') {
            if (value) {
              observedBufferingTrueRef.current = true;
              setBuffering(true);
            } else if (observedBufferingTrueRef.current) {
              setBuffering(false);
              // Diagnostic: log where mpv landed after the seek
              // completed so we can compare against the scrub
              // target. If the landed value differs significantly,
              // mpv snapped to a keyframe or fell back to a prior
              // position because the requested frame wasn't fetched.
              if (name === 'seeking') {
                desktop
                  .log(
                    `[seek][landed] ${name}=false at ` +
                      `time-pos=${timePosRef.current.toFixed(3)}s ` +
                      `(playbackClock=${playbackClock.get().toFixed(3)}s)`,
                  )
                  .catch(() => {});
              }
            }
          }
          break;
        case 'volume':
          if (typeof value === 'number') setVolume(value);
          break;
        case 'mute':
          if (typeof value === 'boolean') setMuted(value);
          break;
        case 'aid':
          if (typeof value === 'number' || typeof value === 'string') setAudioId(value);
          break;
        case 'sid':
          if (typeof value === 'number') {
            // Check if this sid was assigned by `sub-add` for an addon
            // track — if so, keep the `addon:<key>` form so the picker
            // shows the green dot next to the addon variant, not on a
            // phantom `embedded:N` that doesn't match any picker row.
            let addonMatch: string | null = null;
            for (const [k, sid] of addonSubIdRef.current.entries()) {
              if (sid === value) {
                addonMatch = k;
                break;
              }
            }
            setSelectedSubKey(addonMatch ? `addon:${addonMatch}` : `embedded:${value}`);
          } else if (value === 'no' || value === false) {
            setSelectedSubKey('off');
          }
          break;
        case 'video-params/gamma':
          // mpv reports the transfer characteristic for the active
          // video track. "pq" = HDR10/HDR10+, "hlg" = Hybrid Log-Gamma.
          // Everything else (bt.1886, gamma2.2, …) is SDR. Stremio
          // surfaces this as an "HDR" badge top-right of the player;
          // we follow the exact same predicate.
          if (typeof value === 'string') {
            setVideoGamma(value);
          } else {
            setVideoGamma(null);
          }
          break;
        case 'dwidth':
          // Post-aspect-correction width of the active video track.
          // Drives the 4K badge top-right (>= 3840 = UHD/4K).
          if (typeof value === 'number') {
            setVideoDwidth(value);
          } else {
            setVideoDwidth(null);
          }
          break;
      }
    });
    const unsubEvt = desktop.onMpvEvent((e) => {
      void e;
      // (Previously dismissed the veil on FileLoaded / PlaybackRestart
      // as a safety net. Removed — buffering is now driven exclusively
      // by the paused-for-cache + seeking properties in the prop
      // observer above, matching Stremio's stremio-video pattern. No
      // event-side dismissal needed.)
    });
    return () => {
      unsubProp();
      unsubEvt();
    };
  }, []);

  // Phase 4 iter 2: Up-next auto-advance — mirrors SimplePlayer's pattern
  // but driven by mpv property/event observation instead of <video> events.
  const advanceToNextEpisode = useCallback(() => {
    const next = props.nextEpisodeInfo;
    if (!next || !props.type || !props.id) return;
    upNextFiredRef.current = true;

    try {
      sessionStorage.removeItem(`bliss:nextEpisode:${props.type}:${props.id}`);
    } catch {
      // ignore
    }

    const storedStream = getLastStreamSelection({
      authKey: props.authKey,
      type: props.type,
      id: props.id,
      videoId: next.nextVideoId,
    });

    const params = new URLSearchParams();
    if (storedStream?.url) {
      params.set('url', storedStream.url);
      if (storedStream.title) params.set('title', storedStream.title);
      if (props.type) params.set('type', props.type);
      if (props.id) params.set('id', props.id);
      params.set('videoId', next.nextVideoId);
      if (props.poster) params.set('poster', props.poster);
      if (props.metaTitle) params.set('metaTitle', props.metaTitle);
      if (props.logo) params.set('logo', props.logo);
      navigate(`/player?${params.toString()}`, { replace: true });
    } else {
      params.set('videoId', next.nextVideoId);
      if (next.nextSeason !== null) params.set('season', String(next.nextSeason));
      if (next.nextEpisode !== null) params.set('episode', String(next.nextEpisode));
      navigate(
        `/detail/${encodeURIComponent(props.type)}/${encodeURIComponent(props.id)}?${params.toString()}`,
        { replace: true },
      );
    }
  }, [
    props.nextEpisodeInfo,
    props.type,
    props.id,
    props.authKey,
    props.poster,
    props.metaTitle,
    props.logo,
    navigate,
  ]);

  // Episode drawer: navigate to a different episode. Reuses the same
  // stream-history lookup pattern as advanceToNextEpisode.
  const onSelectEpisode = useCallback(
    (video: EpisodeVideo) => {
      if (!props.type || !props.id) return;
      // Guests cannot change episodes — only the host can.
      if (!watchParty.isHost && watchParty.connected) return;
      if (video.id === props.videoId) {
        // Already playing this episode — just close the drawer.
        setEpisodesOpen(false);
        return;
      }
      const storedStream = getLastStreamSelection({
        authKey: props.authKey,
        type: props.type,
        id: props.id,
        videoId: video.id,
      });
      const params = new URLSearchParams();
      if (storedStream?.url) {
        params.set('url', storedStream.url);
        if (storedStream.title) params.set('title', storedStream.title);
        if (props.type) params.set('type', props.type);
        if (props.id) params.set('id', props.id);
        params.set('videoId', video.id);
        if (props.poster) params.set('poster', props.poster);
        if (props.metaTitle) params.set('metaTitle', props.metaTitle);
        if (props.logo) params.set('logo', props.logo);
        if (props.background) params.set('background', props.background);
        navigate(`/player?${params.toString()}`, { replace: true });
      } else {
        params.set('videoId', video.id);
        if (video.season !== null) params.set('season', String(video.season));
        if (video.episode !== null) params.set('episode', String(video.episode));
        navigate(
          `/detail/${encodeURIComponent(props.type)}/${encodeURIComponent(props.id)}?${params.toString()}`,
          { replace: true },
        );
      }
    },
    [props.type, props.id, props.videoId, props.authKey, props.poster, props.metaTitle, props.logo, props.background, navigate, watchParty.isHost, watchParty.connected],
  );

  // Time-based trigger: show up-next overlay when remaining ≤ configured
  // notification duration.
  useEffect(() => {
    if (!props.nextEpisodeInfo) return;
    if (showUpNext || upNextCancelledRef.current || upNextFiredRef.current) return;
    const notifSec = props.playerSettings.nextVideoNotificationDurationMs / 1000;
    if (notifSec <= 0) return;
    if (!Number.isFinite(timePos) || !Number.isFinite(duration) || duration <= 0) return;
    const remaining = duration - timePos;
    if (remaining > 0 && remaining <= notifSec) {
      setShowUpNext(true);
    }
  }, [
    timePos,
    duration,
    props.nextEpisodeInfo,
    props.playerSettings.nextVideoNotificationDurationMs,
    showUpNext,
  ]);

  // EndFile event fallback — fires for binge-watching even when the
  // notification was disabled (notifSec = 0) or auto-dismissed late.
  useEffect(() => {
    const unsub = desktop.onMpvEvent((e) => {
      if (e.type !== 'EndFile') return;
      // Only trigger on natural end-of-file — "eof" means the video
      // played to completion. Skip "error", "quit", "redirect", "stop"
      // (stop = user-initiated or loadfile replacing the current file).
      const reason = (e.reason ?? '').toLowerCase();
      if (reason !== 'eof') return;
      if (upNextFiredRef.current) return;
      if (!props.nextEpisodeInfo) return;
      if (!showUpNext && !upNextCancelledRef.current) {
        setShowUpNext(true);
      } else if (props.playerSettings.bingeWatching && !upNextCancelledRef.current) {
        advanceToNextEpisode();
      }
    });
    return unsub;
  }, [
    props.nextEpisodeInfo,
    props.playerSettings.bingeWatching,
    showUpNext,
    advanceToNextEpisode,
  ]);

  // Countdown when overlay is visible. Auto-advance on 0 unless cancelled.
  useEffect(() => {
    if (!showUpNext) {
      setUpNextCountdown(10);
      return;
    }
    setUpNextCountdown(10);
    const interval = window.setInterval(() => {
      setUpNextCountdown((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          if (!upNextCancelledRef.current && !upNextFiredRef.current) {
            advanceToNextEpisode();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [showUpNext, advanceToNextEpisode]);

  const cancelUpNext = useCallback(() => {
    upNextCancelledRef.current = true;
    setShowUpNext(false);
  }, []);

  // Phase 4 iter 2: sync subtitle styling from playerSettings to mpv.
  // Stremio's subtitle pickers (size + text/background/outline color) map
  // directly to mpv's sub-* property set.
  useEffect(() => {
    const settings = props.playerSettings;
    const parseRgba = (rgba: string): [number, number, number, number] | null => {
      const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return [
        Number(m[1]),
        Number(m[2]),
        Number(m[3]),
        m[4] != null ? Number(m[4]) : 1,
      ];
    };
    // mpv color format is `#AARRGGBB` — alpha FIRST, not last.
    const hex = (rgba: string, fallback: string) => {
      const p = parseRgba(rgba);
      if (!p) return fallback;
      const [r, g, b, a] = p;
      const rh = r.toString(16).padStart(2, '0');
      const gh = g.toString(16).padStart(2, '0');
      const bh = b.toString(16).padStart(2, '0');
      const ah = Math.round(a * 255).toString(16).padStart(2, '0');
      return `#${ah}${rh}${gh}${bh}`;
    };
    // ASS color: &H<AA><BB><GG><RR>& — alpha BB GG RR, alpha INVERTED
    // (00 = opaque, FF = transparent). Used inside sub-ass-force-style
    // strings which inject style overrides directly into the ASS
    // script's style table. This path ALWAYS wins, even when
    // sub-ass-override fails to take effect (some mpv builds ignore it
    // unless the file is reloaded, and the force-style is the workaround
    // every mpv user-script uses).
    const ass = (rgba: string, fallbackHex: string) => {
      const p = parseRgba(rgba);
      const [r, g, b, a] = p ?? [255, 255, 255, 1];
      if (!p && fallbackHex) {
        // accept fallback as #RRGGBB / #RRGGBBAA / rgba(...)
        const fb = parseRgba(fallbackHex);
        if (fb) return ass(`rgba(${fb[0]}, ${fb[1]}, ${fb[2]}, ${fb[3]})`, '');
      }
      const aa = Math.round((1 - a) * 255).toString(16).padStart(2, '0').toUpperCase();
      const bh = b.toString(16).padStart(2, '0').toUpperCase();
      const gh = g.toString(16).padStart(2, '0').toUpperCase();
      const rh = r.toString(16).padStart(2, '0').toUpperCase();
      return `&H${aa}${bh}${gh}${rh}&`;
    };
    // Every property below goes through the `set` command pipeline
    // (string-typed all the way down). The typed setProperty pipeline
    // was silently failing for properties whose mpv format differs from
    // the JSON value type — sub-font-size is float in mpv but we sent
    // an int, sub-delay similarly. Using `set` makes mpv parse the
    // value into the right type itself.
    //
    // `sub-ass-override = force` makes mpv apply our color/size on top
    // of any ASS/SSA styling baked into the file. Without this, most
    // BluRay rips (which ship ASS subs) ignore sub-color and
    // sub-font-size entirely — the user complains "my green color
    // doesn't show / size slider doesn't do anything" because mpv is
    // respecting the ASS style. We push it from the renderer (not just
    // mpv init) so the change takes effect without a shell rebuild.
    desktop.mpv.command('set', 'sub-ass-override', 'force').catch(() => {});
    // ASS scripts carry their own positioning (\an alignment + MarginV
    // pixels per dialogue line). `sub-ass-override=force` overrides
    // styling but NOT positioning — we need this flag to make mpv's
    // `sub-margin-y` / `sub-pos` actually apply to embedded ASS subs.
    // Without it, BluRay rips' subs ignore the vertical-position slider
    // entirely while SRT/VTT addon subs move fine.
    desktop.mpv.command('set', 'sub-ass-force-margins', 'yes').catch(() => {});
    // Embedded sub size:
    //   * sub-font-size controls SRT/VTT (mpv's default text
    //     renderer). The unit is "pixels at a window height of 720"
    //     so the displayed size scales with viewport height.
    //   * sub-scale multiplies BOTH renderers. Pinned at 1.0 so
    //     ASS-format subs (BD rips) render at the size the release
    //     group authored — anything else either over-magnifies them
    //     (visible cause of the original 16px hardcode) or shrinks
    //     them under the slider value (the bug this comment
    //     replaced, where SRT subs from Western WEB-DLs rendered at
    //     ~9 effective px and looked invisible).
    //   * The user's slider feeds sub-font-size so the SRT path is
    //     user-controlled, while ASS stays at the file's authored
    //     size. We read from the LOCAL `subtitleSizePx` state, not
    //     `props.playerSettings.subtitlesSizePx`, because the slider
    //     bypasses `savePlayerSettings()` (it writes localStorage
    //     directly + setSubtitleSizePx for instant feedback) — if
    //     this effect read from props it would never re-fire on
    //     slider drag and the visible size wouldn't change.
    const embeddedSubPx = subtitleSizePx ?? 32;
    desktop.mpv.command('set', 'sub-scale', '1.0').catch(() => {});
    desktop.mpv.command('set', 'sub-font-size', String(embeddedSubPx)).catch(() => {});
    // mpv color (AARRGGBB) — for SRT/VTT text subs, also as a fallback
    // path for ASS in some builds.
    desktop.mpv.command('set', 'sub-color', hex(settings.subtitlesTextColor, '#FFFFFFFF')).catch(() => {});
    desktop.mpv.command('set', 'sub-back-color', hex(settings.subtitlesBackgroundColor, '#00000000')).catch(() => {});
    desktop.mpv.command('set', 'sub-border-color', hex(settings.subtitlesOutlineColor, '#BF000000')).catch(() => {});

    // ASS force-style: directly rewrite the Default style fields in the
    // ASS script. This is what the mpv community uses to force ASS
    // overrides because `sub-ass-override` is unreliable across builds
    // — it only kicks in if the subtitle gets reloaded, and even then
    // certain fields (Author/Style overrides inside Dialogue events)
    // can still win. force-style runs at parse time and ALWAYS sticks.
    //   PrimaryColour = main text color  (&H<AA><BB><GG><RR>&)
    //   OutlineColour = outline color
    //   BackColour    = shadow color (used as background)
    //   FontSize      = ASS script font-size unit (≈px×2 at 720 PlayResY)
    // ASS `FontSize` is in script units; at the typical PlayResY=720
    // it's nearly equivalent to mpv's sub-font-size pixels-at-720p,
    // so passing `embeddedSubPx` directly keeps SRT (sub-font-size)
    // and ASS (this FontSize) at visually matching sizes — both
    // governed by the user's `subtitlesSizePx` slider.
    const assStyle = [
      `PrimaryColour=${ass(settings.subtitlesTextColor, 'rgba(255,255,255,1)')}`,
      `OutlineColour=${ass(settings.subtitlesOutlineColor, 'rgba(0,0,0,0.75)')}`,
      `BackColour=${ass(settings.subtitlesBackgroundColor, 'rgba(0,0,0,0)')}`,
      `FontSize=${embeddedSubPx}`,
    ].join(',');
    desktop.mpv.command('set', 'sub-ass-force-style', assStyle).catch(() => {});
    // Re-parse the active sub track with the new force-style. For
    // embedded ASS subs, `sub-reload` alone doesn't always re-process
    // the styling — mpv has the parsed lib-ass object cached. The
    // reliable fix is to flip `sid` off then back on, which fully
    // re-loads the track through the demuxer with the new force-style
    // applied at parse time. We extract the current sid from the React
    // state (`selectedSubKey` like `embedded:2`) so we can restore it.
    desktop.mpv.command('sub-reload').catch(() => {});
    const embeddedMatch = /^embedded:(\d+)$/.exec(selectedSubKey);
    if (embeddedMatch) {
      const sid = embeddedMatch[1];
      desktop.mpv.command('set', 'sid', 'no').catch(() => {});
      // Small delay so mpv finishes deactivating before we re-arm sid.
      window.setTimeout(() => {
        desktop.mpv.command('set', 'sid', sid).catch(() => {});
      }, 60);
    }

    // Track-language preferences. mpv accepts comma-separated ISO-639-2
    // codes and auto-selects the first match on file load. Empty string
    // means "no preference" — mpv falls back to its default selection
    // (usually first track in the file).
    // Default audio to English unless the user has explicitly picked
    // another language in profile settings. mpv `alang` accepts a
    // priority list — "eng,en" matches both 3-letter and 2-letter
    // ISO codes that different containers use. Empty string would
    // mean "no preference", letting mpv pick the first track
    // (usually whatever order the file lists them in).
    const alang = settings.audioLanguage && settings.audioLanguage.trim() !== ''
      ? settings.audioLanguage
      : 'eng,en';
    desktop.mpv.command('set', 'alang', alang).catch(() => {});
    // mpv's `slang` expects ISO 639 codes (eng, en), not display
    // names (English). Map common names and pass through anything
    // that already looks like a code.
    const subLangPref = settings.subtitlesLanguage ?? '';
    const langMap: Record<string, string> = {
      english: 'eng,en', german: 'ger,deu,de', french: 'fre,fra,fr',
      spanish: 'spa,es', italian: 'ita,it', portuguese: 'por,pt',
      russian: 'rus,ru', japanese: 'jpn,ja', korean: 'kor,ko',
      chinese: 'chi,zho,zh', arabic: 'ara,ar', hindi: 'hin,hi',
      turkish: 'tur,tr', polish: 'pol,pl', dutch: 'dut,nld,nl',
      swedish: 'swe,sv', czech: 'cze,ces,cs', romanian: 'rum,ron,ro',
      hungarian: 'hun,hu', bulgarian: 'bul,bg', croatian: 'hrv,hr',
      serbian: 'srp,sr', slovak: 'slo,slk,sk', slovenian: 'slv,sl',
      greek: 'gre,ell,el', danish: 'dan,da', finnish: 'fin,fi',
      norwegian: 'nor,no', thai: 'tha,th', vietnamese: 'vie,vi',
      indonesian: 'ind,id', malay: 'may,msa,ms', hebrew: 'heb,he',
      persian: 'per,fas,fa', ukrainian: 'ukr,uk', albanian: 'alb,sqi,sq',
    };
    const slangValue = langMap[subLangPref.toLowerCase()] ?? subLangPref;
    desktop.mpv.command('set', 'slang', slangValue).catch(() => {});
  }, [
    // `subtitleSizePx` is the local state the in-player slider drives
    // directly. The settings-page editor goes through
    // `props.playerSettings.subtitlesSizePx` (the React state) which
    // PlayerPage syncs into props on change. Both deps so either path
    // re-fires the styling effect and the new size reaches mpv.
    subtitleSizePx,
    props.playerSettings.subtitlesSizePx,
    props.playerSettings.subtitlesTextColor,
    props.playerSettings.subtitlesBackgroundColor,
    props.playerSettings.subtitlesOutlineColor,
    props.playerSettings.audioLanguage,
    props.playerSettings.subtitlesLanguage,
    props.playerSettings,
    selectedSubKey,
  ]);

  // Subscribe to fullscreen state so the icon flips after toggleFullscreen.
  useEffect(() => {
    desktop.isFullscreen().then(setIsFullscreen).catch(() => {});
    const unsub = desktop.onFullscreenChanged(setIsFullscreen);
    return unsub;
  }, []);

  // Periodic progress save — every ~5s while playing. Reads latest
  // timePos/duration/paused via refs so the interval doesn't get
  // recreated on every mpv property tick (time-pos fires multiple times
  // per second — putting it in the dep array kills the timer before it
  // can ever fire, so no saves happen).
  const timePosRef = useRef(timePos);
  const durationRef = useRef(duration);
  const pausedRef = useRef(paused);
  // Mirrors the `buffering` state into a ref so the HTML subtitle
  // overlay's rAF loop can freeze the cue clock during cache
  // underrun + seek (mpv flips `paused-for-cache` / `seeking` for
  // those, NOT `pause` — so pausedRef alone doesn't catch them,
  // and the rAF kept extrapolating wall-clock time forward past a
  // frozen frame, making subs visibly drift mid-buffer).
  const bufferingRef = useRef(false);
  timePosRef.current = timePos;
  durationRef.current = duration;
  pausedRef.current = paused;
  bufferingRef.current = buffering;
  useEffect(() => {
    const interval = window.setInterval(() => {
      const t = timePosRef.current;
      const d = durationRef.current;
      if (pausedRef.current || d <= 0 || t <= 0) return;
      const now = performance.now();
      if (now - lastProgressSaveRef.current < 4500) return;
      lastProgressSaveRef.current = now;
      try {
        setProgress(
          { type: props.type, id: props.id, videoId: props.videoId ?? undefined },
          { time: t, duration: d },
        );
      } catch {
        // ignore
      }
      if (props.authKey) {
        // Write to Blissful backend (primary progress store).
        void updateBlissfulLibraryProgress(props.authKey, {
          id: props.id,
          type: props.type,
          videoId: props.videoId ?? null,
          timeSeconds: t,
          durationSeconds: d,
          name: props.metaTitle ?? props.title ?? null,
          poster: props.poster ?? null,
          streamUrl: props.url ?? null,
          streamTitle: props.title ?? null,
        }).catch(() => {
          // throttled writes will catch up next session
        });
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [props.authKey, props.id, props.type, props.videoId]);

  // Auto-fallback when the URL we were given turns out to be a debrid
  // DMCA placeholder (pre-load HEAD probe with <20 MB Content-Length OR
  // post-load mpv reports duration <5 min). Instead of showing a
  // "Stream unavailable" dead-end, navigate to the detail page with
  // `autoplay=1` so the existing auto-pick flow grabs the next-best
  // stream and resumes at the same saved offset. Carry forward any
  // existing `skip=` URLs from the current /player query AND append
  // the current dead URL — DetailPage uses this list to exclude streams
  // we've already proven dead, otherwise auto-pick would re-select the
  // same row and bounce us right back here in a loop.
  // No auto-fallback. If a stream fails, the player stays put — the
  // user presses Back and picks a different stream. The old auto-
  // fallback navigated to detail→player in a loop, causing repeated
  // unmounts and console error floods from dead addons.
  const autoFallbackToNextStream = useCallback(() => {
    // no-op — disabled
  }, []);

  // Auto-hide controls after 3s of mouse inactivity.
  const showControls = useCallback(() => {
    setInstantHideControls(false);
    setControlsVisible(true);
    if (controlsHideTimerRef.current != null) {
      window.clearTimeout(controlsHideTimerRef.current);
    }
    // Don't start the idle auto-hide until the first frame has rendered.
    // While a torrent is still loading (timePos === 0) the controls stay
    // pinned so the user can always reach Back. Mid-stream rebuffers keep
    // timePos > 0, so they're unaffected — preserving the no-flash fix.
    if (!userPausedRef.current && timePosRef.current > 0) {
      controlsHideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 3000);
    }
  }, []);

  // Hide controls instantly — used when the cursor leaves the player
  // area (Stremio behavior: moving the mouse to the title bar or
  // outside the window immediately dismisses the controls bar, no
  // fade timer). Cancels the pending 3s auto-hide so we don't fight it.
  const hideControlsNow = useCallback(() => {
    // Keep controls pinned before the first frame (torrent still loading)
    // even if the cursor leaves the window — otherwise Back is unreachable.
    if (userPausedRef.current || timePosRef.current === 0) return;
    if (controlsHideTimerRef.current != null) {
      window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
    setInstantHideControls(true);
    setControlsVisible(false);
  }, []);
  useEffect(() => {
    showControls();
    return () => {
      if (controlsHideTimerRef.current != null) {
        window.clearTimeout(controlsHideTimerRef.current);
      }
    };
  }, [showControls]);

  // Once the first frame lands, begin the normal mouse-idle auto-hide.
  // Until then `showControls`/`hideControlsNow` keep the controls pinned
  // (see above) so Back stays reachable while the torrent buffers.
  const hasFirstFrame = timePos > 0;
  useEffect(() => {
    if (hasFirstFrame) showControls();
  }, [hasFirstFrame, showControls]);

  // Back from the player always lands on the movie/episode's detail
  // page — never `navigate(-1)`, which would walk through whatever
  // route the user took to get here (search results, sidebar continue-
  // watching, auto-fallback chain, etc.). For series, carry the videoId
  // so the detail page opens on the right episode.
  const onBack = useCallback(() => {
    const base = `/detail/${encodeURIComponent(props.type)}/${encodeURIComponent(props.id)}`;
    if (props.type === 'series' && props.videoId) {
      navigate(`${base}?videoId=${encodeURIComponent(props.videoId)}`);
    } else {
      navigate(base);
    }
  }, [navigate, props.type, props.id, props.videoId]);

  const userPausedRef = useRef(false);
  const togglePlay = useCallback(() => {
    if (paused) {
      userPausedRef.current = false;
      desktop.play().catch(() => {});
      watchParty.broadcastPlay();
    } else {
      userPausedRef.current = true;
      desktop.pause().catch(() => {});
      watchParty.broadcastPause();
    }
  }, [paused, watchParty]);

  const toggleMute = useCallback(() => {
    desktop.mpv.setProperty('mute', !muted).catch(() => {});
  }, [muted]);

  // Volume slider handler. Hoisted from the inline JSX so
  // `<PlayerControlsBar>`'s memoised slider props stay reference-stable
  // between parent renders that don't change the volume itself.
  // mpv's `volume-max` is set to 200 in the shell init — 0..2 in the
  // slider maps to 0..200 % with software amplification above 100.
  const onVolumeChange = useCallback((next: number) => {
    const target = Math.round(Math.min(200, Math.max(0, next * 100)));
    desktop.mpv.setProperty('volume', target).catch(() => {});
    desktop.mpv.setProperty('mute', target === 0).catch(() => {});
  }, []);

  const onToggleFullscreen = useCallback(() => {
    desktop.toggleFullscreen().catch(() => {});
  }, []);

  // Fetch the track list from mpv. Triggered on FileLoaded (and after
  // mpv.setProperty('aid'/'sid') for an explicit refresh).
  const refreshTracks = useCallback(async () => {
    try {
      const list = await desktop.mpv.getTracks();
      setTracks(Array.isArray(list) ? list : []);
      // Diagnostic: dump the sub tracks so we can tell whether mpv
      // saw embedded subs at all when the user reports "I don't see
      // subtitles." If this logs zero sub rows, mpv hasn't loaded
      // them (file/codec issue); if it logs rows but the overlay is
      // blank, the issue is on the selection / visibility side.
      if (Array.isArray(list)) {
        const subs = list.filter((t) => t.kind === 'sub');
        const audios = list.filter((t) => t.kind === 'audio');
        desktop
          .log(
            `[tracks] mpv: ${audios.length} audio, ${subs.length} sub -> ` +
              subs
                .map(
                  (t) =>
                    `sid=${t.id}/${t.lang ?? '?'}/${t.codec ?? '?'}/${t.selected ? 'SEL' : '-'}/"${t.title ?? ''}"`,
                )
                .join(' | '),
          )
          .catch(() => {});
      }
    } catch {
      // ignore
    }
  }, []);

  // Open the unified settings panel on the specified tab. Closes the
  // old-style audio/sub popovers if they happen to be open.
  const openSettings = useCallback((tab: SettingsTab) => {
    setAudioMenuOpen(false);
    setSubMenuOpen(false);
    setSettingsTab(tab);
    setSettingsPanelOpen(true);
    void refreshTracks();
  }, [refreshTracks]);

  const selectAudio = useCallback(
    async (id: number | 'no') => {
      setAudioMenuOpen(false);
      // Always send `aid` as a string. libmpv2 5.0's `set_property` is
      // strict about MPV_FORMAT_* — passing a JS number arrives as i64
      // or f64 in Rust, and neither matches `aid`'s underlying format
      // reliably. mpv accepts STRING for every settable property and
      // parses internally ("1" → 1, "no" → disable).
      try {
        await desktop.mpv.setProperty('aid', String(id));
      } catch (e) {
        console.error('[player] aid set failed', e);
      }
      refreshTracks();
    },
    [refreshTracks],
  );

  // Refresh whenever a new file is loaded / playback restarts.
  // Also flips `fileLoadedReady` true so the auto-sub effect can gate
  // on the exact "mpv is ready for sub-add" moment (Stremio's player
  // uses the same FileLoaded signal for its subtitle attach flow).
  const [fileLoadedReady, setFileLoadedReady] = useState(false);
  useEffect(() => {
    const unsub = desktop.onMpvEvent((e) => {
      if (e.type === 'FileLoaded' || e.type === 'PlaybackRestart') {
        // Small delay so mpv has populated track-list/* properties,
        // then flip fileLoadedReady — AFTER refreshTracks() completes
        // and `tracks` state is up to date. Flipping it before tracks
        // refresh races the auto-load effect, which then sees an
        // empty embedded list and picks an addon variant instead of
        // the (yet-unloaded) embedded one.
        setTimeout(async () => {
          await refreshTracks();
          setFileLoadedReady(true);
        }, 200);
      }
    });
    return unsub;
  }, [refreshTracks]);
  // Reset all per-file subtitle state on URL change (player re-mounts
  // but state may persist via fast HMR / batched updates). This is
  // critical for the "two subtitles showing at once" bug — without
  // it, an addon overlay loaded for the previous file kept rendering
  // (green) while mpv auto-selected a new embedded track via `slang`
  // (white), so both showed simultaneously.
  useEffect(() => {
    setFileLoadedReady(false);
    setAddonSubCues(null);
    setOverlayCueText('');
    addonSubIdRef.current.clear();
    // Clear the HDR badge between files — otherwise a previous HDR
    // playback's gamma value lingers on top of an SDR follow-up until
    // mpv reports a fresh `video-params/gamma`.
    setVideoGamma(null);
    // Same reasoning for the 4K badge: a previous file's dwidth must
    // not leak onto a lower-resolution follow-up.
    setVideoDwidth(null);
    // Reset the playback-time latch so the next file starts with the
    // time-pos fallback active until playback-time begins ticking.
    hasPlaybackTimeRef.current = false;
  }, [props.url]);

  // Fetch subtitle tracks from every addon that lists "subtitles" as a
  // resource. Same dedup/priority logic as SimplePlayer — opensubtitles
  // ranked first. The list keeps streaming in as addons resolve, with a
  // 50ms debounce so we don't re-render per-subtitle.
  useEffect(() => {
    if (!props.id || !props.type) {
      setAddonSubs([]);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setAddonSubs([]);
    const baseId = props.videoId ?? props.id;
    const uniq = new Map<string, AddonSubtitleTrack>();
    let flushTimer: number | null = null;
    const flush = () => {
      flushTimer = null;
      if (cancelled) return;
      setAddonSubs(Array.from(uniq.values()));
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = window.setTimeout(flush, 50);
    };
    const addonPriority = (addon: AddonDescriptor): number => {
      const name = (addon.manifest?.name ?? '').toLowerCase();
      const url = addon.transportUrl.toLowerCase();
      if (name.includes('subtitles') || url.includes('subtitles')) return 3;
      if (name.includes('opensubtitles') || url.includes('opensubtitles')) return 3;
      return 0;
    };
    const candidates = addonsRef.current
      .filter((addon) => {
        const resources = addon.manifest?.resources;
        if (!resources || resources.length === 0) return true;
        return resources.some((entry) => {
          if (typeof entry === 'string') return entry === 'subtitles';
          if (entry.name !== 'subtitles') return false;
          if (entry.types && entry.types.length > 0 && !entry.types.includes(props.type)) return false;
          if (entry.idPrefixes && entry.idPrefixes.length > 0) {
            return entry.idPrefixes.some((prefix) => baseId.startsWith(prefix));
          }
          return true;
        });
      })
      .slice()
      .sort((a, b) => addonPriority(b) - addonPriority(a));

    // Compute the OpenSubtitles 8-byte hash so hash-aware addons
    // (OpenSubtitles v3) return PERFECTLY synced subs. Two things to
    // know about /opensubHash:
    //   1. It reads first + last 64KB of the file. For torrents, the
    //      tail piece arrives late, so first attempts usually fail.
    //      We poll every 2s for up to 10s; the streaming server
    //      re-prioritizes tail pieces on each request.
    //   2. It needs a real HTTP stream URL — magnet:?xt URIs aren't
    //      seekable; resolve them to the streaming-server form first.
    const resolveHashUrl = (raw: string): string => {
      const magnet = parseMagnetInfo(raw);
      if (magnet) {
        return buildTorrentStreamUrl(
          magnet.infoHash,
          magnet.trackers,
          STREAMING_SERVER_URL,
          magnet.fileIdx,
        );
      }
      return raw;
    };
    void (async () => {
      let hashInfo: { hash: string; size: number } | null = null;
      const isRealUrl = props.url && /^https?:\/\/|^magnet:/i.test(props.url);
      if (isRealUrl) {
        const hashUrl = resolveHashUrl(props.url);
        const deadline = Date.now() + 10000;
        while (!cancelled && Date.now() < deadline) {
          hashInfo = await fetchOpenSubHash(hashUrl, controller.signal).catch(() => null);
          if (hashInfo) break;
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        }
      }
      if (cancelled) return;
      await Promise.allSettled(
        candidates.map(async (addon) => {
          const baseUrl = addon.transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
          const origin = addon.manifest?.name ?? addon.transportUrl;
          const resp = await fetchSubtitles({
            type: props.type as 'movie' | 'series',
            id: baseId,
            baseUrl,
            signal: controller.signal,
            videoHash: hashInfo?.hash,
            videoSize: hashInfo?.size,
          }).catch(
            () =>
              ({ subtitles: [] }) as {
                subtitles: { id?: string; lang?: string; url?: string; g?: string | number }[];
              },
          );
          for (const sub of resp.subtitles ?? []) {
            if (!sub?.url) continue;
            const lang = sub.lang ?? 'unknown';
            // Parse the OpenSubtitles "good" rating. Comes as a numeric
            // string most of the time, occasionally as a number; treat
            // anything unparseable as 0.
            const rawRating = (sub as { g?: string | number }).g;
            const rating =
              typeof rawRating === 'number'
                ? rawRating
                : typeof rawRating === 'string'
                  ? Number.parseInt(rawRating, 10) || 0
                  : 0;
            if (!uniq.has(sub.url)) {
              uniq.set(sub.url, {
                key: `${addon.transportUrl}::${sub.id ?? sub.url}`,
                lang,
                label: sub.lang ?? 'Subtitles',
                origin,
                rating,
                url: sub.url,
              });
              scheduleFlush();
            }
          }
        }),
      );
      if (flushTimer) window.clearTimeout(flushTimer);
      flush();
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (flushTimer) window.clearTimeout(flushTimer);
    };
  // Stringify addon URLs so the effect only re-fires when the actual
  // URL list changes, not when manifest hydration creates new object
  // references (which was triggering repeated subtitle fetches +
  // 500/502 error floods).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addonUrlsKey, props.id, props.type, props.videoId, props.url]);

  // HTML subtitle render loop — mirrors Stremio's withHTMLSubtitles:
  // a requestAnimationFrame loop that extrapolates the current play
  // clock as `videoTime + (now - lastSyncAt)`. mpv only emits
  // `time-pos` when the value changes; that rate can be coarse and
  // bursty over the IPC bridge, which makes a useEffect-on-timePos
  // approach lag the audio noticeably. Extrapolating in rAF means
  // the cue clock advances every frame (60Hz) and re-anchors itself
  // every time a new mpv tick lands. `subtitleDelay` shifts the cue
  // lookup (positive = subs later, matches mpv's sub-delay semantics).
  useEffect(() => {
    if (!addonSubCues || addonSubCues.length === 0) {
      if (overlayCueText) setOverlayCueText('');
      return;
    }
    let raf = 0;
    let lastCueText = overlayCueText;
    const tick = () => {
      const snap = subClockRef.current;
      // Freeze the cue clock whenever playback isn't actually
      // advancing: `paused` (user toggle) OR `buffering` (mpv
      // flipped `paused-for-cache` or `seeking` because of a cache
      // underrun / seek-in-flight). The previous version checked
      // only `pausedRef`, so during a buffer underrun the rAF kept
      // walking wall-clock time forward against a frozen frame and
      // the wrong cue line showed up. Both refs re-anchor when the
      // next `time-pos` / `playback-time` event lands.
      const frozen = pausedRef.current || bufferingRef.current;
      const elapsed = frozen ? 0 : (Date.now() - snap.lastSyncAt) / 1000;
      const t = snap.videoTime + elapsed - subtitleDelay;
      const cue = findCueAt(addonSubCues, t);
      const next = cue ? cue.text : '';
      if (next !== lastCueText) {
        lastCueText = next;
        setOverlayCueText(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [addonSubCues, subtitleDelay]);

  // Push subtitle delay to mpv. Sent through the `set` command pipeline
  // (string-typed all the way down) because setProperty's typed
  // dispatch was failing silently for sub-delay (which is float in mpv
  // 0.39 but the IPC routes integer JSON values to set_property_int).
  useEffect(() => {
    desktop.mpv
      .command('set', 'sub-delay', String(subtitleDelay))
      .catch((e: unknown) => console.error('[player] sub-delay failed', e));
  }, [subtitleDelay]);

  // Vertical-position slider mapping.
  //
  // mpv's `sub-pos` is bounded 0..100 (0=top, 100=bottom). For
  // ASS-format embedded subs libass clamps values >100 back to the
  // frame edge — which is why the previous `sub-pos = 120` baseline
  // looked fine on anime BD rips. But for SRT/text subs there's no
  // clamp; mpv just keeps drawing further off-screen. That's exactly
  // what made embedded English subtitles on Western WEB-DL releases
  // (From, plenty of MGM+/Netflix/Amazon rips) silently invisible
  // even though mpv reported sid=1 SELECTED.
  //
  // Pin `sub-pos = 100` (frame bottom) and do ALL the vertical lift
  // via `sub-margin-y` in pixels, which works the same for SRT, VTT,
  // and ASS. The asymmetric ramp keeps the prior feel (slider=0 sits
  // at the mpv default ~22px above bottom, +50 lifts well clear of
  // the controls card, -50 dives into the letterbox / below the
  // frame for cinemascope content).
  useEffect(() => {
    //   slider=+50 → margin=120 px (well above the controls card)
    //   slider=  0 → margin= 22 px (mpv default — subs at frame bottom)
    //   slider=-50 → margin=-178 px (deep into letterbox / off-screen)
    const subMarginY =
      subtitleVerticalPercent >= 0
        ? Math.round(22 + (subtitleVerticalPercent * (120 - 22)) / 50)
        : Math.round(22 + subtitleVerticalPercent * 4);
    desktop.mpv
      .command('set', 'sub-pos', '100')
      .catch((e: unknown) => console.error('[player] sub-pos failed', e));
    desktop.mpv
      .command('set', 'sub-margin-y', String(subMarginY))
      .catch((e: unknown) => console.error('[player] sub-margin-y failed', e));
    // Force libass to re-render with the new margins. Without this, ASS
    // subs parsed before sub-ass-force-margins=yes was set keep their
    // original positions even after sub-margin-y changes.
    desktop.mpv.command('sub-reload').catch(() => {});
  }, [subtitleVerticalPercent]);

  // When the user picks a color in the modal we update local state and
  // ALSO persist back to playerSettings — this re-runs the main
  // styling effect (which pushes sub-color, sub-ass-force-style, etc.)
  // and saves the choice to localStorage so the Settings page reflects
  // the same value.
  const updateColor = useCallback(
    (key: 'text' | 'bg' | 'outline', hex: string, alpha: number) => {
      const rgba = buildRgba(hex, alpha);
      const next = { ...props.playerSettings };
      if (key === 'text') {
        setSubtitleColor(rgba);
        next.subtitlesTextColor = rgba;
      } else if (key === 'bg') {
        setSubtitleBackgroundColor(rgba);
        next.subtitlesBackgroundColor = rgba;
      } else {
        setSubtitleOutlineColor(rgba);
        next.subtitlesOutlineColor = rgba;
      }
      try {
        writeStoredPlayerSettings(next);
      } catch {
        // ignore
      }
    },
    [props.playerSettings],
  );

  // Legacy color popover trigger -- kept for the ChromePicker which is
  // still mounted in the render tree for backward compatibility. The
  // new SettingsPanel uses inline color swatches instead. Prefixed to
  // suppress the unused-variable lint.
  const _openColorPopover = useCallback(
    (key: 'text' | 'bg' | 'outline', target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      const top = Math.max(8, rect.top - 380);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 280));
      setColorPopoverPos({ top, left });
      setColorModal(key);
    },
    [],
  );
  void _openColorPopover;

  const subtitleTextParsed = useMemo(() => parseColor(subtitleColor), [subtitleColor]);
  const subtitleBgParsed = useMemo(() => parseColor(subtitleBackgroundColor), [subtitleBackgroundColor]);
  const subtitleOutlineParsed = useMemo(() => parseColor(subtitleOutlineColor), [subtitleOutlineColor]);
  const activeColor =
    colorModal === 'text'
      ? subtitleTextParsed
      : colorModal === 'bg'
      ? subtitleBgParsed
      : colorModal === 'outline'
      ? subtitleOutlineParsed
      : null;

  // Keep local color state in sync if playerSettings change from outside
  // (e.g., Settings page edited while player is mounted via HMR).
  useEffect(() => {
    setSubtitleColor(props.playerSettings.subtitlesTextColor);
    setSubtitleBackgroundColor(props.playerSettings.subtitlesBackgroundColor);
    setSubtitleOutlineColor(props.playerSettings.subtitlesOutlineColor);
  }, [
    props.playerSettings.subtitlesTextColor,
    props.playerSettings.subtitlesBackgroundColor,
    props.playerSettings.subtitlesOutlineColor,
  ]);

  // Apply a subtitle selection. For embedded tracks we just flip mpv's
  // `sid`. For addon tracks we `sub-add` the URL first (mpv assigns a new
  // sub-track id), remember it so re-selection skips the round-trip, then
  // flip `sid` to that id. `off` disables subs.
  const applySubtitleSelection = useCallback(
    async (key: string) => {
      setSelectedSubKey(key);
      // Use mpv's `set` command (string-typed pipeline) instead of
      // setProperty for sid / sub-visibility. The setProperty path goes
      // through libmpv2's typed SetData trait which is finicky for
      // properties whose internal format is int (sid is INT64). `set`
      // takes raw strings and mpv parses them server-side, the same
      // way the on-screen command console works. mpv command never
      // fails silently — if we get an error it'll surface in the catch.
      // sub-visibility is now set PER-PATH below (yes for embedded, no
      // for addon) — addon uses an HTML overlay and mpv must be muted.
      if (key === 'off') {
        setAddonSubCues(null);
        setOverlayCueText('');
        try {
          await desktop.mpv.command('set', 'sid', 'no');
        } catch (e) {
          console.error('[player] sid=no failed', e);
        }
        notifyInfo('Subtitles', 'Subtitles off');
        return;
      }
      if (key.startsWith('embedded:')) {
        // Picking an embedded sub clears any HTML overlay so the two
        // renderers don't double up. Re-enable mpv sub rendering
        // (the addon path turns it off).
        setAddonSubCues(null);
        setOverlayCueText('');
        try {
          await desktop.mpv.command('set', 'sub-visibility', 'yes');
        } catch (e) {
          console.error('[player] sub-visibility=yes for embedded failed', e);
        }
        const id = Number.parseInt(key.slice('embedded:'.length), 10);
        if (Number.isFinite(id)) {
          try {
            await desktop.mpv.command('set', 'sid', String(id));
          } catch (e) {
            console.error('[player] sid embedded set failed', id, e);
          }
        }
        // Toast: "English - Embedded subtitles loaded" (Stremio-style).
        // Look up the picked track to get its language; fall back to
        // Unknown if the track-list hasn't populated yet (shouldn't
        // happen since the picker only shows tracks mpv reported).
        const track = tracks.find((t) => t.kind === 'sub' && t.id === id);
        const lang = subtitleLangLabel(track?.lang ?? 'unknown');
        notifyInfo('Subtitles loaded', `${lang} - Embedded`);
        return;
      }
      if (key.startsWith('addon:')) {
        const addonKey = key.slice('addon:'.length);
        const sub = addonSubs.find((s) => s.key === addonKey);
        if (!sub) {
          console.warn('[player] addon sub not found for key', addonKey);
          return;
        }
        // CRITICAL: hide mpv's embedded sub BEFORE setting our HTML
        // overlay cues, so there's never a frame where both render.
        // Two-step: sub-visibility=no kills mpv-side rendering
        // unconditionally (even if `set sid no` races or fails), then
        // also clear the track so it doesn't get re-shown later.
        try {
          await desktop.mpv.command('set', 'sub-visibility', 'no');
        } catch (e) {
          console.error('[player] sub-visibility=no for addon failed', e);
        }
        try {
          await desktop.mpv.command('set', 'sid', 'no');
        } catch (e) {
          console.error('[player] sid=no for addon failed', e);
        }
        try {
          // Route through the local streaming server's /subtitles.vtt
          // proxy (via /addon-proxy so we stay same-origin), exactly
          // like Stremio's stremio-video/withStreamingServer does. The
          // proxy:
          //   • detects + normalizes text encoding to UTF-8 (Latin-1,
          //     Windows-1251, etc. — OpenSubtitles serves a lot of
          //     non-UTF-8 SRTs)
          //   • converts SRT/SSA/ASS → VTT so the cue parser sees a
          //     consistent format with well-defined timestamps
          // Fall back to a direct fetch through /addon-proxy on
          // failure — the SRT is still usable for English/UTF-8.
          const streamingProxy =
            `${STREAMING_SERVER_URL}/subtitles.vtt?from=${encodeURIComponent(sub.url)}`;
          const proxiedSubUrl = `/addon-proxy?url=${encodeURIComponent(streamingProxy)}`;
          const fallbackUrl = `/addon-proxy?url=${encodeURIComponent(sub.url)}`;
          let resp = await fetch(proxiedSubUrl).catch(() => null);
          if (!resp || !resp.ok) {
            resp = await fetch(fallbackUrl);
          }
          if (!resp.ok) {
            console.error('[player] addon sub fetch failed', resp.status, sub.url);
            setAddonSubCues([]);
            return;
          }
          const text = await resp.text();
          const cues = parseSrtOrVtt(text);
          if (cues.length === 0) {
            console.warn('[player] addon sub parsed to 0 cues', sub.url);
          }
          setAddonSubCues(cues);
          // Toast format matches Stremio: "English - OpenSubtitles
          // subtitles loaded". The origin is the addon's manifest name
          // (carried through addonSubs.origin from the fetch step).
          const lang = subtitleLangLabel(sub.lang);
          notifyInfo('Subtitles loaded', `${lang} - ${sub.origin}`);
        } catch (e) {
          console.error('[player] addon sub fetch/parse error', sub.url, e);
          setAddonSubCues([]);
        }
      }
    },
    [addonSubs, tracks],
  );

  // Languages available in the combined subtitle pool (embedded + addon).
  // Deduplicated by CANONICAL label so "eng" (embedded ISO-639-2) and
  // "english" (addon long name) collapse into one row. Embedded comes
  // first so the "IN VIDEO" tag wins display priority. The raw lang
  // string of the first occurrence is preserved as the row's value —
  // variantsForLanguage uses languageMatch to collect every track that
  // maps to the same canonical, regardless of code variation.
  const combinedSubLanguages = useMemo(() => {
    const seenCanon = new Set<string>();
    const out: string[] = [];
    const allLangs: string[] = [
      ...tracks
        .filter((t) => t.kind === 'sub')
        .map((t) => (t.lang ?? 'unknown').trim().toLowerCase()),
      ...addonSubs.map((t) => t.lang.trim().toLowerCase()),
    ];
    for (const lang of allLangs) {
      if (!lang) continue;
      const canon = subtitleLangLabel(lang);
      if (!seenCanon.has(canon)) {
        seenCanon.add(canon);
        out.push(lang);
      }
    }
    return out;
  }, [tracks, addonSubs]);

  // Canonical language of the subtitle track that is ACTUALLY active,
  // derived from `selectedSubKey`. The picker highlights the language row
  // that matches this — NOT `selectedSubLang`, which is only the
  // browse/drill cursor. The two diverge when the playing track isn't the
  // preselected language (e.g. the preferred language has no loadable
  // variant so mpv falls back to an embedded track in another language);
  // the highlight must follow what's on screen, not the preselect guess.
  const activeSubLang = useMemo<string | null>(() => {
    if (selectedSubKey === 'off') return null;
    if (selectedSubKey.startsWith('embedded:')) {
      const id = Number.parseInt(selectedSubKey.slice('embedded:'.length), 10);
      if (!Number.isFinite(id)) return null;
      return tracks.find((t) => t.kind === 'sub' && t.id === id)?.lang ?? null;
    }
    if (selectedSubKey.startsWith('addon:')) {
      const k = selectedSubKey.slice('addon:'.length);
      return addonSubs.find((s) => s.key === k)?.lang ?? null;
    }
    return null;
  }, [selectedSubKey, tracks, addonSubs]);

  // Per-canonical-lang variant count (embedded + addon). Used by the
  // SettingsPanel to display "N VARIANTS" next to each language row.
  const variantCountByLang = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tracks) {
      if (t.kind !== 'sub') continue;
      const canon = subtitleLangLabel((t.lang ?? 'unknown').trim().toLowerCase());
      counts[canon] = (counts[canon] ?? 0) + 1;
    }
    for (const t of addonSubs) {
      const canon = subtitleLangLabel(t.lang.trim().toLowerCase());
      counts[canon] = (counts[canon] ?? 0) + 1;
    }
    return counts;
  }, [tracks, addonSubs]);

  // Variants (both embedded and addon) for the selected language.
  // Default the language pick to the user's preferred sub language (or
  // English) once subtitles have been gathered. Doesn't auto-load — the
  // user still has to click a variant — but seeds the Languages column
  // so it's not empty on first open. Placed AFTER combinedSubLanguages
  // is declared (it's a useMemo above) to avoid a TDZ ReferenceError at
  // render time.
  // Snap-to-preference latch — reset on URL change (new file) and on
  // preference change (user edited the setting while watching). After
  // either trigger the effect snaps the picker once; after that, the
  // user is free to click any other language without being yanked back.
  const lastPrefSnapRef = useRef<string | null>(null);
  useEffect(() => {
    if (combinedSubLanguages.length === 0) return;
    const pref = props.playerSettings.subtitlesLanguage?.toLowerCase() ?? null;
    const prefKey = pref ?? '__none__';
    // Skip if we've already snapped for the current pref value. User
    // clicks in the language list don't re-trigger this because the
    // ref captures the most-recent preference; only `props.url`
    // or `subtitlesLanguage` changes reset it (below).
    if (lastPrefSnapRef.current === prefKey) return;

    if (pref) {
      const prefMatch = combinedSubLanguages.find((l) => languageMatch(pref, l));
      if (prefMatch) {
        if (prefMatch !== selectedSubLang) setSelectedSubLang(prefMatch);
        lastPrefSnapRef.current = prefKey;
        return;
      }
    }
    // No preference / no match — fall back ONCE if nothing is selected.
    if (selectedSubLang) {
      lastPrefSnapRef.current = prefKey;
      return;
    }
    const fallback =
      combinedSubLanguages.find((l) => /^(en|eng|english)$/.test(l)) ??
      combinedSubLanguages[0];
    if (fallback) setSelectedSubLang(fallback);
    lastPrefSnapRef.current = prefKey;
  }, [combinedSubLanguages, selectedSubLang, props.playerSettings.subtitlesLanguage]);

  // Reset the preselect latch when URL changes — new file gets a fresh
  // preselect pass.
  useEffect(() => {
    lastPrefSnapRef.current = null;
  }, [props.url]);

  // Tracks the last preferred-language value we successfully
  // auto-loaded for. Comparing the current preference against this ref
  // makes the auto-load fire EVERY time the preference changes, not
  // just once per file. Reset on URL change (new file = re-evaluate).
  const lastAppliedPrefRef = useRef<string | null>(null);
  useEffect(() => {
    lastAppliedPrefRef.current = null;
  }, [props.url]);

  const variantsForLanguage = useMemo(() => {
    if (!selectedSubLang) return [] as Array<{
      key: string;
      label: string;
      origin: string;
      embedded: boolean;
    }>;
    // Match every track whose canonical language label is the same as
    // the picked language's canonical. `eng`, `en`, `english` all share
    // canonical "English" — they should ALL show as variants under the
    // single "English" row.
    const targetCanon = subtitleLangLabel(selectedSubLang);
    const sameCanon = (lang: string | null | undefined) =>
      Boolean(lang) && subtitleLangLabel(lang as string) === targetCanon;
    const embeddedVariants = tracks
      .filter((t) => t.kind === 'sub' && sameCanon(t.lang ?? 'unknown'))
      .map((t) => ({
        key: `embedded:${t.id}`,
        label: t.title ?? t.codec ?? `Track ${t.id}`,
        origin: 'In video',
        embedded: true,
      }));
    const addonVariants = addonSubs
      .filter((t) => sameCanon(t.lang))
      .slice()
      .sort((a, b) => scoreSubtitleTrack(b) - scoreSubtitleTrack(a))
      .map((t) => ({
        key: `addon:${t.key}`,
        label: t.label,
        origin: t.origin,
        embedded: false,
      }));
    return [...embeddedVariants, ...addonVariants];
  }, [selectedSubLang, tracks, addonSubs]);

  // Helper for the Languages-column click handler: computes the first
  // variant (same priority order as variantsForLanguage — embedded
  // first, then highest-scored addon) for an arbitrary lang without
  // having to round-trip through setSelectedSubLang + recomputed memo.
  // Lets us auto-apply on manual language pick the same way the
  // auto-pick effect does on file load.
  // (firstVariantKeyForLanguage removed -- the unified SettingsPanel
  // drills into language variants directly and doesn't need the helper.)

  // Auto-load the user's preferred subtitle language. Fires when:
  //   - mpv has finished loading the file (FileLoaded event), AND
  //   - the preference changes from the last applied value, AND
  //   - there's a matching variant available.
  // The lastAppliedPrefRef comparison means switching the language in
  // profile settings while the player is open triggers a re-load.
  // Auto-loading also overrides any prior auto-selected sub for the
  // old preference — but does NOT touch manual picks made by the user
  // in the same language (they'd already match the pref).
  useEffect(() => {
    if (!fileLoadedReady) return;
    const pref = props.playerSettings.subtitlesLanguage?.toLowerCase() ?? '';
    if (!pref) return;
    if (lastAppliedPrefRef.current === pref) return;
    if (!selectedSubLang) return;
    if (!languageMatch(pref, selectedSubLang)) return;
    if (variantsForLanguage.length === 0) return;
    const best = variantsForLanguage[0];
    lastAppliedPrefRef.current = pref;
    void applySubtitleSelection(best.key)
      .catch((e) => console.error('[player][auto-sub] failed for', best.key, e));
  }, [
    fileLoadedReady,
    selectedSubLang,
    variantsForLanguage,
    props.playerSettings.subtitlesLanguage,
    applySubtitleSelection,
  ]);

  // Update subtitle size live + persist. The size setting only
  // affects the HTML overlay used for addon subtitles; embedded
  // (mpv-rendered) subs are pinned to 16 px in the main styling
  // effect regardless of this value, so we don't push any mpv
  // commands here — that would briefly resize embedded subs to
  // `px` before the styling effect re-runs and snaps them back to
  // 16, causing a visible flicker.
  const applySubtitleSize = useCallback(
    (px: number) => {
      setSubtitleSizePx(px);
      try {
        writeStoredPlayerSettings({ ...props.playerSettings, subtitlesSizePx: px });
      } catch {
        // ignore — localStorage may be full / disabled
      }
    },
    [props.playerSettings],
  );

  // While dragging the seek bar, hold the value locally; only commit an
  // absolute seek on release so we avoid pelting mpv with intermediate
  // targets that all turn into wasted piece-fetches on torrent streams.
  const onScrubInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const target = Number(e.target.value);
    if (Number.isFinite(target)) setScrubValue(target);
  }, []);

  // Show the buffering veil immediately when the user initiates a seek
  // and re-arm the time-pos "initial" reference so the veil only drops
  // once the new playback head actually advances. Without this, fast
  // seeks on a cold torrent looked like a frozen black screen — mpv
  // wasn't always flipping `paused-for-cache` long enough for the 400 ms
  // debounce to fire. Skip while paused: the user is in scrub-preview
  // mode and just wants to see the frame at the new position.
  const markSeekStart = useCallback(() => {
    if (paused) return;
    initialSeekRef.current = null;
    playbackStartedRef.current = false;
    setBuffering(true);
  }, [paused]);

  // Two-part scrub handling. (1) Rapid clicks on torrent streams
  // thrashed the streaming server — each new `seek absolute+exact`
  // cancels mpv's in-flight piece fetch and after a few of those
  // mpv fell back to the last buffered position. Leading + trailing
  // debounce here: the first click in a quiet period fires
  // immediately (no added latency for normal seeking), follow-up
  // clicks within ~2 s collapse into one trailing-edge seek to the
  // LATEST target after 250 ms of inactivity.
  //
  // (2) Visual flicker: `commitScrub` used to `setScrubValue(null)`
  // immediately. With the value cleared, ScrubBar reverts to
  // showing `livePos`, which is mpv's OLD time-pos until the seek
  // actually lands. The slider visibly snapped to the target,
  // rebounded to the old position, then caught up — looked like
  // "seek didn't go". Now we KEEP `scrubValue` pegged to the commit
  // target until either (a) mpv's time-pos reports a value within
  // 1.5 s of it, or (b) a 5 s safety timeout fires. The auto-clear
  // lives in a separate effect below.
  const scrubDebounceTimerRef = useRef<number | null>(null);
  const lastScrubFireRef = useRef(0);
  const commitScrub = useCallback(() => {
    setScrubValue((current) => {
      if (current == null) return null;
      markSeekStart();
      setTimePos(current);
      desktop
        .log(
          `[seek][scrub] commit target=${current.toFixed(3)}s ` +
            `(timePos before=${timePosRef.current.toFixed(3)}s, duration=${durationRef.current.toFixed(3)}s)`,
        )
        .catch(() => {});

      const now = Date.now();
      const sinceLastFire = now - lastScrubFireRef.current;
      if (scrubDebounceTimerRef.current != null) {
        window.clearTimeout(scrubDebounceTimerRef.current);
        scrubDebounceTimerRef.current = null;
      }
      if (sinceLastFire > 2000) {
        lastScrubFireRef.current = now;
        desktop.seek(current, 'absolute').catch(() => {});
        watchParty.broadcastSeek(current);
      } else {
        scrubDebounceTimerRef.current = window.setTimeout(() => {
          lastScrubFireRef.current = Date.now();
          scrubDebounceTimerRef.current = null;
          desktop
            .log(`[seek][scrub] debounced fire target=${current.toFixed(3)}s`)
            .catch(() => {});
          desktop.seek(current, 'absolute').catch(() => {});
          watchParty.broadcastSeek(current);
        }, 250);
      }
      // Hold the slider at the commit target — the clear-when-mpv-
      // catches-up effect releases it.
      return current;
    });
  }, [markSeekStart, watchParty]);

  // Clear the held `scrubValue` once mpv's LIVE clock reaches the
  // target (within 1.5 s — absorbs the inevitable keyframe-snap of
  // a few hundred ms on long-GOP encodes).
  //
  // Subscribes directly to `playbackClock` rather than depending on
  // the React `timePos` state because `commitScrub` also calls
  // `setTimePos(current)` for optimistic up-next-overlay timing —
  // that pre-set would immediately fire a timePos-based clear,
  // dropping the hold the instant scrubValue was set and the
  // ScrubBar would fall back to displaying `livePos` (mpv's old,
  // pre-seek position) until mpv actually catches up. Visible as
  // "I clicked 50, landed at 38, then jumped to 50, flicker."
  //
  // Safety timeout at 5 s in case the seek hangs or mpv never gets
  // close (e.g., seek lands within the EOF clamp).
  useEffect(() => {
    if (scrubValue == null) return;
    const target = scrubValue;
    const checkAndClear = () => {
      if (Math.abs(playbackClock.get() - target) < 1.5) {
        setScrubValue(null);
      }
    };
    checkAndClear();
    const unsub = playbackClock.subscribe(checkAndClear);
    const safety = window.setTimeout(() => setScrubValue(null), 5000);
    return () => {
      unsub();
      window.clearTimeout(safety);
    };
  }, [scrubValue]);

  const onScrubKey = useCallback((e: React.KeyboardEvent) => {
    // Arrow keys jump by the user-configured seek duration. Default
    // 10s — was previously hardcoded to ±5s, which silently ignored
    // the player-settings value and made the "seek duration" slider
    // a no-op.
    //
    // preventDefault is critical: without it, the browser's native
    // <input type="range"> ArrowLeft/Right handling ALSO fires,
    // advancing the slider by `step` and triggering onChange. That
    // populates scrubValue, and our onKeyUp's commitScrub then issues
    // a SECOND seek (absolute → scrubValue) on top of the relative
    // seek we did here, producing the "moved 10s, buffered, moved
    // 10s more" double-seek behavior.
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const seekSec = Math.max(1, Math.round(props.playerSettings.seekTimeDurationMs / 1000));
    if (e.key === 'ArrowLeft') {
      markSeekStart();
      desktop.seek(-seekSec).catch(() => {});
      watchParty.broadcastSeek(Math.max(0, playbackClock.get() - seekSec));
    } else {
      markSeekStart();
      desktop.seek(seekSec).catch(() => {});
      watchParty.broadcastSeek(playbackClock.get() + seekSec);
    }
  }, [markSeekStart, props.playerSettings.seekTimeDurationMs, watchParty]);

  // Keyboard shortcuts: space=pause, ArrowLeft/Right=seek, F=fullscreen.
  useEffect(() => {
    const seekSec = Math.max(
      1,
      Math.round(props.playerSettings.seekTimeDurationMs / 1000),
    );
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
        showControls();
      } else if (e.code === 'ArrowLeft') {
        markSeekStart();
        desktop.seek(-seekSec).catch(() => {});
        watchParty.broadcastSeek(Math.max(0, playbackClock.get() - seekSec));
        showControls();
      } else if (e.code === 'ArrowRight') {
        markSeekStart();
        desktop.seek(seekSec).catch(() => {});
        watchParty.broadcastSeek(playbackClock.get() + seekSec);
        showControls();
      } else if (e.code === 'KeyF') {
        desktop.toggleFullscreen().catch(() => {});
      } else if (e.code === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, showControls, onBack, markSeekStart, props.playerSettings.seekTimeDurationMs, watchParty]);

  // Prefer the clean movie/episode name from meta over the verbose
  // stream title (which embeds resolution + seeders + size like
  // "Marty Supreme 2025 2160p WEBRip 100 6.68 GB"). The stream title
  // is still useful elsewhere (Continue Watching prompts), but the
  // back-button pill should just say what you're watching.
  const headerPrimary = props.metaTitle ?? props.title ?? 'Playing';
  // Don't show controls until the movie has loaded (duration > 0).
  // During initial buffering the scrub bar shows --:-- and the
  // auto-hide timer causes rapid flash cycling.
  const controlsOpacity = controlsVisible ? 'opacity-100' : 'opacity-0';

  // Map props.videos to the PauseOverlayVideo shape for the enriched
  // pause overlay (season/episode/title/description/rating per episode).
  const pauseOverlayVideos = useMemo((): PauseOverlayVideo[] => {
    if (!props.videos?.length) return [];
    return props.videos.map((v) => ({
      id: v.id,
      title: v.title ?? null,
      season: v.season ?? null,
      episode: v.episode ?? null,
      thumbnail: v.thumbnail ?? null,
      released: v.released ?? null,
      description: v.overview ?? v.description ?? null,
      rating: v.rating != null ? String(v.rating) : null,
    }));
  }, [props.videos]);

  // Map props.videos to the EpisodeVideo shape for the episodes drawer.
  // Cinemeta uses `name` for episode titles; some addons use `title`.
  const drawerEpisodes = useMemo((): EpisodeVideo[] => {
    if (!props.videos?.length) return [];
    return props.videos.map((v: Record<string, unknown>) => ({
      id: String(v.id ?? ''),
      title: ((v.title ?? v.name ?? null) as string | null),
      season: typeof v.season === 'number' ? v.season : null,
      episode: typeof v.episode === 'number' ? v.episode : null,
      thumbnail: (v.thumbnail ?? null) as string | null,
      released: (v.released ?? null) as string | null,
      description: ((v.overview ?? v.description ?? null) as string | null),
      rating: v.rating != null ? String(v.rating) : null,
    }));
  }, [props.videos]);

  // Skip Intro / Recap / Credits detection driven by mpv chapter
  // markers. Returns null when the current chapter doesn't match any
  // of the intro/recap/outro regexes, or when the file has no
  // chapters — in which case `<SkipChapterButton>` renders nothing.
  const chapterSkip = useChapterSkip(duration);
  // Fallback for files WITHOUT mpv chapter markers: external skip
  // segments — AniSkip (anime OP/ED) then TheIntroDB (live-action TV +
  // film, and anime backfill). Chapter markers take precedence; this only
  // fills the gap when `chapterSkip` is null.
  const segmentSkip = useSkipSegments({
    id: props.id,
    videoId: props.videoId,
    duration,
    currentTime: timePos,
  });
  const skip = chapterSkip ?? segmentSkip;

  // (Audio-track button gating removed -- the unified SettingsPanel
  // shows/hides the audio tab based on track count internally.)

  // mpv volume runs 0-200 (we set volume-max=200 in the shell init), so
  // the slider maps 0-2 with 1.0 = unity gain (no amplification). Above
  // 100 mpv applies software amplification — necessary for tracks that
  // were mastered quiet.
  const volume01 = muted ? 0 : Math.max(0, Math.min(2, volume / 100));
  const volumeIcon =
    muted || volume === 0
      ? 'volume-mute'
      : volume < 30
        ? 'volume-low'
        : volume < 70
          ? 'volume-medium'
          : 'volume-high';

  // Whether mpv has produced at least one decoded frame. While false we
  // need an opaque dark backdrop because WebView2's canvas is white by
  // default and mpv hasn't yet painted into the parent HWND — without the
  // backdrop the player page flashes a big white middle area during cold
  // load. Once timePos starts advancing, mpv is rendering and we drop the
  // backdrop so the video shows through.
  const hasVideo = timePos > 0;

  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        background: hasVideo ? 'transparent' : '#000',
        cursor: controlsVisible ? 'default' : 'none',
      }}
      onMouseMove={showControls}
      onMouseDown={showControls}
      onMouseLeave={hideControlsNow}
      onClick={(e) => {
        if (e.target === e.currentTarget) togglePlay();
      }}
    >
      {/* Top overlay -- back button + HDR/4K/RD badges. Slides in/out
          from the top, matching OpenCode's BlissfulPlayer TopOverlay. */}
      <TopOverlay
        showControls={controlsVisible}
        headerPrimary={headerPrimary}
        onBack={onBack}
        videoGamma={videoGamma}
        videoDwidth={videoDwidth}
        streamTitle={props.title ?? null}
        streamUrl={props.url ?? null}
        error={error}
        rightSlot={watchPartySlot}
      />

      <BufferingOverlay visible={buffering} logo={props.logo} />

      {/* Pause overlay -- cinematic metadata card when paused. Shows
          title/logo + runtime info in the bottom-left. */}
      <PauseOverlay
        isPlaying={!paused}
        hasPlayedOnce={hasVideo}
        metaTitle={props.metaTitle ?? null}
        title={props.title ?? null}
        description={props.description ?? null}
        logo={props.logo}
        type={props.type}
        videoId={props.videoId}
        videos={pauseOverlayVideos}
        imdbId={props.id.startsWith('tt') ? props.id : null}
        imdbRating={props.imdbRating ?? null}
        duration={duration}
        releaseInfo={props.releaseInfo ?? null}
      />

      {/* Up-next overlay -- auto-advance card with thumbnail, countdown
          bar, and Play Now / Cancel buttons. */}
      <UpNextOverlay
        visible={showUpNext}
        nextEpisodeInfo={props.nextEpisodeInfo}
        countdown={upNextCountdown}
        playerSettings={props.playerSettings}
        onCancel={cancelUpNext}
        onAdvance={advanceToNextEpisode}
        controlsOpacity={controlsOpacity}
      />

      {/* Unified settings panel -- slides in from the right. Audio
          tracks + subtitle picker + appearance customization. */}
      <SettingsPanel
        open={settingsPanelOpen}
        onClose={() => setSettingsPanelOpen(false)}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        tracks={tracks}
        audioId={audioId}
        selectAudio={selectAudio}
        selectedSubKey={selectedSubKey}
        selectedSubLang={selectedSubLang}
        activeSubLang={activeSubLang}
        setSelectedSubLang={setSelectedSubLang}
        combinedSubLanguages={combinedSubLanguages}
        variantsForLanguage={variantsForLanguage}
        variantCountByLang={variantCountByLang}
        applySubtitleSelection={applySubtitleSelection}
        subtitleSizePx={subtitleSizePx}
        onSubtitleSizePxChange={applySubtitleSize}
        subtitleColor={subtitleColor}
        onSubtitleColorChange={(c) => updateColor('text', c, 1)}
        subtitleDelay={subtitleDelay}
        onSubtitleDelayChange={setSubtitleDelay}
        playerSettings={props.playerSettings}
      />

      {/* Episodes drawer -- slides in from the right. Lists episodes
          for the current season; clicking switches playback. */}
      <EpisodesDrawer
        open={episodesOpen}
        onClose={() => setEpisodesOpen(false)}
        type={props.type}
        videos={drawerEpisodes}
        videoId={props.videoId}
        background={props.background ?? null}
        poster={props.poster ?? null}
        seriesSeasons={seriesSeasons}
        episodesSeason={episodesSeason}
        setEpisodesSeason={setEpisodesSeason}
        currentSeasonInfo={currentSeasonInfo}
        episodesSearch={episodesSearch}
        setEpisodesSearch={setEpisodesSearch}
        autoNext={autoNext}
        setAutoNext={setAutoNext}
        episodesListRef={episodesListRef}
        currentEpisodeCardRef={currentEpisodeCardRef}
        handleEpisodesScroll={handleEpisodesScroll}
        lockEpisodesScroll={lockEpisodesScroll}
        episodesFocusIndex={episodesFocusIndex}
        setEpisodesFocusIndex={setEpisodesFocusIndex}
        episodesCountRef={episodesCountRef}
        episodesCurrentIndexRef={episodesCurrentIndexRef}
        progressLookupId={props.id}
        progressLookupType={props.type}
        onSelectEpisode={onSelectEpisode}
      />

      {/* Watch party drawer -- slides in from the right. Fully wired
          to the mpv-adapted watch party hook. */}
      <WatchPartyDrawer
        open={watchPartyOpen}
        onClose={() => setWatchPartyOpen(false)}
        tab={watchPartyTab}
        onTabChange={setWatchPartyTab}
        roomCode={props.roomCode ?? null}
        connected={watchParty.connected}
        selfUserId={watchParty.selfUserId}
        hostUserId={watchParty.hostUserId}
        participants={watchParty.participants}
        chat={watchParty.chat}
        sendChat={watchParty.sendChat}
        sendTyping={watchParty.sendTyping}
        typingNames={watchParty.typingNames}
        activity={watchParty.activity}
        reactions={watchParty.reactions}
        toggleReaction={watchParty.toggleReaction}
        activeRoomTab={watchPartyActiveTab}
        onActiveRoomTabChange={setWatchPartyActiveTab}
        hasPassword={roomInfo?.hasPassword ?? false}
        error={watchParty.error}
        onLeave={handleLeaveParty}
        onTransferHost={watchParty.transferHost}
        canCreate={!!props.authKey && !!props.type && !!props.id}
        creatingRoom={creatingRoom}
        onCreateRoom={createParty}
        onNavigateToRoom={handleNavigateToRoom}
      />

      {/* Watch party activity toast -- surfaces join/leave/seek events. */}
      {watchParty.connected ? (
        <WatchPartyActivityToast
          activity={watchParty.activity}
          chat={watchParty.chat}
          selfUserId={watchParty.selfUserId}
        />
      ) : null}

      {/* Watch party name prompt -- shown when user has no display name. */}
      {showNamePrompt ? (
        <WatchPartyNamePrompt
          onSubmit={handleNameSubmit}
          onCancel={handleNameCancel}
        />
      ) : null}

      {/* Watch party password prompt -- shown when room needs a password. */}
      {showPasswordPrompt && !showNamePrompt ? (
        <WatchPartyPasswordPrompt
          roomCode={props.roomCode!}
          onSubmit={handlePasswordSubmit}
          onCancel={handlePasswordCancel}
        />
      ) : null}

      {/* ChromePicker popover -- positioned next to whichever color
          button opened it. Updates colors live via updateColor. */}
      {colorModal && activeColor && colorPopoverPos ? (
        <div
          className="fixed z-[50] rounded-2xl border border-white/10 bg-black/80 p-4 text-white backdrop-blur"
          style={{ top: colorPopoverPos.top, left: colorPopoverPos.left, width: 272 }}
        >
          <div className="mb-3 text-sm font-semibold">Pick color</div>
          <div className="flex justify-center">
            <ChromePicker
              color={{
                ...hexToRgb(activeColor.hex),
                a: activeColor.alpha,
              }}
              onChange={(color: ColorResult) =>
                updateColor(colorModal, color.hex, color.rgb.a ?? 1)
              }
              disableAlpha={false}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="rounded-full bg-white/10 px-4 py-2 text-xs text-white"
              onClick={() => {
                setColorModal(null);
                setColorPopoverPos(null);
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {/* HTML subtitle overlay (Stremio architecture: addon subs are
          rendered here, not via mpv sub-add). */}
      {overlayCueText ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-[25] flex justify-center px-4 text-center"
          style={{
            bottom: `calc(${Math.max(0, 22 - Math.min(0, subtitleVerticalPercent))}px + ${Math.max(0, 12 + subtitleVerticalPercent)}vh)`,
          }}
        >
          <div
            className="max-w-[90vw] whitespace-pre-line"
            style={{
              color: subtitleColor,
              backgroundColor:
                subtitleBgParsed.alpha === 0 ? 'transparent' : subtitleBackgroundColor,
              fontSize: `${subtitleSizePx}px`,
              fontWeight: 600,
              padding: subtitleBgParsed.alpha === 0 ? '0' : '2px 8px',
              borderRadius: subtitleBgParsed.alpha === 0 ? '0' : '4px',
              lineHeight: 1.3,
              textShadow:
                subtitleOutlineParsed.alpha === 0
                  ? 'none'
                  : `0 0 2px ${subtitleOutlineColor},
                     0 0 4px ${subtitleOutlineColor},
                     1px 1px 2px ${subtitleOutlineColor},
                     -1px -1px 2px ${subtitleOutlineColor},
                     1px -1px 2px ${subtitleOutlineColor},
                     -1px 1px 2px ${subtitleOutlineColor}`,
            }}
          >
            {overlayCueText}
          </div>
        </div>
      ) : null}

      {/* Skip Intro / Recap / Credits -- floats bottom-right above the
          controls strip. */}
      {skip ? (
        <SkipChapterButton
          kind={skip.kind}
          label={skip.label}
          onSkip={skip.onSkip}
        />
      ) : null}

      {/* Bottom controls -- scrub bar + transport strip. Slides in/out
          from the bottom, matching OpenCode's BlissfulPlayer layout. */}
      <BottomControls
        showControls={controlsVisible}
        instantHideControls={instantHideControls}
        scrubValue={scrubValue}
        duration={duration}
        onScrubInput={onScrubInput}
        commitScrub={commitScrub}
        onScrubKey={onScrubKey}
        paused={paused}
        togglePlay={togglePlay}
        muted={muted}
        toggleMute={toggleMute}
        volume01={volume01}
        volumeIcon={volumeIcon as StremioIconName}
        onVolumeChange={onVolumeChange}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        nextEpisodeInfo={props.nextEpisodeInfo}
        advanceToNextEpisode={advanceToNextEpisode}
        openSettings={openSettings}
        isSeriesLike={props.type === 'series'}
        toggleEpisodes={toggleEpisodes}
      />
    </div>
  );
}
