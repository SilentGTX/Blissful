import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import Hls from 'hls.js';
// HeroUI overlays are handled by the caller on iOS.
import type { AddonDescriptor } from '../../lib/mediaTypes';
import type { PlayerSettings } from '../../lib/playerSettings';
import { writeStoredPlayerSettings } from '../../lib/playerSettings';
import type { NextEpisodeInfo } from '../../pages/PlayerPage';
import { usePlayerReady } from '../../context/PlayerReadyProvider';
import { useActiveParties } from '../../context/ActivePartiesProvider';
import { fetchSubtitles, fetchOpenSubHash } from '../../lib/stremioAddon';
import { getDocPiP } from '../../lib/documentPip';
import { DEFAULT_SERVER_ID } from '../../lib/playerServers';
import { useChapterSkipWeb, hasClassifiableChapter, type Chapter } from '../useChapterSkipWeb';
import { SkipChapterButton } from './SkipChapterButton';
import { getProgress, setProgress, flushNow } from '../../lib/progressStore';
import { updateBlissfulLibraryProgress } from '../../lib/blissfulAuthApi';
import { isStremioLinked, syncStremioItem, triggerStremioItemSync } from '../../lib/stremioLinkApi';
import { clearCurrentActivity, setCurrentActivity } from '../../lib/usePresenceHeartbeat';
import { getLastStreamSelection, setLastStreamSelection } from '../../lib/streamHistory';
import {
  clamp,
  isHttpUrl,
  isIos,
  parseTitleLines,
  playerLog,
  shortenTitle,
} from '../../lib/playerEnv';
import {
  getNativeAudioTracks,
  getSelectedNativeAudioTrackId,
} from '../../lib/playerAudioTracks';
import type {
  HlsAudioTrack,
  NativeAudioTrackList,
} from '../../lib/playerAudioTracks';
import { notifyError, notifyInfo, notifySuccess } from '../../lib/toastQueues';
import { useStorage } from '../../context/StorageProvider';
import { PauseOverlay } from './PauseOverlay';
import { UpNextOverlay } from './UpNextOverlay';
import { SettingsPanel, type SettingsTab, type ReleaseOption, type TranscodeAudioTrack } from './SettingsPanel';
import { BottomControls } from './BottomControls';
import { EpisodesDrawer, type EpisodeVideo as EpisodesDrawerVideo } from './EpisodesDrawer';
import { ResumeOrStartOverModal } from '../ResumeOrStartOverModal';
import { UnreleasedEpisodeModal } from '../UnreleasedEpisodeModal';
import { fetchFallbackReleases } from '../../lib/fallbackReleases';
import { BufferingOverlay } from './BufferingOverlay';
import { TopOverlay } from './TopOverlay';
import {
  WatchPartyActivityToast,
  WatchPartyButton,
  WatchPartyDrawer,
  WatchPartyNamePrompt,
  WatchPartyPasswordPrompt,
} from '../WatchParty';
import type { WatchPartyDrawerTab } from '../WatchParty/WatchPartyDrawer';
import { useWatchParty } from '../../lib/useWatchParty';
import {
  buildRoomPlayerUrl,
  createWatchPartyRoom,
  getOrCreateGuestUserId,
  getStoredGuestName,
  getWatchPartyPassword,
  getWatchPartyRoomStatus,
  setStoredGuestName,
  stashWatchPartyPassword,
  clearWatchPartyPassword,
  type WatchPartySource,
} from '../../lib/watchParty';
import { resolveSourceForWeb, webPlayingToSource } from '../../lib/watchPartySource';
import { StremioIcon } from '../PlayerControlIcons';

import {
  type SubtitleTrack,
  fetchSubtitleVttBlobUrl,
  scheduleRevokeSubtitleBlobUrl,
  applySubtitleLayout,
  applySubtitlePositionActive,
  subtitleLangLabel,
  langPriority,
  languageMatch,
  findMatchingLanguage,
  isEmbeddedOrigin,
  scoreSubtitleTrack,
} from '../../lib/subtitleUtils';

export type StremioIconName =
  | 'play'
  | 'pause'
  | 'volume-mute'
  | 'volume-off'
  | 'volume-low'
  | 'volume-medium'
  | 'volume-high'
  | 'subtitles'
  | 'audio-tracks'
  | 'more-horizontal'
  | 'chevron-back'
  | 'maximize'
  | 'minimize'
  | 'settings'
  | 'cloud'
  | 'episodes'
  | 'skip-forward'
  | 'heart'
  | 'heart-filled'
  | 'check'
  | 'x';

type StremioIconPath = { d: string; style: CSSProperties };
type StremioIconDef = { viewBox: string; paths: StremioIconPath[] };

export const STREMIO_ICONS: Record<StremioIconName, StremioIconDef> = {
  play: {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M396.097 246.1 164.194 85.5a13.5 13.5 0 0 0-4.787-2.08c-1.717-.37-3.492-.4-5.219-.07-1.728.3-3.377.97-4.852 1.91a13.4 13.4 0 0 0-3.743 3.64 13.7 13.7 0 0 0-2.4 7.61v321.4a13.3 13.3 0 0 0 1.029 5.1 13.2 13.2 0 0 0 2.909 4.32 13.4 13.4 0 0 0 4.347 2.89c1.624.65 3.363 1 5.116.98 2.723.03 5.382-.82 7.6-2.39l231.903-160.6c1.448-1 2.684-2.28 3.64-3.75a13.4 13.4 0 0 0 1.925-4.85c.316-1.72.287-3.51-.084-5.22a13.2 13.2 0 0 0-2.08-4.78 13.8 13.8 0 0 0-3.401-3.41z',
        style: { fill: 'currentcolor' },
      },
    ],
  },
  pause: {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M182.593 93h-18.4v330.5h18.4zM347.791 93h-18.4v330.5h18.4z',
        style: {
          stroke: 'currentcolor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: '36.719',
          fill: 'none',
        },
      },
    ],
  },
  'volume-mute': {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M423.8 441.5 54.7 72.3',
        style: {
          stroke: 'currentcolor',
          strokeLinecap: 'round',
          strokeMiterlimit: '10',
          strokeWidth: '33.557',
          fill: 'none',
        },
      },
      {
        d: 'M222.4 132v35.41c-.01 1.11.41 2.2 1.2 3l25.2 25.19c.48.49 1.08.85 1.73 1.04.67.2 1.37.23 2.04.11.67-.14 1.31-.43 1.84-.88.53-.44.94-1 1.2-1.64.21-.51.31-1.07.29-1.63v-77.69c.05-4.65-1.16-9.23-3.5-13.25a25.8 25.8 0 0 0-9.8-9.56c-4.2-2.26-8.93-3.28-13.69-2.95-4.73.34-9.3 2.02-13.11 4.85-.2.2-.5.31-.7.51l-33.5 27.39c-.44.35-.8.78-1.06 1.26-.27.5-.43 1.02-.49 1.57-.04.56.01 1.11.16 1.63.16.54.43 1.02.78 1.44l.31.31L199.19 146c.75.73 1.72 1.15 2.74 1.2 1.04.05 2.06-.25 2.86-.89zM222.4 381.8l-81.9-67a33.47 33.47 0 0 0-21.3-7.49H54.6V206.6h53.19a4.27 4.27 0 0 0 2.33-.72c.69-.47 1.22-1.13 1.54-1.89.33-.77.42-1.6.27-2.43-.16-.82-.56-1.57-1.14-2.16L85.6 174.2c-.39-.39-.86-.7-1.39-.91-.51-.21-1.07-.3-1.61-.29H46.2c-6.68.01-13.1 2.67-17.82 7.39a25.25 25.25 0 0 0-7.39 17.81v117.41c.01 6.68 2.67 13.08 7.39 17.81a25.3 25.3 0 0 0 17.82 7.38h73.19l95.81 78.4c.21.2.44.37.7.5 3.86 2.87 8.48 4.56 13.28 4.88 4.81.32 9.6-.75 13.82-3.08 3.97-2.27 7.28-5.56 9.57-9.53 2.29-3.98 3.46-8.48 3.42-13.07v-52.6c.01-1.12-.41-2.2-1.19-3l-25.21-25.2c-.79-.77-1.84-1.2-2.95-1.2-1.09 0-2.15.43-2.95 1.2-.39.39-.7.86-.91 1.38-.21.51-.3 1.07-.28 1.62v60.7zM356.7 256.91c0-25.81-6.11-50.2-18.6-74.7-2.1-3.85-5.62-6.71-9.8-8s-8.7-.9-12.59 1.11c-3.9 1.99-6.86 5.42-8.26 9.56-1.41 4.15-1.13 8.67.74 12.62 10.11 19.71 14.9 39.2 14.9 59.5 0 2.8-.1 5.61-.29 8.5-.09 1.21.07 2.42.49 3.56a8.8 8.8 0 0 0 1.91 3.05l20.6 20.6c.79.76 1.84 1.19 2.95 1.19 1.1 0 2.16-.43 2.95-1.19.59-.56.98-1.31 1.1-2.11 2.59-11.04 3.9-22.34 3.9-33.69M423.8 256.9c0-53.69-13.7-88-35.8-125.9a16.76 16.76 0 0 0-10.23-7.56c-4.25-1.09-8.77-.46-12.58 1.76a16.8 16.8 0 0 0-7.74 10.08A16.73 16.73 0 0 0 359 147.9c19.8 34 31.3 62.7 31.3 109 0 25-3.51 45-9.8 63.6a8.6 8.6 0 0 0-.23 4.64 8.53 8.53 0 0 0 2.23 4.06l17.6 17.61c.79.76 1.84 1.2 2.95 1.2 1.1 0 2.15-.44 2.95-1.2.39-.38.69-.81.9-1.31 10.7-25.8 16.9-52.99 16.9-88.6',
        style: { fill: 'currentcolor' },
      },
      {
        d: 'M490.9 256.91c0-77.91-21.2-127-53-176.8A16.73 16.73 0 0 0 427.37 73c-4.3-.91-8.79-.09-12.49 2.28a16.83 16.83 0 0 0-7.32 10.38c-.99 4.29-.25 8.8 2.04 12.54 28.7 44.9 47.7 89.01 47.7 158.8 0 49.8-9.3 86.1-24.7 118.5-.37.79-.49 1.67-.35 2.52.13.86.54 1.66 1.15 2.28l18.7 18.7c.58.59 1.32 1 2.13 1.16s1.66.09 2.42-.24a4.37 4.37 0 0 0 2.15-2.02c22.5-44.3 32.1-87.5 32.1-140.99',
        style: { fill: 'currentcolor' },
      },
    ],
  },
  'volume-off': {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M236.89 187.01h-72.6c-1.09 0-2.17.21-3.18.63a8.28 8.28 0 0 0-4.49 4.48 8.3 8.3 0 0 0-.63 3.19V312.1c0 1.1.21 2.17.63 3.18a8.2 8.2 0 0 0 1.8 2.69 8.27 8.27 0 0 0 5.87 2.43h72.6a16.46 16.46 0 0 1 10.6 3.8l95.4 78.11a8.4 8.4 0 0 0 6.22 1.49 8.46 8.46 0 0 0 5.49-3.29 8.1 8.1 0 0 0 1.59-5.01V111.6c0-1.09-.21-2.16-.63-3.17a8.2 8.2 0 0 0-1.8-2.7 8.27 8.27 0 0 0-5.87-2.43c-1.76.01-3.47.57-4.9 1.6l-95.4 78.11c-2.95 2.6-6.76 4.03-10.7 4',
        style: {
          stroke: 'currentcolor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: '31.897',
          fill: 'none',
        },
      },
    ],
  },
  'volume-low': {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M186.89 188H114.3c-1.09 0-2.17.21-3.19.64a8.27 8.27 0 0 0-5.11 7.66v116.8c0 1.1.21 2.17.63 3.18a8.2 8.2 0 0 0 1.8 2.69c.77.77 1.68 1.38 2.68 1.8 1.02.42 2.1.63 3.19.63h72.59c3.88-.02 7.64 1.33 10.61 3.8l95.4 78.11a8.4 8.4 0 0 0 6.22 1.49 8.4 8.4 0 0 0 5.48-3.29 8.06 8.06 0 0 0 1.6-5.01V112.6a8.27 8.27 0 0 0-2.43-5.87 8.27 8.27 0 0 0-5.87-2.43c-1.76.01-3.47.57-4.9 1.6l-95.4 78.11c-2.95 2.6-6.76 4.03-10.71 3.99M389.5 321.4a149 149 0 0 0 16.7-66.7c-.08-23.26-5.81-46.15-16.7-66.7',
        style: {
          stroke: 'currentcolor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: '31.897',
          fill: 'none',
        },
      },
    ],
  },
  'volume-medium': {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M152.9 188H80.29c-1.09 0-2.16.21-3.18.64a8.2 8.2 0 0 0-2.69 1.79 7.8 7.8 0 0 0-1.79 2.69 8.3 8.3 0 0 0-.63 3.18v116.8c0 1.1.21 2.17.63 3.18a8 8 0 0 0 1.8 2.69c.77.77 1.67 1.38 2.68 1.8 1.02.42 2.09.63 3.18.63h72.61a16.46 16.46 0 0 1 10.6 3.8l95.4 78.11a8.4 8.4 0 0 0 6.22 1.49 8.37 8.37 0 0 0 5.47-3.29 8 8 0 0 0 1.61-5.01V112.6c0-1.09-.21-2.17-.63-3.18a8.5 8.5 0 0 0-1.8-2.69 8.27 8.27 0 0 0-5.87-2.43c-1.76.01-3.47.57-4.9 1.6l-95.4 78.11a16.6 16.6 0 0 1-10.7 3.99M355.59 321.4a148.86 148.86 0 0 0 16.71-66.7 143.66 143.66 0 0 0-16.71-66.7M405.6 371.51A213.67 213.67 0 0 0 439 254.7c.71-41.39-10.92-82.05-33.4-116.8',
        style: {
          stroke: 'currentcolor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: '31.897',
          fill: 'none',
        },
      },
    ],
  },
  'volume-high': {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M121.89 188.9h-72.6c-1.09 0-2.16.21-3.18.63a8.24 8.24 0 0 0-4.49 4.49c-.41 1.01-.62 2.1-.62 3.18V314c0 1.09.21 2.18.62 3.19a8.1 8.1 0 0 0 1.8 2.69c.78.78 1.68 1.39 2.69 1.8a8.3 8.3 0 0 0 3.18.62h72.6c3.88-.01 7.64 1.32 10.61 3.81l95.39 78.09a8.44 8.44 0 0 0 6.22 1.51c2.19-.35 4.17-1.53 5.48-3.31a7.95 7.95 0 0 0 1.61-4.99v-283.9c0-1.1-.21-2.18-.63-3.19a8.6 8.6 0 0 0-1.8-2.68 8.2 8.2 0 0 0-2.7-1.81c-1-.42-2.09-.62-3.18-.62-1.76 0-3.46.57-4.9 1.6L132.6 184.9a16.57 16.57 0 0 1-10.71 4M324.49 322.3a148.9 148.9 0 0 0 16.71-66.7c-.08-23.25-5.81-46.14-16.71-66.7M374.6 372.4A213.56 213.56 0 0 0 408 255.6c.71-41.39-10.93-82.05-33.4-116.79M421.69 415.6c69.41-88.2 61.41-242.3-1.29-321.3',
        style: {
          stroke: 'currentcolor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: '31.897',
          fill: 'none',
        },
      },
    ],
  },
  subtitles: {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M482.6 216.7V135.39C482.6 103.5 457.1 94.3998 443.8 94.6898H66.7001C48.7001 94.6898 29.6001 105.5 29.6001 133.4V365.79C29.6001 389.69 45.4001 404.4 68.3001 404.4H343.3L374.3 435.4C378.1 439.1 383.3 441.16 388.7 441.16C394.2 441.16 399.4 439.1 403.3 435.4L434.3 404.4H451.7C466.2 404.4 482.7 395.39 482.7 367.69L482.6 216.7ZM449.6 216.7V359.89C449.6 365.7 449.6 371.49 441.9 371.49H422.6L387.6 404.4L354.8 371.49H72.1001C70.8001 371.51 69.6001 371.28 68.4001 370.81C67.2001 370.32 66.1001 369.61 65.2001 368.7C64.3001 367.8 63.6001 366.73 63.1001 365.54C62.6001 364.35 62.4001 363.08 62.4001 361.79V137.19C62.4001 131.4 62.4001 125.59 70.1001 125.59H439.8C446.7 125.59 449.5 131.4 449.5 135.3V216.7H449.6Z',
        style: { fill: 'currentcolor' },
      },
      {
        d: 'M192.2 249.59H116.6C114.3 249.58 112.1 250.01 110 250.89C107.8 251.74 105.9 253.02 104.3 254.63C102.8 256.24 101.5 258.16 100.6 260.25C99.8002 262.35 99.3002 264.61 99.3002 266.9V266.99C99.3002 269.27 99.7002 271.54 100.6 273.64C101.5 275.75 102.7 277.67 104.2 279.28C105.9 280.9 107.8 282.18 109.9 283.07C112 283.94 114.2 284.39 116.5 284.39H192.2C195.5 284.4 198.9 283.4 201.8 281.5C204.6 279.6 206.9 276.9 208.2 273.74C209 271.62 209.6 269.37 209.6 267.1V266.99C209.6 264.7 209.1 262.45 208.2 260.32C207.3 258.21 206 256.29 204.4 254.67C202.8 253.05 200.9 251.77 198.8 250.9C196.7 250.03 194.5 249.58 192.2 249.59ZM228.8 267.1C228.8 269.38 229.2 271.63 230.1 273.75C231 275.86 232.2 277.77 233.8 279.38C235.5 281 237.4 282.29 239.5 283.16C241.7 284.04 243.9 284.5 246.2 284.5H397.3C399.6 284.51 401.8 284.08 404 283.2C406.1 282.34 407.9 281.07 409.5 279.46C411.1 277.85 412.4 275.93 413.3 273.84C414.1 271.74 414.6 269.47 414.6 267.19V267.1C414.6 264.81 414.2 262.55 413.3 260.45C412.5 258.33 411.2 256.42 409.6 254.81C408 253.19 406.1 251.91 404 251.02C401.9 250.15 399.7 249.7 397.4 249.7H244.3C240 250.12 235.9 252.14 233.1 255.37C230.2 258.6 228.7 262.78 228.8 267.1ZM321.8 340.6H397.4C399.7 340.61 401.9 340.17 404.1 339.3C406.2 338.44 408 337.17 409.6 335.56C411.2 333.95 412.5 332.03 413.4 329.94C414.3 327.84 414.7 325.58 414.7 323.29V323.2C414.7 320.92 414.3 318.65 413.4 316.55C412.5 314.44 411.3 312.52 409.7 310.91C408.1 309.29 406.2 308 404.1 307.12C402 306.25 399.8 305.8 397.5 305.8H321.8C318.4 305.79 315.1 306.79 312.3 308.68C309.4 310.59 307.2 313.29 305.8 316.45C305 318.56 304.5 320.82 304.5 323.09V323.2C304.5 325.48 304.9 327.73 305.8 329.85C306.7 331.96 307.9 333.88 309.5 335.48C311.1 337.1 313.1 338.39 315.2 339.26C317.2 340.14 319.4 340.6 321.7 340.6H321.8ZM116.5 340.6H269.5C271.9 340.61 274.1 340.18 276.3 339.3C278.4 338.45 280.3 337.17 281.9 335.56C283.5 333.95 284.8 332.03 285.7 329.94C286.5 327.84 286.9 325.58 286.9 323.29V323.2C286.9 320.92 286.5 318.65 285.7 316.55C284.8 314.44 283.6 312.52 282 310.91C280.4 309.29 278.5 308 276.3 307.12C274.2 306.25 272 305.8 269.6 305.8H116.5C113.1 305.79 109.7 306.79 106.9 308.68C104 310.59 101.9 313.29 100.5 316.45C99.7002 318.56 99.2002 320.82 99.2002 323.09V323.2C99.2002 325.49 99.6002 327.74 100.5 329.87C101.4 331.97 102.7 333.9 104.2 335.52C105.8 337.14 107.7 338.42 109.8 339.28C112 340.16 114.2 340.61 116.5 340.6Z',
        style: { fill: 'currentcolor' },
      },
    ],
  },
  'audio-tracks': {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M57.48 223.57v75.86c-.01 2.32.44 4.59 1.31 6.73.88 2.12 2.17 4.06 3.8 5.69 1.63 1.62 3.57 2.9 5.69 3.78 2.13.89 4.41 1.32 6.71 1.32s4.58-.43 6.71-1.32c2.13-.88 4.06-2.16 5.7-3.78a17.6 17.6 0 0 0 3.79-5.69c.87-2.14 1.32-4.41 1.31-6.73v-75.86c.01-2.31-.44-4.59-1.31-6.71-.87-2.14-2.17-4.06-3.79-5.69a17.1 17.1 0 0 0-5.7-3.79c-2.13-.89-4.41-1.34-6.71-1.33-2.3-.01-4.58.44-6.71 1.33-2.12.86-4.06 2.15-5.69 3.79a17.38 17.38 0 0 0-5.11 12.4M454.51 223.57v75.87c.01 2.31-.44 4.58-1.33 6.72-.87 2.12-2.15 4.06-3.79 5.69-1.62 1.63-3.55 2.9-5.69 3.78-2.12.89-4.4 1.33-6.71 1.32-2.3.01-4.57-.43-6.7-1.32-2.14-.88-4.08-2.15-5.69-3.78a17.3 17.3 0 0 1-3.8-5.69c-.88-2.14-1.33-4.41-1.32-6.72v-75.87c-.01-2.31.44-4.59 1.32-6.71a17.1 17.1 0 0 1 3.8-5.69c1.61-1.63 3.55-2.93 5.69-3.79 2.13-.89 4.4-1.33 6.7-1.32 2.31-.01 4.59.43 6.71 1.32 2.14.86 4.07 2.16 5.69 3.79 1.64 1.63 2.92 3.55 3.79 5.69.89 2.12 1.34 4.4 1.33 6.71M177.48 188.03v146.95c-.01 2.29.44 4.57 1.31 6.7.88 2.14 2.17 4.06 3.8 5.69 1.64 1.63 3.56 2.93 5.69 3.8 2.14.87 4.41 1.32 6.71 1.31 2.3.01 4.59-.44 6.71-1.31 2.13-.87 4.07-2.17 5.69-3.8 1.64-1.63 2.92-3.55 3.8-5.69.88-2.13 1.32-4.41 1.31-6.7V188.03a17.4 17.4 0 0 0-1.31-6.71 17.4 17.4 0 0 0-3.8-5.69 17.5 17.5 0 0 0-5.69-3.8c-2.12-.87-4.41-1.31-6.71-1.3-2.3-.01-4.57.43-6.71 1.3a17.8 17.8 0 0 0-5.69 3.8 17.6 17.6 0 0 0-3.8 5.69c-.87 2.14-1.32 4.41-1.31 6.71M333.51 188.03v146.95c.01 2.29-.44 4.57-1.32 6.7-.88 2.14-2.16 4.06-3.8 5.69a17.2 17.2 0 0 1-5.69 3.8c-2.12.87-4.4 1.32-6.71 1.31-2.3.01-4.57-.44-6.7-1.31-2.14-.87-4.07-2.17-5.7-3.8a17.4 17.4 0 0 1-3.79-5.69c-.88-2.13-1.33-4.41-1.32-6.7V188.03c-.01-2.3.44-4.57 1.32-6.71a17.6 17.6 0 0 1 3.79-5.69c1.63-1.63 3.56-2.91 5.7-3.8 2.13-.87 4.4-1.31 6.7-1.3 2.31-.01 4.59.43 6.71 1.3 2.13.89 4.07 2.17 5.69 3.8a17.4 17.4 0 0 1 3.8 5.69c.88 2.14 1.33 4.41 1.32 6.71M152.5 377.26V134.73c.01-2.29-.44-4.57-1.3-6.71a17.5 17.5 0 0 0-3.81-5.68 17.5 17.5 0 0 0-5.69-3.81c-2.13-.86-4.41-1.31-6.71-1.3-2.29-.01-4.58.44-6.71 1.3a17.5 17.5 0 0 0-5.69 3.81 17.5 17.5 0 0 0-3.8 5.68c-.87 2.14-1.32 4.42-1.31 6.71v242.53c-.01 2.29.44 4.57 1.31 6.71.88 2.12 2.18 4.07 3.8 5.69 1.63 1.62 3.56 2.91 5.69 3.8 2.13.86 4.42 1.31 6.71 1.3 2.3.01 4.58-.44 6.71-1.3 2.13-.89 4.06-2.18 5.69-3.8a17.7 17.7 0 0 0 3.81-5.69c.86-2.14 1.31-4.42 1.3-6.71M358.48 377.26V134.73c-.01-2.29.44-4.57 1.32-6.71.88-2.13 2.16-4.05 3.8-5.68 1.61-1.63 3.55-2.93 5.69-3.81 2.12-.86 4.4-1.31 6.71-1.3 2.3-.01 4.57.44 6.7 1.3 2.14.88 4.06 2.18 5.69 3.81 1.64 1.63 2.93 3.55 3.79 5.68.89 2.14 1.34 4.42 1.33 6.71v242.53c.01 2.29-.44 4.58-1.33 6.71-.86 2.12-2.15 4.07-3.79 5.69a17.7 17.7 0 0 1-5.69 3.8c-2.13.86-4.4 1.31-6.7 1.3-2.31.01-4.59-.44-6.71-1.3a17.5 17.5 0 0 1-5.69-3.8c-1.64-1.62-2.92-3.57-3.8-5.69-.88-2.13-1.33-4.42-1.32-6.71M273.5 430.56V81.44c.01-2.3-.44-4.59-1.3-6.71-.89-2.14-2.18-4.07-3.81-5.69a17.2 17.2 0 0 0-5.69-3.8c-2.12-.87-4.41-1.33-6.71-1.32-2.3-.01-4.57.45-6.71 1.32-2.13.87-4.05 2.17-5.69 3.8a17.4 17.4 0 0 0-3.8 5.69c-.86 2.12-1.32 4.41-1.31 6.71v349.12c-.01 2.29.45 4.57 1.31 6.7.88 2.14 2.18 4.07 3.8 5.69 1.64 1.63 3.56 2.93 5.69 3.81 2.14.86 4.41 1.31 6.71 1.3 2.3.01 4.59-.44 6.71-1.3 2.13-.88 4.07-2.18 5.69-3.81 1.63-1.62 2.92-3.55 3.81-5.69a17.7 17.7 0 0 0 1.3-6.7',
        style: { fill: 'currentcolor' },
      },
    ],
  },
  'more-horizontal': {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M293.6 256c0-7.435-2.2-14.701-6.3-20.881-4.2-6.181-10.2-10.998-16.9-13.844-6.9-2.846-14.4-3.593-21.7-2.147s-14 5.021-19.3 10.272c-5.2 5.293-8.8 11.977-10.3 19.252-1.5 7.3-.7 14.861 2.2 21.725a36.93 36.93 0 0 0 13.8 16.876 36.7 36.7 0 0 0 14 5.711c5 .935 10.1.842 15.1-.273s9.7-3.23 13.7-6.214c4.2-2.985 7.7-6.777 10.3-11.147 3.6-5.818 5.4-12.512 5.4-19.333zM418.9 256.001c0-7.435-2.2-14.701-6.4-20.881-4.1-6.18-10-10.997-16.9-13.843a37.24 37.24 0 0 0-21.6-2.147c-7.4 1.446-14 5.02-19.3 10.271-5.2 5.292-8.8 11.977-10.3 19.252-1.4 7.299-.7 14.86 2.2 21.725a36.93 36.93 0 0 0 13.8 16.876c5 3.435 11.1 5.549 17.2 6.156 6.2.607 12.4-.312 18-2.675 4.7-1.877 8.8-4.647 12.3-8.148 3.5-3.461 6.3-7.616 8.1-12.201a37.4 37.4 0 0 0 2.9-14.385M168.3 256.001c0-7.435-2.2-14.701-6.4-20.881-4.1-6.18-10-10.997-16.8-13.843a37.9 37.9 0 0 0-21.8-2.147c-7.2 1.446-13.9 5.02-19.2 10.271-5.2 5.292-8.9 11.977-10.4 19.252-1.4 7.299-.7 14.86 2.2 21.725 2.9 6.884 7.7 12.765 13.9 16.876 4.2 2.833 9 4.776 13.9 5.711 5.1.934 10.2.842 15.2-.274 5-1.115 9.7-3.229 13.7-6.214 4.1-2.984 7.7-6.777 10.3-11.146 3.6-5.818 5.4-12.513 5.4-19.333z',
        style: { fill: 'currentcolor' },
      },
    ],
  },
  'chevron-back': {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M328 112 184 255.999l144 144',
        style: {
          stroke: 'currentcolor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: '48',
          fill: 'none',
        },
      },
    ],
  },
  maximize: {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M406.5 311.9v95.8h-95.8M105.5 202.5v-95.8h95.8M310.7 106.7h95.8v95.8M201.3 407.7h-95.8v-95.8',
        style: {
          stroke: 'currentcolor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: '39.027',
          fill: 'none',
        },
      },
    ],
  },
  minimize: {
    viewBox: '0 0 512 512',
    paths: [
      {
        d: 'M310.7 407.7v-95.8h95.8M201.3 106.7v95.8h-95.8M406.5 202.5h-95.8v-95.8M105.5 311.99h95.8v95.8',
        style: {
          stroke: 'currentcolor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: '39.027',
          fill: 'none',
        },
      },
    ],
  },
  settings: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65a7.7 7.7 0 0 0-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65A8 8 0 0 0 4.5 12c0 .34.03.66.07.98L2.46 14.63a.5.5 0 0 0-.12.64l2 3.46c.14.24.43.34.68.22l2.42-1a7.3 7.3 0 0 0 1.69.98l.38 2.65c.05.24.25.42.49.42h4c.24 0 .44-.18.49-.42l.38-2.65a7.7 7.7 0 0 0 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5',
        style: { stroke: 'currentcolor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '1.4', fill: 'none' },
      },
    ],
  },
  cloud: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M19.35 10.04A7.5 7.5 0 0 0 12 4a7.5 7.5 0 0 0-6.96 4.81 5.5 5.5 0 0 0 .96 10.94h13a4.5 4.5 0 0 0 .35-9.71',
        style: { stroke: 'currentcolor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '1.6', fill: 'none' },
      },
    ],
  },
  episodes: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M4 6h13M4 12h13M4 18h13M20 6v.01M20 12v.01M20 18v.01',
        style: { stroke: 'currentcolor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', fill: 'none' },
      },
    ],
  },
  'skip-forward': {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M6 4l12 8-12 8zM20 4v16',
        style: { stroke: 'currentcolor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', fill: 'currentcolor' },
      },
    ],
  },
  heart: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M12 21s-7-4.5-9.5-9C1 8 3 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4 0 6 4 4.5 8-2.5 4.5-9.5 9-9.5 9z',
        style: { stroke: 'currentcolor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '1.6', fill: 'none' },
      },
    ],
  },
  'heart-filled': {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M12 21s-7-4.5-9.5-9C1 8 3 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4 0 6 4 4.5 8-2.5 4.5-9.5 9-9.5 9z',
        style: { stroke: 'currentcolor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '1.6', fill: 'currentcolor' },
      },
    ],
  },
  check: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M5 12l5 5L20 7',
        style: { stroke: 'currentcolor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2.4', fill: 'none' },
      },
    ],
  },
  x: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M6 6l12 12M18 6L6 18',
        style: { stroke: 'currentcolor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', fill: 'none' },
      },
    ],
  },
};




export default function BlissfulPlayer(props: {
  url: string;
  title: string | null;
  metaTitle?: string | null;
  poster: string | null;
  logo?: string | null;
  startTimeSeconds: number | null;
  type: string | null;
  id: string | null;
  videoId: string | null;
  addons: AddonDescriptor[];
  authKey: string | null;
  playerSettings: PlayerSettings;
  nextEpisodeInfo?: NextEpisodeInfo | null;
  // Optional quality picker. When present (>1 option), the controls
  // bar renders a "1080P"-style chip that opens a popover. Parent
  // owns the selection; BlissfulPlayer just preserves playback time
  // across the resulting props.url swap.
  qualityOptions?: { label: string; quality: string }[];
  selectedQuality?: string | null;
  onSelectQuality?: (quality: string) => void;
  // Audio tracks of a transcoded RD stream — pick which one the transcoder muxes.
  audioTracks?: TranscodeAudioTrack[];
  selectedAudioTrack?: number;
  onSelectAudioTrack?: (i: number) => void;
  // Pre-extracted subtitle tracks delivered alongside the stream
  // (Videasy/bitcine-style). Surfaced in the subtitle picker as
  // "Built-in" entries.
  builtinSubtitles?: SubtitleTrack[];
  // Meta details for the bitcine-style pause overlay. Optional —
  // when missing, the overlay degrades to logo+title only.
  description?: string | null;
  imdbRating?: string | null;
  /** Movie release date (ISO string from addon meta). Used for the
   *  pause overlay's meta line on movies. Series ignore this and use
   *  per-episode `released` fields instead. */
  released?: string | null;
  background?: string | null;
  // TMDB id of the show. When set + type === 'series', the episodes
  // drawer fetches per-season info (season overview, per-episode
  // runtime/overview) and uses that to render season-accurate text.
  tmdbId?: number | null;
  // Full episode list (series only). Drives the Episodes drawer.
  videos?: Array<{
    id: string;
    title: string | null;
    season: number | null;
    episode: number | null;
    thumbnail: string | null;
    released: string | null;
    description: string | null;
    /** Per-episode IMDb rating from Cinemeta when available. Used
     *  to render the IMDb chip on the pause overlay for series. */
    rating: string | null;
  }>;
  // Server picker. Lifted to the parent so changing it can trigger
  // a re-fetch from a different Videasy provider, and the auto-
  // switch fallback chain works across the whole player.
  selectedServer?: string;
  onSelectServer?: (id: string) => void;
  // Reports a source whose fatal HLS network errors keep recurring (e.g.
  // the Videasy segment CDN died mid-session). Returns true when the
  // parent takes over (swaps in a fallback stream) — the player then
  // stops retrying this source instead of looping forever.
  onSourceDead?: (src: string) => boolean;
  // IDs of servers that the parent has already tried and given up
  // on for the current title — rendered as disabled rows in the
  // picker so the user knows what's been ruled out.
  unavailableServers?: string[];
  // Hide the Servers tab in the settings drawer. Used when playback
  // is via the addon-stream fallback (Real-Debrid HTTPS URL), where
  // the Videasy server picker doesn't apply.
  hideServerPicker?: boolean;
  // Real-Debrid fallback "change torrent" picker — the list of candidate
  // releases, the currently-playing one, and a setter. Surfaced as a
  // "Releases" tab in the settings drawer when in fallback mode.
  releases?: ReleaseOption[];
  selectedReleaseUrl?: string | null;
  onSelectRelease?: (url: string) => void;
  // When true (set via the ?pickReleases=1 nav param from the unreleased
  // modal's "Play with RD"), auto-open the Releases selector once the RD
  // fallback streams resolve, so the user lands directly in the torrent picker.
  autoOpenReleases?: boolean;
  // Pick-first mode only: invoked if the user closes the auto-opened Releases
  // picker WITHOUT choosing — so the player can auto-commit a default stream
  // instead of stranding them behind the buffering veil.
  onReleasesDismissed?: () => void;
  // True when the user EXPLICITLY chose Real-Debrid ("Play with RealDebrid").
  // Suppresses the "Vidking is unavailable" banner — Videasy was never tried,
  // so changing release shouldn't claim it failed.
  rdMode?: boolean;
  // When set, a one-time info banner pops up announcing that the
  // primary (Videasy) source is unavailable and the player has
  // fallen back to a Real-Debrid stream. On mobile, the banner also
  // shows an "Open in VLC" button.
  fallbackActive?: boolean;
  // Mini-player. `compact` renders the player to fill a small floating box
  // (absolute, not fixed) with stripped-down chrome. The callbacks drive the
  // minimize/expand/close transitions (owned by MiniPlayerProvider).
  compact?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
  onClosePlayer?: () => void;
  // Watch-party room code (from `?room=...` on the URL). When present,
  // the player connects to the room over WS and stays in lock-step
  // with the host's timeline.
  roomCode?: string | null;
}) {
  const navigate = useNavigate();
  // Two-phase buffering for /player:
  //   Phase 1: AppShell-level PlayerBufferingScreen (logo on black,
  //            z-[9999]) — visible from route mount until BlissfulPlayer
  //            mounts. Flips `playerReady` to true here.
  //   Phase 2: BlissfulPlayer's own in-player buffer UI (logo + sliding
  //            controls) — visible until the first painted video frame.
  //            Gated by `firstFrameSeen` (set on first `timeupdate`
  //            with currentTime > 0).
  // Result: AppShell buffer → BlissfulPlayer with controls sliding in
  // and buffer logo → movie. No black gap because PlayerBufferingScreen
  // sits at z-9999 over BlissfulPlayer until BlissfulPlayer is fully
  // rendered, and BlissfulPlayer's internal buffer covers the period
  // until the first frame paints.
  const { setReady: setPlayerReady } = usePlayerReady();
  const [firstFrameSeen, setFirstFrameSeen] = useState(false);
  const firstFrameSeenRef = useRef(false);
  useEffect(() => {
    setPlayerReady(true);
    return () => {
      firstFrameSeenRef.current = false;
      setFirstFrameSeen(false);
      setPlayerReady(false);
    };
  }, [setPlayerReady]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRootRef = useRef<HTMLDivElement | null>(null);
  // Pending "resize kick" timers (mobile won't-start-until-rotate workaround).
  const kickTimersRef = useRef<number[]>([]);
  // Rendered width of the player root — drives dynamic subtitle scaling in the
  // (resizable) mini-player so captions stay proportional to the window.
  const [playerWidth, setPlayerWidth] = useState(0);
  const subtitleBlobUrlRef = useRef<string | null>(null);
  const startAppliedRef = useRef(false);
  const hlsRef = useRef<Hls | null>(null);
  // Live mirrors of quality picker state — read from inside the HLS
  // error handler so codec-error fallback can switch quality without
  // re-running the whole HLS effect every time props.selectedQuality
  // changes.
  const qualityOptionsRef = useRef(props.qualityOptions);
  qualityOptionsRef.current = props.qualityOptions;
  const selectedQualityRef = useRef(props.selectedQuality ?? null);
  selectedQualityRef.current = props.selectedQuality ?? null;
  const onSelectQualityRef = useRef(props.onSelectQuality);
  onSelectQualityRef.current = props.onSelectQuality;
  const onSourceDeadRef = useRef(props.onSourceDead);
  onSourceDeadRef.current = props.onSourceDead;
  // Live mirrors read inside the HLS 409 handler: the "pick another release"
  // drawer must only auto-open when there is actually something to pick — the
  // Releases list resolves async, and opening before it landed showed an
  // empty panel with no tab selected. Party guests never get the picker
  // (SettingsPanel receives releases=undefined), so don't open it for them.
  const releasesRef = useRef(props.releases);
  releasesRef.current = props.releases;
  const partyNonHostRef = useRef(false);
  // Set when a 409 wanted the Releases drawer before the list resolved; an
  // effect below opens the drawer as soon as releases arrive.
  const pendingReleasesOpenRef = useRef(false);
  // Counts transient load-time failures (mobile network blip,
  // upstream 502 on a Videasy segment, etc.). Bumping `retryNonce`
  // re-runs the src effect — same code path as a fresh mount —
  // which is enough to recover most of the time. For Videasy/HLS
  // streams we never surface a fatal error: yoru/cdn flakes a lot
  // on mobile, and the experience the user wants is "buffering
  // spinner stays visible until it recovers", not a permanent
  // "Unable to play" toast. We back off up to 5s and keep retrying.
  const streamRetriesRef = useRef(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const scheduleStreamRetry = useCallback(() => {
    const attempt = streamRetriesRef.current + 1;
    streamRetriesRef.current = attempt;
    // 500ms · attempt, capped at 5s. So: 0.5 / 1 / 1.5 / 2 / … / 5s.
    const delayMs = Math.min(500 * attempt, 5000);
    playerLog(`[player] stream error, silent retry ${attempt} in ${delayMs}ms`);
    window.setTimeout(() => setRetryNonce((n) => n + 1), delayMs);
  }, []);

  const [isPlaying, setIsPlaying] = useState(false);
  // Flips true the first time playback actually starts. Used by the
  // PauseOverlay to suppress the title/description card during the
  // initial mount-buffer-autoplay sequence, when isPlaying is still
  // false but the user has not paused — without this the overlay
  // flashes the movie metadata for a frame before autoplay kicks in.
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.6);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [instantHideControls, setInstantHideControls] = useState(false);
  // Start as `true` so the in-player buffering UI (the centered logo
  // with the `bliss-buffer-fade` pulse) is visible from frame 1 — the
  // AppShell's PlayerBufferingScreen unmounts the instant BlissfulPlayer
  // mounts (via the playerReady context), so without this initial value
  // there's a black-screen gap before the video element fires its first
  // `waiting`/`stalled` event and flips this to true. Cleared by the
  // `canplay`/`playing` event handler once the stream actually starts.
  const [isBuffering, setIsBuffering] = useState(true);
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [subtitleSizePx, setSubtitleSizePx] = useState(props.playerSettings.subtitlesSizePx);

  // Observe the player root size so subtitles scale with the resizable mini
  // window (in full mode the root ≈ the viewport, so this is a no-op there).
  useEffect(() => {
    const el = playerRootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      if (w > 0) setPlayerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // In mini, shrink captions in proportion to how small the window is vs the
  // viewport (floored so they stay legible); full mode uses the raw size.
  const effectiveSubtitleSizePx =
    props.compact && playerWidth > 0 && typeof window !== 'undefined'
      ? Math.max(7, Math.round(subtitleSizePx * Math.min(1, playerWidth / window.innerWidth)))
      : subtitleSizePx;
  // Pause-overlay scale for the mini window — shrinks the bottom-left info card
  // so it fits (and grows back as the window is resized larger).
  const pauseOverlayScale =
    props.compact && playerWidth > 0 ? Math.max(0.35, Math.min(1, playerWidth / 900)) : 1;
  // Subtitle vertical position. Const for now (the legacy in-player
  // slider that mutated this was removed when SettingsPanel landed);
  // restore as state when SettingsPanel grows a position knob.
  const subtitlePosition = 10;
  const [subtitleColor, setSubtitleColor] = useState(props.playerSettings.subtitlesTextColor);
  const [subtitleBackgroundColor, setSubtitleBackgroundColor] = useState(
    props.playerSettings.subtitlesBackgroundColor
  );
  const [subtitleOutlineColor, setSubtitleOutlineColor] = useState(
    props.playerSettings.subtitlesOutlineColor
  );
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // One-time banner shown when playback falls back from Videasy to
  // a Real-Debrid stream (e.g. Videasy backend 503). Dismissible.
  const [fallbackBannerDismissed, setFallbackBannerDismissed] = useState(false);
  useEffect(() => {
    // Reset per EPISODE, not per stream URL — swapping releases changes the
    // transcode URL but shouldn't re-show the "Vidking unavailable" banner each
    // time. Only a new episode/title should surface it again.
    setFallbackBannerDismissed(false);
  }, [props.id, props.videoId]);
  // Auto-dismiss after a few seconds — it's informational, and shouldn't linger
  // while the user swaps torrents in the Releases picker.
  useEffect(() => {
    if (!props.fallbackActive || props.rdMode || fallbackBannerDismissed) return;
    const t = window.setTimeout(() => setFallbackBannerDismissed(true), 5000);
    return () => window.clearTimeout(t);
  }, [props.fallbackActive, props.rdMode, fallbackBannerDismissed]);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [embeddedSubtitleTracks, setEmbeddedSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const scrubBarSliderRef = useRef<HTMLInputElement | null>(null);
  const [scrubHoverPx, setScrubHoverPx] = useState<number | null>(null);
  const [scrubHoverTime, setScrubHoverTime] = useState<number | null>(null);
  const [videoInfo, setVideoInfo] = useState<{
    width: number | null;
    height: number | null;
    codec: string | null;
    colorTransfer: string | null;
    isHdr: boolean;
    is4k: boolean;
  } | null>(null);
  const allSubtitleTracks = useMemo(
    () => [...subtitleTracks, ...embeddedSubtitleTracks, ...(props.builtinSubtitles ?? [])],
    [subtitleTracks, embeddedSubtitleTracks, props.builtinSubtitles]
  );
  // Stable ref to the latest tracks list so async closures
  // (subtitle fetch, fallback) can read it without re-triggering
  // their owning effect when the list grows incrementally.
  const allSubtitleTracksRef = useRef(allSubtitleTracks);
  allSubtitleTracksRef.current = allSubtitleTracks;
  const [selectedSubtitleKey, setSelectedSubtitleKey] = useState<string>('off');
  // True once the user (or a watch-party host sync) has explicitly chosen a
  // subtitle, so the auto-pick effect stops overriding it. Declared up here so
  // the watch-party guest handler (defined before the hook) can set it.
  const userPickedSubtitleRef = useRef(false);
  // Bumped whenever the <video> element fires `emptied`. hls.js's
  // recoverMediaError (and any other MediaSource detach/attach) wipes
  // textTracks and disables the previously attached <track>, so the
  // user loses their subtitles even though our React state still has
  // the selection. Including this in the subtitle-apply effect's deps
  // forces a track re-attach so subs survive a mid-playback HLS
  // recovery.
  const [subtitleReattachNonce, setSubtitleReattachNonce] = useState(0);
  // Bitcine-style unified Settings panel with tabbed body
  // (Quality / Subtitles / Servers).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Cloud-synced player settings. `savePlayerSettings` writes both
  // localStorage AND MongoDB via the storage server, so "Save to
  // account" in the appearance subview matches the /settings page.
  const storageCtx = useStorage();

  // ---- Watch party --------------------------------------------------
  //
  // Opt-in via `?room=...` on the player URL. The useWatchParty hook
  // owns the WS connection and the host/guest sync logic; we just
  // feed it the videoRef + identity (+ password when the room needs
  // one) and render the controls overlay in the TopOverlay row.
  //
  // Password flow:
  //   - JoinModal stashes the password in sessionStorage before
  //     navigating to the player → we pick it up immediately.
  //   - Direct invite-link joins: roomInfo.hasPassword is true but
  //     sessionStorage is empty → render WatchPartyPasswordPrompt;
  //     once the user submits, we stash and pass to the hook.

  // Effective display name + identity for the watch party. Stremio-
  // authed users with a Blissful displayName use it directly. The
  // fallback chain is:
  //   1. Blissful profile displayName (when set & non-"Guest")
  //   2. localStorage guest name (chosen via WatchPartyNamePrompt)
  //   3. null → triggers the in-player name prompt before connecting
  //
  // guestId only matters when there's no Stremio authKey; it's a
  // stable per-device id so reconnects land on the same participant.
  const profileDisplayName = storageCtx.userProfile?.displayName?.trim() || '';
  const [storedGuestName, setStoredGuestNameState] = useState<string | null>(() => getStoredGuestName());
  const watchPartyDisplayName =
    profileDisplayName && profileDisplayName !== 'Guest'
      ? profileDisplayName
      : storedGuestName;
  const [guestId] = useState<string>(() => getOrCreateGuestUserId());

  const [roomInfo, setRoomInfo] = useState<{ hasPassword: boolean } | null>(null);
  // Clears a dead room's stale "Join party" cache entry; the ref makes the
  // bail-out fire once per code (the REST-404 effect + the WS no-room effect
  // both use it).
  const { clearByCode: clearActiveParty } = useActiveParties();
  const handledNoRoomRef = useRef<string | null>(null);
  const [partyPassword, setPartyPassword] = useState<string | null>(() =>
    props.roomCode ? getWatchPartyPassword(props.roomCode) : null
  );
  useEffect(() => {
    // When the room code changes, refresh the cached password.
    setPartyPassword(props.roomCode ? getWatchPartyPassword(props.roomCode) : null);
  }, [props.roomCode]);

  useEffect(() => {
    const code = props.roomCode;
    if (!code) {
      setRoomInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await getWatchPartyRoomStatus(code);
      if (cancelled) return;
      if (result.status === 'gone') {
        // The room 404s — it's dead (host left / reaped). Its "Join party" entry
        // was stale in our cache; that's why we landed on a dead room that just
        // shows "Connecting…" forever. Purge it, tell the user, leave.
        if (handledNoRoomRef.current !== code) {
          handledNoRoomRef.current = code;
          clearActiveParty(code);
          notifyError('Watch party ended', 'That party is no longer active.');
          navigate('/', { replace: true });
        }
        setRoomInfo(null);
        return;
      }
      setRoomInfo(result.status === 'exists' ? { hasPassword: result.info.hasPassword } : null);
    })();
    return () => { cancelled = true; };
  }, [props.roomCode, clearActiveParty, navigate]);

  const handleHostEpisodeChange = useCallback(
    (videoId: string | null) => {
      if (!videoId) return;
      const params = new URLSearchParams(window.location.search);
      params.set('url', 'vidking:placeholder');
      params.set('videoId', videoId);
      params.delete('t');
      params.delete('autoplay');
      params.delete('rdsel');
      navigate(`/player?${params.toString()}`, { replace: true });
    },
    [navigate]
  );

  // Once we've received a v2 `source` from the host, it's authoritative — the
  // legacy host:stream relay below becomes a no-op so we don't double-navigate
  // (a v2 host emits both for one transition cycle). Older hosts that only send
  // host:stream keep working unchanged.
  const receivedSourceRef = useRef(false);

  // Guest: the host fell back to a Real-Debrid stream — load the SAME torrent
  // (rdsel=1 skips our own Vidking resolution and plays the host's exact URL).
  // When the host returns to Vidking (streamUrl null) we drop back to the
  // placeholder so we resolve the same Vidking source again.
  const handleHostStreamChange = useCallback(
    (streamUrl: string | null) => {
      if (receivedSourceRef.current) return; // v2 `source` supersedes
      const params = new URLSearchParams(window.location.search);
      const cur = params.get('url') ?? '';
      if (streamUrl) {
        if (cur === streamUrl) return; // already on the host's stream
        params.set('url', streamUrl);
        params.set('rdsel', '1');
        params.delete('autoplay');
        navigate(`/player?${params.toString()}`, { replace: true });
      } else if (params.get('rdsel') === '1') {
        // Only revert if we were following the host's RD stream.
        params.set('url', 'vidking:placeholder');
        params.delete('rdsel');
        params.delete('autoplay');
        navigate(`/player?${params.toString()}`, { replace: true });
      }
    },
    [navigate]
  );

  // Guest (WP v2): the host announced the room's content `source`. Resolve it to
  // the SAME file our way (torrent → /rd-by-hash → direct link; rd → reuse the
  // link), then navigate with rdsel=1 so the page plays that exact URL. vidking
  // / relay / a cache miss → keep our own resolution (timeline-only sync). Null
  // source (host back on an unshareable Vidking) → revert to the placeholder if
  // we were following the host's source.
  const handleHostSourceChange = useCallback(
    (source: WatchPartySource) => {
      receivedSourceRef.current = true;
      void (async () => {
        const resolved = await resolveSourceForWeb(source);
        const params = new URLSearchParams(window.location.search);
        const cur = params.get('url') ?? '';
        if (resolved) {
          if (cur === resolved.url) return; // already on it
          params.set('url', resolved.url);
          if (resolved.rdsel) params.set('rdsel', '1');
          // Layer B relay: stremio-service transcodes from t=0, but we're already
          // time-synced to the host — start the relay at our CURRENT position so
          // we join where the host actually is (e.g. minute 8) instead of
          // replaying from 0:00. Starting at 0 strands the readiness gate on a
          // multi-minute catch-up and freezes the host behind the buffering veil.
          // Drift-correct fine-tunes from there. Live relay only — full-VOD
          // torrent/rd sources are seekable so the normal time-sync handles them.
          if (source?.kind === 'relay') {
            // Seed from the HOST's authoritative position — the guest may be
            // mid-seek or briefly desynced, which would land the relay at the
            // wrong spot and force a costly re-seek of the live transcode.
            // Fall back to our own currentTime if no host tick yet.
            const hostT = watchPartyRef.current?.getHostTime?.() ?? null;
            const pos = Math.floor(hostT ?? videoRef.current?.currentTime ?? 0);
            if (pos > 5) params.set('t', String(pos));
            else params.delete('t');
          }
          params.delete('autoplay');
          navigate(`/player?${params.toString()}`, { replace: true });
        } else if (params.get('rdsel') === '1') {
          // Source is unshareable now (host back on Vidking, or a torrent we
          // can't resolve) AND we were following the host's stream — drop back
          // to our own Vidking (timeline-only sync from here).
          params.set('url', 'vidking:placeholder');
          params.delete('rdsel');
          params.delete('autoplay');
          navigate(`/player?${params.toString()}`, { replace: true });
        }
      })();
    },
    [navigate]
  );

  // Guest: the host changed subtitle language — match it. Pick the best track in
  // that language (or 'off' for null). Mark it user-picked so our auto-pick
  // doesn't override the host's choice.
  const handleHostSubsChange = useCallback((lang: string | null) => {
    userPickedSubtitleRef.current = true;
    if (!lang) {
      setSelectedSubtitleKey('off');
      return;
    }
    const canon = subtitleLangLabel(lang);
    const match = allSubtitleTracksRef.current.find((t) => subtitleLangLabel(t.lang) === canon);
    setSelectedSubtitleKey(match ? match.key : 'off');
  }, []);

  // Only feed the hook a roomCode once we've satisfied every gate:
  // room info loaded, password supplied if needed, and a display name
  // chosen. Otherwise the WS would join with empty fields and the
  // server would either slam the door or list the user as "Guest".
  const partyShouldConnect =
    !!props.roomCode
    && roomInfo != null
    && (!roomInfo.hasPassword || !!partyPassword)
    && !!watchPartyDisplayName;

  // Layer B: hold a ref to the live hook so the request/decline callbacks (which
  // are passed INTO the hook) can call back into it without a definition cycle.
  const watchPartyRef = useRef<ReturnType<typeof useWatchParty> | null>(null);
  // Layer B (host side, WEB): a web host can't relay — it has no local
  // stremio-service HLS or outbound tunnel (that's the desktop shell's job). So
  // decline; the guest keeps its own fallback (Vidking / RD).
  const handleHostStreamRequest = useCallback((from: { userId: string; displayName: string }) => {
    watchPartyRef.current?.declineHostStream(from.userId);
  }, []);
  // Layer B (guest side): the host declined our request — stay on our source.
  const handleHostStreamDeclined = useCallback(() => {
    notifyInfo('Watch party', 'Host kept their stream private — staying on your own source.');
  }, []);

  const watchParty = useWatchParty({
    videoRef,
    roomCode: partyShouldConnect ? props.roomCode ?? null : null,
    authToken: props.authKey,
    guestId: props.authKey ? null : guestId,
    displayName: watchPartyDisplayName ?? '',
    password: partyPassword,
    // Layer B relay: it's a LIVE transcode — every drift seek restarts the
    // encoder and re-buffers, so tight 0.35s correction thrashes it into a
    // permanent buffering loop. Widen the tolerance so the guest plays the
    // relay sequentially and only snaps for big (buffer-induced) gaps.
    driftToleranceS: props.url.includes('/party-relay') ? 10 : undefined,
    onHostEpisodeChange: handleHostEpisodeChange,
    onHostStreamChange: handleHostStreamChange,
    onHostSubsChange: handleHostSubsChange,
    onHostSourceChange: handleHostSourceChange,
    onHostStreamRequest: handleHostStreamRequest,
    onHostStreamDeclined: handleHostStreamDeclined,
  });
  watchPartyRef.current = watchParty;

  // If the cached password is wrong, the hook surfaces an error and
  // stops reconnecting. Clear the stale cache so we re-prompt.
  useEffect(() => {
    if (watchParty.error === 'incorrect password' && props.roomCode) {
      clearWatchPartyPassword(props.roomCode);
      setPartyPassword(null);
    }
  }, [watchParty.error, props.roomCode]);

  // Belt-and-suspenders: if the room dies WHILE we're connected (host leaves,
  // reaper fires), the WS sends a no-room error — same cleanup as the REST 404
  // path above.
  useEffect(() => {
    if (watchParty.errorCode !== 'no-room' || !props.roomCode) return;
    if (handledNoRoomRef.current === props.roomCode) return;
    handledNoRoomRef.current = props.roomCode;
    clearActiveParty(props.roomCode);
    notifyError('Watch party ended', 'That party is no longer active.');
    navigate('/', { replace: true });
  }, [watchParty.errorCode, props.roomCode, clearActiveParty, navigate]);

  // Host broadcasts episode changes so guests can follow along.
  // Skip the first run — when the host *creates* the room they pass
  // the starting videoId via POST, so the server already knows; any
  // subsequent change (next-episode advance, episode picker) is a
  // navigation we want guests to mirror.
  const lastAnnouncedVideoIdRef = useRef<string | null>(props.videoId);
  useEffect(() => {
    if (!watchParty.isHost) return;
    if (lastAnnouncedVideoIdRef.current === props.videoId) return;
    lastAnnouncedVideoIdRef.current = props.videoId;
    watchParty.announceEpisode(props.videoId);
  }, [watchParty.isHost, watchParty.announceEpisode, props.videoId]);

  // Host: when we fall back to a Real-Debrid stream (props.url is a
  // /transcode.m3u8 URL), announce it so guests load the same torrent. Vidking
  // (or anything else) → announce null so guests resolve their own source.
  const lastAnnouncedStreamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!watchParty.isHost) return;
    const rd = /^\/transcode(\.m3u8)?\?/.test(props.url ?? '') ? (props.url ?? null) : null;
    if (lastAnnouncedStreamRef.current === rd) return;
    lastAnnouncedStreamRef.current = rd;
    watchParty.announceStream(rd);
  }, [watchParty.isHost, watchParty.announceStream, props.url]);

  // Host (WP v2): announce the room's content `source` so guests on any platform
  // land on the SAME file. On RD → the underlying RD link; on Vidking → the
  // tmdb identity (unshareable, but lets non-web guests know). Emitted ALONGSIDE
  // the legacy host:stream above for one transition cycle.
  const lastAnnouncedSourceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!watchParty.isHost) return;
    const source = webPlayingToSource({
      url: props.url,
      tmdbId: props.tmdbId,
      type: props.type === 'series' ? 'series' : 'movie',
      videoId: props.videoId,
    });
    const key = JSON.stringify(source);
    if (lastAnnouncedSourceRef.current === key) return;
    lastAnnouncedSourceRef.current = key;
    watchParty.announceSource(source);
  }, [watchParty.isHost, watchParty.announceSource, props.url, props.tmdbId, props.type, props.videoId]);

  // Host: broadcast the selected subtitle LANGUAGE (canonical label, or null =
  // off) so guests match it. Language (not the exact key) is robust across
  // clients that may have slightly different addon track lists.
  const lastAnnouncedSubLangRef = useRef<string | null>(null);
  useEffect(() => {
    if (!watchParty.isHost) return;
    let lang: string | null = null;
    if (selectedSubtitleKey !== 'off') {
      const track = allSubtitleTracks.find((t) => t.key === selectedSubtitleKey);
      lang = track ? subtitleLangLabel(track.lang) : null;
    }
    if (lastAnnouncedSubLangRef.current === lang) return;
    lastAnnouncedSubLangRef.current = lang;
    watchParty.announceSubs(lang);
  }, [watchParty.isHost, watchParty.announceSubs, selectedSubtitleKey, allSubtitleTracks]);

  const [creatingRoom, setCreatingRoom] = useState(false);
  const [partyDrawerOpen, setPartyDrawerOpen] = useState(false);
  const [partyDrawerTab, setPartyDrawerTab] = useState<WatchPartyDrawerTab>('open');
  const [partyActiveRoomTab, setPartyActiveRoomTab] = useState<'people' | 'chat'>('people');

  // Unread chat badge — counts other people's messages received
  // while the user wasn't actively looking at the chat tab. Clears
  // when the drawer opens to the chat tab. Chat history that
  // hydrates on join is treated as already-seen, not unread.
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
      // First snapshot after connecting — backlog is history, not unread.
      didInitChatLenRef.current = true;
      lastSeenChatLenRef.current = len;
      return;
    }
    const chatVisible = partyDrawerOpen && partyActiveRoomTab === 'chat';
    if (chatVisible) {
      lastSeenChatLenRef.current = len;
      if (unreadChatCount !== 0) setUnreadChatCount(0);
      return;
    }
    if (len <= lastSeenChatLenRef.current) {
      // Chat shrunk (room reset) or unchanged — sync the marker.
      lastSeenChatLenRef.current = len;
      return;
    }
    const fresh = watchParty.chat.slice(lastSeenChatLenRef.current);
    const fromOthers = fresh.filter((m) => m.from.userId !== watchParty.selfUserId).length;
    lastSeenChatLenRef.current = len;
    if (fromOthers > 0) setUnreadChatCount((prev) => prev + fromOthers);
  }, [watchParty.connected, watchParty.chat, watchParty.selfUserId, partyDrawerOpen, partyActiveRoomTab, unreadChatCount]);

  const createParty = useCallback(
    async (password: string | null) => {
      if (!props.id || !props.type || creatingRoom) return;
      if (props.type !== 'movie' && props.type !== 'series' && props.type !== 'anime') return;
      setCreatingRoom(true);
      try {
        const partyType = props.type === 'series' || props.type === 'anime' ? 'series' : 'movie';
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
          `Room ${code.toUpperCase()}${password ? ' — password set' : ''}. Copy the code or invite link from the panel on the right.`
        );
        // Keep the drawer open — it'll switch to the active-room view
        // once the URL update propagates and roomCode is set.
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        notifyError('Failed to start watch party', message);
        throw err; // let the drawer's OpenRoom view surface inline
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
    setPartyDrawerOpen(false);
  }, [props.roomCode, watchParty, navigate]);

  const handleNavigateToRoom = useCallback(
    async (room: { code: string; type: 'movie' | 'series'; imdbId: string; videoId: string | null }) => {
      // buildRoomPlayerUrl pulls Cinemeta meta and stamps logo /
      // poster / background / metaTitle on the URL so the AppShell
      // buffering screen + player overlays render the title's
      // branding instead of a generic "Buffering" fallback.
      const url = await buildRoomPlayerUrl(room);
      navigate(url);
      setPartyDrawerOpen(false);
    },
    [navigate]
  );

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

  // Name prompt — fires when we have a room to join but no usable
  // display name (no Stremio profile name AND no stored guest name).
  // Sits ABOVE the password prompt in priority so the user picks
  // their name first; password gate runs after.
  const showNamePrompt = !!props.roomCode && !watchPartyDisplayName;

  // While we're waiting on the user to clear a watch-party gate
  // (name / password / room-info fetch), keep the video paused —
  // otherwise <video autoPlay> starts playback from 0:00 behind the
  // prompt overlay. Once the WS connects, the first tick from the
  // host re-issues play() at the right timestamp.
  const partyAwaitingJoin = !!props.roomCode && !watchParty.connected;
  useEffect(() => {
    if (!partyAwaitingJoin) return;
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) video.pause();
    const holdPaused = () => {
      // Re-pause on any browser-initiated play attempt during the
      // join wait. The handler removes itself when the gate clears.
      if (video.paused) return;
      video.pause();
    };
    video.addEventListener('play', holdPaused);
    return () => video.removeEventListener('play', holdPaused);
  }, [partyAwaitingJoin]);
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

  // Single entry point in TopOverlay — clicking opens the drawer.
  // The button itself adapts to the current state (entry pill vs
  // active-room status pill).
  const watchPartySlot = (
    <WatchPartyButton
      onClick={() => {
        // Default to the Open tab when arriving with no room; the
        // drawer ignores the tab prop once a room is active.
        if (!props.roomCode) setPartyDrawerTab('open');
        setPartyDrawerOpen(true);
      }}
      roomCode={props.roomCode ?? null}
      connected={watchParty.connected}
      hasPassword={roomInfo?.hasPassword ?? false}
      participants={watchParty.participants}
      unreadCount={unreadChatCount}
      busy={creatingRoom}
    />
  );

  const [settingsTab, setSettingsTab] = useState<SettingsTab>('subtitles');
  // Subtitles tab has two screens — the language list and a
  // "Customize Appearance" sub-screen for font size / color / latency.
  const [subtitlesView, setSubtitlesView] = useState<'list' | 'appearance'>('list');
  const [episodesOpen, setEpisodesOpen] = useState(false);
  // Ref to the current episode card so we can scrollIntoView when
  // the drawer opens — keeps the floating coverflow centered.
  const currentEpisodeCardRef = useRef<HTMLButtonElement | null>(null);
  // Coverflow focus follows the scroll position — the episode whose
  // center is closest to the viewport center becomes the "large" one.
  // Null until the user scrolls (we fall back to the current episode).
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
  // signed step counts that bump the focus index. Bitcine-style:
  // each ~60px of wheel/touch delta = one episode, so a fast flick
  // can rip through many episodes in a single gesture, while a
  // single mouse-wheel detent still moves exactly one. No
  // time-based debounce — pure delta accumulation gives both
  // precision and speed.
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
      // No scrollIntoView — the drawer translates the stack itself.
      return next;
    });
  };
  useEffect(() => {
    if (!episodesOpen) return;
    const container = episodesListRef.current;
    if (!container) return;

    // Carousel has no native scroll — wheel + touch deltas accumulate
    // and step focusIndex *proportionally*. Multi-step per event so
    // a fast trackpad flick isn't rate-limited; CSS transitions on
    // the stack interpolate to the latest target, so chained rapid
    // steps still glide smoothly to their final position. No
    // time-based cooldown — the accumulator IS the rate limiter.
    // Single-step per event (not proportional) so one wheel notch
    // never accidentally jumps two cards. A direction reversal
    // resets the accumulator so a small overshoot doesn't carry into
    // the next gesture. No time cooldown — the accumulator threshold
    // is the rate limiter, so trackpad inertia still chains fluidly.
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

  // On mobile we rely on native scroll, so the onScroll handler
  // re-finds the focused card (closest to viewport center).
  // Desktop's scroll comes from programmatic scrollIntoView only,
  // so this no-ops there in practice.
  const episodesScrollRaf = useRef<number | null>(null);
  // Set by the drawer's click / wheel handlers when they kick off a
  // smooth scrollIntoView. While this is in the future, the scroll
  // handler below stops trying to "snap" focusIndex to whatever's
  // closest to center — otherwise the in-flight animation passes
  // through intermediate cards and the focus visibly bounces (clicking
  // ep 1 from ep 3 used to land on ep 2 because the smooth scroll
  // hit ep 2's center mid-flight).
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
  // write the same field via storageCtx.savePlayerSettings.
  const autoNext = props.playerSettings.bingeWatching;
  const setAutoNext = useCallback(
    (value: boolean) => {
      const next = { ...props.playerSettings, bingeWatching: value };
      try { writeStoredPlayerSettings(next); } catch { /* ignore */ }
      void storageCtx.savePlayerSettings(next).catch(() => {
        /* cloud sync failure non-fatal — useStoredStateSync will retry */
      });
    },
    [props.playerSettings, storageCtx],
  );
  const selectedServer = props.selectedServer ?? DEFAULT_SERVER_ID;
  const setSelectedServer = (id: string) => props.onSelectServer?.(id);
  const unavailableServers = useMemo(
    () => new Set(props.unavailableServers ?? []),
    [props.unavailableServers]
  );
  // Single favorite server (bitcine-style). Persisted as part of
  // playerSettings → syncs to MongoDB via blissful-storage so the
  // user's pick follows the account across devices. Toggling the
  // heart calls savePlayerSettings; PlayerPage reads the same
  // field to seed `selectedServer` and try it first.
  const favoriteServer = props.playerSettings.favoriteServer ?? null;
  const setFavoriteServer = useCallback(
    (id: string | null) => {
      const next = { ...props.playerSettings, favoriteServer: id };
      try { writeStoredPlayerSettings(next); } catch { /* ignore */ }
      void storageCtx.savePlayerSettings(next).catch(() => {
        /* cloud sync failure non-fatal — useStoredStateSync will retry */
      });
    },
    [props.playerSettings, storageCtx]
  );
  // Same pattern as favoriteServer: a single sticky quality preference
  // (4K / 1080p / 720p / …). PlayerPage seeds the initial selection
  // from this field when the requested quality is in the resolved
  // source list. Stored in playerSettings → synced to MongoDB so the
  // choice follows the account across devices.
  const favoriteQuality = props.playerSettings.favoriteQuality ?? null;
  const setFavoriteQuality = useCallback(
    (quality: string | null) => {
      const next = { ...props.playerSettings, favoriteQuality: quality };
      try { writeStoredPlayerSettings(next); } catch { /* ignore */ }
      void storageCtx.savePlayerSettings(next).catch(() => {
        /* cloud sync failure non-fatal — useStoredStateSync will retry */
      });
    },
    [props.playerSettings, storageCtx]
  );
  // Carries the play position across a props.url swap (e.g. quality
  // change). Captured in the src effect's cleanup and consumed once in
  // onLoadedMetadata, taking precedence over startTimeSeconds for that
  // one load.
  const pendingSeekRef = useRef<number | null>(null);
  // Snapshot of the LATEST videoId, mutated during render. The HLS
  // effect's cleanup reads this to decide whether the src change
  // it's reacting to is a quality switch (same videoId → preserve
  // playback position into pendingSeekRef) or an episode change
  // (different videoId → don't carry the old episode's currentTime
  // into the new one). Mutating a ref during render is unusual but
  // it's the only way the cleanup can see the *upcoming* videoId,
  // since cleanups close over the previous render's props.
  const latestVideoIdRef = useRef<string | null>(props.videoId);
  latestVideoIdRef.current = props.videoId;
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Canonical language label of the last toast we surfaced. The
  // apply-subtitle effect re-runs whenever the track list mutates
  // (addon fetch finishes, embedded probe completes, built-in subs
  // arrive, quality swap, etc.) — and auto-pick can land on a
  // different key for the SAME language each time (e.g. an addon
  // English track first, then upgrading to the Built-in English
  // track once it loads). Deduping by KEY lets that second toast
  // through; deduping by LANGUAGE LABEL keeps the user from seeing
  // multiple "Subtitles: English" entries stacked.
  const lastToastedSubtitleLangRef = useRef<string | null>(null);
  const userPickedAudioRef = useRef(false);
  // selectedLanguage isn't rendered directly anywhere — the SettingsPanel
  // uses `selectedSubtitleKey` for highlighting. We keep the setter as
  // the cross-source language-pref cache so the addon-pick and auto-
  // pick paths can record what they chose; if the future SettingsPanel
  // wants to highlight the language row, it can promote this to a
  // proper prop.
  const [, setSelectedLanguage] = useState<string | null>(null);
  const autoPickedSubtitleKeyRef = useRef<string | null>(null);
  const autoPickAttemptsRef = useRef<Map<string, number>>(new Map());
  const isMenuOpen = settingsOpen || episodesOpen;

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

  // Per-season info from TMDB — overview + per-episode runtime /
  // description. Keyed by season number; fetched lazily when the
  // user picks a season in the drawer.
  type TmdbSeasonInfo = {
    overview: string | null;
    episodes: Record<number, { runtime: number | null; overview: string | null }>;
  };
  const [seasonInfoCache, setSeasonInfoCache] = useState<Record<number, TmdbSeasonInfo>>({});
  useEffect(() => {
    if (!episodesOpen) return;
    if (props.tmdbId == null) return;
    if (episodesSeason == null) return;
    if (seasonInfoCache[episodesSeason]) return;
    let cancelled = false;
    const season = episodesSeason;
    fetch(`/tmdb-season-info?tmdbId=${props.tmdbId}&season=${season}`)
      .then((r) => r.json())
      .then((data: { overview?: string | null; episodes?: Array<{ episode_number: number | null; runtime: number | null; overview: string | null }> }) => {
        if (cancelled) return;
        const map: TmdbSeasonInfo['episodes'] = {};
        for (const e of data.episodes ?? []) {
          if (e.episode_number != null) {
            map[e.episode_number] = { runtime: e.runtime, overview: e.overview };
          }
        }
        setSeasonInfoCache((prev) => ({
          ...prev,
          [season]: { overview: data.overview ?? null, episodes: map },
        }));
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [episodesOpen, props.tmdbId, episodesSeason, seasonInfoCache]);
  const currentSeasonInfo = episodesSeason != null ? seasonInfoCache[episodesSeason] : undefined;

  const subtitleRafRef = useRef<number | null>(null);

  // Auto-advance ("Up Next") state
  const [showUpNext, setShowUpNext] = useState(false);
  const [upNextCountdown, setUpNextCountdown] = useState(10);
  const upNextCancelledRef = useRef(false);
  const upNextFiredRef = useRef(false);

  const subtitlesKey = useMemo(() => {
    if (!props.type || !props.id) return null;
    return `${props.type}:${props.id}:${props.videoId ?? ''}`;
  }, [props.id, props.type, props.videoId]);

  // "Downloaded …" goes to the global success queue (out-of-player
  // confirmation). Everything else (Subtitles: …, Subtitles failed
  // …) renders as a small inline pill at the top of the player
  // instead — the user keeps the bottom controls in view and the
  // toast doesn't compete with them.
  useEffect(() => {
    if (!toast) return;
    if (toast.toLowerCase().includes('downloaded')) {
      notifySuccess('Player', toast);
    }
  }, [toast]);

  useEffect(() => {
    if (!error) return;
    notifyError('Playback error', error);
    setError(null);
  }, [error]);

  if (!(globalThis as any).__bliss_subtitles_cache) {
    (globalThis as any).__bliss_subtitles_cache = new Map<string, SubtitleTrack[]>();
  }

  if (!(globalThis as any).__bliss_subtitle_blob_cache) {
    (globalThis as any).__bliss_subtitle_blob_cache = new Map<string, string>();
  }

  // Remember the last played stream URL so Continue Watching reopens the same torrent.
  useEffect(() => {
    if (!props.type || !props.id) return;
    if (!props.url) return;
    // Save the SOURCE url, not the /transcode.m3u8 wrapper — a clean torrent/CDN
    // URL resumes (and cross-app syncs) without double-wrapping the transcode.
    const sourceUrl = (() => {
      const u = props.url;
      const mt = u && u.match(/^\/transcode(?:\.m3u8)?\?url=([^&]+)/);
      if (mt) { try { return decodeURIComponent(mt[1]); } catch { return u; } }
      return u;
    })();
    setLastStreamSelection({
      authKey: props.authKey,
      type: props.type,
      id: props.id,
      videoId: props.videoId,
      url: sourceUrl,
      title: props.title,
      logo: props.logo ?? null,
    });
  }, [props.id, props.logo, props.title, props.type, props.url, props.videoId]);

  useEffect(() => {
    setSubtitleSizePx(props.playerSettings.subtitlesSizePx);
    setSubtitleColor(props.playerSettings.subtitlesTextColor);
    setSubtitleBackgroundColor(props.playerSettings.subtitlesBackgroundColor);
    setSubtitleOutlineColor(props.playerSettings.subtitlesOutlineColor);
  }, [
    props.playerSettings.subtitlesBackgroundColor,
    props.playerSettings.subtitlesOutlineColor,
    props.playerSettings.subtitlesSizePx,
    props.playerSettings.subtitlesTextColor,
  ]);

  const titleLines = useMemo(() => parseTitleLines(props.title), [props.title]);
  const headerPrimary =
    props.metaTitle ?? shortenTitle(props.title) ?? titleLines.primary ?? props.title ?? 'Player';
  const subtitleLinePosition = useMemo(() => clamp(100 - subtitlePosition, 0, 100), [subtitlePosition]);

  const openInVlc = useCallback((url: string): void => {
    // iOS VLC supports x-callback URLs; on other platforms this may do nothing.
    const encoded = encodeURIComponent(url);
    try {
      window.location.href = `vlc-x-callback://x-callback-url/stream?url=${encoded}`;
      return;
    } catch {
      // ignore
    }
    try {
      window.location.href = `vlc://${url}`;
    } catch {
      // ignore
    }
  }, []);

  // iOS prompting happens before opening the player now (DetailPage).

  const selectedSubtitle = useMemo(() => {
    if (selectedSubtitleKey === 'off') return null;
    return allSubtitleTracks.find((t) => t.key === selectedSubtitleKey) ?? null;
  }, [selectedSubtitleKey, allSubtitleTracks]);

  // Dedupe by CANONICAL label so addon "ger" + embedded "deu" +
  // built-in "German" collapse into one "German" row. Pick the
  // most-mapped variant as the row's `lang` (preferring shorter
  // ISO codes when available — they survive a sub-cache round-trip
  // better than the raw display name).
  const subtitleLanguages = useMemo(() => {
    const byCanon = new Map<string, string>();
    for (const t of allSubtitleTracks) {
      const canon = subtitleLangLabel(t.lang);
      const existing = byCanon.get(canon);
      if (!existing || t.lang.length < existing.length) byCanon.set(canon, t.lang);
    }
    return Array.from(byCanon.values()).sort((a, b) => {
      const pa = langPriority(a);
      const pb = langPriority(b);
      if (pb !== pa) return pb - pa;
      return subtitleLangLabel(a).localeCompare(subtitleLangLabel(b));
    });
  }, [allSubtitleTracks]);

  // When the active stream turns out to be a Real-Debrid DMCA placeholder
  // (or otherwise broken — duration <5 min or HEAD-probe <20 MB), navigate
  // back to the detail page with `autoplay=1` so the auto-pick flow grabs
  // the next-best stream and resumes at the same offset. Carry forward
  // any existing `skip=` URLs from the current /player query AND append
  // the current dead URL so we don't bounce back into a loop. Mirrors
  // NativeMpvPlayer.autoFallbackToNextStream.
  const autoFallbackFiredRef = useRef(false);
  const autoFallbackToNextStream = useCallback(() => {
    if (autoFallbackFiredRef.current) return;
    if (!props.type || !props.id) return;
    autoFallbackFiredRef.current = true;
    const base = `/detail/${encodeURIComponent(props.type)}/${encodeURIComponent(props.id)}`;
    const qs = new URLSearchParams();
    if (props.type === 'series' && props.videoId) {
      qs.set('videoId', props.videoId);
    }
    qs.set('autoplay', '1');
    const seconds = props.startTimeSeconds && props.startTimeSeconds > 0 ? props.startTimeSeconds : 0;
    if (seconds > 0) qs.set('t', String(Math.floor(seconds)));
    const incoming = new URLSearchParams(window.location.search);
    for (const prev of incoming.getAll('skip')) qs.append('skip', prev);
    if (props.url) qs.append('skip', props.url);
    // `replace` so the dead-stream player URL is removed from history.
    navigate(`${base}?${qs.toString()}`, { replace: true });
  }, [navigate, props.type, props.id, props.videoId, props.startTimeSeconds, props.url]);

  // Pre-load HEAD probe for the Real-Debrid DMCA placeholder. Real-Debrid
  // serves a ~30 s "file removed" video (<20 MB) when a cached release
  // has been DMCA'd. Probe via the addon-proxy `/resolve-url` endpoint
  // (server-side HEAD, no CORS). Only probe HTTPS URLs (debrid CDN);
  // skip stremio-server torrent paths because their Content-Length
  // doesn't reflect the actual stream size.
  useEffect(() => {
    if (!props.url || !/^https:\/\//i.test(props.url)) return;
    let cancelled = false;
    const ac = new AbortController();
    void (async () => {
      try {
        const probe = await fetch(`/resolve-url?url=${encodeURIComponent(props.url)}`, {
          signal: ac.signal,
        });
        if (!probe.ok || cancelled) return;
        const data = (await probe.json()) as { contentLength?: number };
        const len = data.contentLength ?? 0;
        if (len > 0 && len < 20 * 1024 * 1024) {
          autoFallbackToNextStream();
        }
      } catch {
        // ignore — probe is best-effort
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [props.url, autoFallbackToNextStream]);

  // Back from the player always lands on the movie/episode's detail
  // page — never `navigate(-1)`, which would walk through whatever
  // route the user took to get here (search results, sidebar continue-
  // watching, auto-fallback chain, etc.). For series, carry the videoId
  // so the detail page opens on the right episode. Mirrors
  // NativeMpvPlayer.onBack so desktop and web behave the same.
  const onBack = useCallback(() => {
    if (!props.type || !props.id) {
      navigate(-1);
      return;
    }
    const base = `/detail/${encodeURIComponent(props.type)}/${encodeURIComponent(props.id)}`;
    if (props.type === 'series' && props.videoId) {
      navigate(`${base}?videoId=${encodeURIComponent(props.videoId)}`);
    } else {
      navigate(base);
    }
  }, [navigate, props.type, props.id, props.videoId]);

  // Skip Intro/Recap/Credits fallback: when the file's ffprobe chapters
  // carry no classifiable intro/recap/credits marker (most web releases
  // ship none), look up crowd-sourced times via /skip-times (AniSkip for
  // anime, TheIntroDB for series/movies) and synthesize boundary chapters
  // so the same skip button surfaces. Purely additive — embedded chapters
  // always win.
  const skipCurrentVideo = useMemo(
    () => props.videos?.find((v) => v.id === props.videoId) ?? null,
    [props.videos, props.videoId],
  );
  const skipImdbId = props.id && /^tt\d+$/.test(props.id) ? props.id : null;
  const skipTmdbId = props.tmdbId ?? null;
  const skipSeason = skipCurrentVideo?.season ?? null;
  const skipEpisode = skipCurrentVideo?.episode ?? null;
  const [skipChapters, setSkipChapters] = useState<Chapter[]>([]);
  useEffect(() => {
    const eligible =
      props.type === 'series' &&
      (!!skipImdbId || skipTmdbId != null) &&
      skipSeason != null &&
      skipEpisode != null &&
      duration > 0 &&
      !hasClassifiableChapter(chapters);
    if (!eligible) {
      setSkipChapters((prev) => (prev.length ? [] : prev));
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    const params = new URLSearchParams({
      season: String(skipSeason),
      episode: String(skipEpisode),
      episodeLength: String(Math.round(duration)),
    });
    if (skipImdbId) params.set('imdbId', skipImdbId);
    if (skipTmdbId != null) params.set('tmdbId', String(skipTmdbId));
    fetch(`/skip-times?${params.toString()}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((data: { intervals?: Array<{ type: 'intro' | 'recap' | 'outro'; start: number; end: number }> }) => {
        if (cancelled) return;
        const intervals = data.intervals ?? [];
        if (intervals.length === 0) {
          setSkipChapters((prev) => (prev.length ? [] : prev));
          return;
        }
        // Synthesize boundary chapters: a titled marker at each interval
        // start (classifies as intro/recap/outro) + a blank marker at its
        // end, so the skip seeks to the interval end (the hook targets the
        // next chapter's start).
        const TITLE = { intro: 'Opening', recap: 'Recap', outro: 'Ending' } as const;
        const pts: Array<{ time: number; end: number; title: string | null }> = [];
        for (const iv of intervals) {
          if (!(iv.end > iv.start)) continue;
          pts.push({ time: iv.start, end: iv.end, title: TITLE[iv.type] ?? 'Opening' });
          pts.push({ time: iv.end, end: iv.end, title: null });
        }
        pts.sort((a, b) => a.time - b.time);
        setSkipChapters(pts.map((p, i) => ({ id: i, time: p.time, end: p.end, title: p.title })));
      })
      .catch(() => {
        if (!cancelled) setSkipChapters((prev) => (prev.length ? [] : prev));
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [props.type, skipImdbId, skipTmdbId, skipSeason, skipEpisode, duration, chapters]);

  // Embedded chapters win; the /skip-times fallback only fills in when
  // they lack a classifiable intro/recap/credits marker.
  const effectiveChapters = useMemo(
    () => (hasClassifiableChapter(chapters) ? chapters : skipChapters),
    [chapters, skipChapters],
  );
  const chapterSkip = useChapterSkipWeb(videoRef, effectiveChapters, duration);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  // PiP button. Tiered so it gives a movable, cross-monitor window in as many
  // environments as possible:
  //   1. Document PiP (Chromium + secure context: https / localhost) — opens a
  //      real OS window holding Blissful's OWN player UI (custom controls,
  //      subtitles). Handled by the provider's minimize().
  //   2. Native video PiP (`video.requestPictureInPicture()`) — NOT restricted
  //      to secure contexts, so it works over plain http too (the LAN dev box,
  //      an http:// origin). A real floating window every site uses, draggable
  //      to any monitor; browser-rendered controls + <track> subtitles.
  //   3. In-page floating window — last resort (no PiP API at all).
  const onPipButton = useCallback(() => {
    if (getDocPiP()) {
      props.onMinimize?.();
      return;
    }
    const v = videoRef.current as
      | (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown>; disablePictureInPicture?: boolean })
      | null;
    if (
      v &&
      typeof v.requestPictureInPicture === 'function' &&
      typeof document !== 'undefined' &&
      document.pictureInPictureEnabled &&
      !v.disablePictureInPicture
    ) {
      v.requestPictureInPicture().catch(() => props.onMinimize?.());
      return;
    }
    props.onMinimize?.();
  }, [props]);

  // Plain unmuted autoplay. If the browser blocks it (e.g. iOS
  // without a fresh user gesture) the video stays paused and the
  // user taps the native play affordance — never muted, never an
  // overlay. Per user spec.
  const playWithAutoplayFallback = useCallback((video: HTMLVideoElement) => {
    const p = video.play();
    if (!p || typeof (p as Promise<void>).then !== 'function') return;
    (p as Promise<void>).catch(() => {
      /* autoplay blocked — leave paused */
    });
  }, []);

  // iOS Safari has no Document fullscreen API on regular elements
  // — only `video.webkitEnterFullscreen()`, which hands the
  // playback over to the native AVPlayer fullscreen UI. That's
  // what every web video site does on iOS (bitcine, YouTube,
  // Vimeo), so match the convention even though we lose our
  // custom controls in fullscreen there.
  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    const video = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitExitFullscreen?: () => void;
      webkitDisplayingFullscreen?: boolean;
    }) | null;

    // iOS Safari path — only the video element supports fullscreen.
    if (video && typeof video.webkitEnterFullscreen === 'function') {
      try {
        if (video.webkitDisplayingFullscreen) {
          video.webkitExitFullscreen?.();
        } else {
          video.webkitEnterFullscreen();
        }
        return;
      } catch {
        /* fall through to Document API */
      }
    }

    // Desktop / Android Chrome path.
    const docFs = document.fullscreenElement || (document as any).webkitFullscreenElement;
    if (docFs) {
      void (document.exitFullscreen?.() ?? (document as any).webkitExitFullscreen?.());
      return;
    }
    const root = document.documentElement as any;
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (req) {
      try {
        req.call(root);
      } catch { /* unsupported */ }
    }
  }, []);

  // Fetch subtitles from addons (best effort)
  useEffect(() => {
    const type = props.type;
    const baseId = props.videoId ?? props.id;
    if (!type || !baseId) {
      setSubtitleTracks([]);
      setSelectedSubtitleKey('off');
      setSelectedLanguage(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setSubtitleTracks([]);
    setSelectedSubtitleKey('off');
    userPickedSubtitleRef.current = false;
    setSelectedLanguage(null);

    // Fast path: warm cache from previous plays.
    if (subtitlesKey) {
      try {
        const cached = ((globalThis as any).__bliss_subtitles_cache as Map<string, SubtitleTrack[]>).get(subtitlesKey);
        if (cached && cached.length > 0) {
          setSubtitleTracks(cached);
          const savedLang = (() => {
            try {
              return window.localStorage.getItem('blissful.subtitleLang');
            } catch {
              return null;
            }
          })();
          const preferredLang =
            findMatchingLanguage(cached, props.playerSettings.subtitlesLanguage) ??
            (savedLang ? findMatchingLanguage(cached, savedLang) : null) ??
            cached.find((t) => /^(en|eng|english)$/i.test(t.lang))?.lang ??
            cached[0].lang;
          setSelectedLanguage(preferredLang);
          const sortedCached = cached
            .filter((t) => t.lang === preferredLang)
            .slice()
            .sort((a, b) => {
              const sa = scoreSubtitleTrack(a);
              const sb = scoreSubtitleTrack(b);
              if (sb !== sa) return sb - sa;
              return a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label);
            });
          const preferredTrack = sortedCached[0];
          if (preferredTrack) {
            autoPickedSubtitleKeyRef.current = preferredTrack.key;
            setSelectedSubtitleKey(preferredTrack.key);
          }
        }
      } catch {
        // ignore
      }
    }

    void (async () => {
      const addonPriority = (addon: AddonDescriptor): number => {
        const name = (addon.manifest?.name ?? '').toLowerCase();
        const url = addon.transportUrl.toLowerCase();
        if (name.includes('subtitles') || url.includes('subtitles')) return 3;
        if (name.includes('opensubtitles') || url.includes('opensubtitles')) return 3;
        return 0;
      };

      const savedLang = (() => {
        try {
          return window.localStorage.getItem('blissful.subtitleLang');
        } catch {
          return null;
        }
      })();

      const getPreferredLang = (list: SubtitleTrack[]): string => {
        const settingsHit = findMatchingLanguage(list, props.playerSettings.subtitlesLanguage);
        const savedHit = savedLang ? findMatchingLanguage(list, savedLang) : null;
        return settingsHit ?? savedHit ?? list.find((t) => /^(en|eng|english)$/i.test(t.lang))?.lang ?? list[0].lang;
      };

      const uniq = new Map<string, SubtitleTrack>();
      let flushTimer: number | null = null;
      const flush = () => {
        flushTimer = null;
        if (cancelled) return;
        const list = Array.from(uniq.values());
        setSubtitleTracks(list);

        if (subtitlesKey) {
          try {
            ((globalThis as any).__bliss_subtitles_cache as Map<string, SubtitleTrack[]>).set(subtitlesKey, list);
          } catch {
            // ignore
          }
        }
        if (list.length === 0) return;
        if (userPickedSubtitleRef.current) return;

        const preferredLang = getPreferredLang(list);
        setSelectedLanguage(preferredLang);
        const sortedList = list
          .filter((t) => t.lang === preferredLang)
          .slice()
          .sort((a, b) => {
            const sa = scoreSubtitleTrack(a);
            const sb = scoreSubtitleTrack(b);
            if (sb !== sa) return sb - sa;
            return a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label);
          });
        const preferredTrack = sortedList[0];
        if (preferredTrack) {
          autoPickedSubtitleKeyRef.current = preferredTrack.key;
          setSelectedSubtitleKey(preferredTrack.key);
        }
      };

      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = window.setTimeout(flush, 50);
      };

      const addons = props.addons
        .filter((addon) => {
          const resources = addon.manifest?.resources;
          if (!resources || resources.length === 0) return true;
          return resources.some((entry) => {
            if (typeof entry === 'string') return entry === 'subtitles';
            if (entry.name !== 'subtitles') return false;
            if (entry.types && entry.types.length > 0 && !entry.types.includes(type)) return false;
            if (entry.idPrefixes && entry.idPrefixes.length > 0) {
              return entry.idPrefixes.some((prefix) => baseId.startsWith(prefix));
            }
            return true;
          });
        })
        .slice()
        .sort((a, b) => addonPriority(b) - addonPriority(a));

      // Compute the OpenSubtitles 8-byte hash so hash-aware addons
      // (OpenSubtitles v3) return perfectly synced subs. Reads first +
      // last 64KB of the stream via the streaming-server's /opensubHash
      // endpoint. For torrents, the tail piece arrives late, so we
      // retry every 2s for up to 10s. Best-effort — falls back to
      // hashless query on failure.
      let hashInfo: { hash: string; size: number } | null = null;
      const hashSourceUrl = isHttpUrl(props.url) ? props.url : null;
      if (hashSourceUrl) {
        const deadline = Date.now() + 10000;
        while (!cancelled && Date.now() < deadline) {
          hashInfo = await fetchOpenSubHash(hashSourceUrl, controller.signal).catch(() => null);
          if (hashInfo) break;
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        }
      }
      if (cancelled) return;

      // Hardcoded OpenSubtitles v3 fetch — runs whether or not the
      // user has the addon installed in Stremio. The addon-proxy
      // bypasses CORS, the v3 endpoint follows the Stremio addon
      // protocol so `fetchSubtitles({ baseUrl })` works as-is, and
      // the `origin: 'OpenSubtitles'` tag drives the yellow
      // "OpenSubs" chip in the variants drill-down.
      const OPENSUBS_BASE = 'https://opensubtitles-v3.strem.io';
      const OPENSUBS_KEY = `${OPENSUBS_BASE}::built-in`;
      const fetchOpenSubs = async () => {
        try {
          const osQs = new URLSearchParams({ type: String(type), id: baseId });
          if (hashInfo?.hash) {
            osQs.set('videoHash', hashInfo.hash);
            osQs.set('videoSize', String(hashInfo.size));
          }
          // Server-side cached + retried OpenSubtitles. The community addon 504s
          // often, so the proxy waits longer than the browser's 8s can afford and
          // persists the result to NAS — later plays are instant and survive the
          // addon's frequent outages (a fresh web session otherwise gets nothing
          // while a desktop app shows stale in-memory cache).
          const osRes = await fetch(`/opensubs?${osQs.toString()}`, { signal: controller.signal });
          if (!osRes.ok) return;
          const resp = (await osRes.json()) as { subtitles?: Array<{ id?: string; lang?: string; url?: string }> };
          for (const sub of resp.subtitles ?? []) {
            if (!sub?.url) continue;
            const lang = sub.lang ?? 'unknown';
            if (!uniq.has(sub.url)) {
              uniq.set(sub.url, {
                key: `${OPENSUBS_KEY}::${sub.id ?? sub.url}`,
                lang,
                label: sub.lang ?? 'Subtitles',
                origin: 'OpenSubtitles',
                url: sub.url,
              });
              scheduleFlush();
            }
          }
        } catch {
          // Network / CORS / 5xx — silent fail, the addon list below
          // can still surface results from other sources if any.
        }
      };

      await Promise.allSettled([
        fetchOpenSubs(),
        ...addons.map(async (addon) => {
          const baseUrl = addon.transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
          const origin = addon.manifest?.name ?? addon.transportUrl;
          const resp = await fetchSubtitles({
            type: type as any,
            id: baseId,
            baseUrl,
            signal: controller.signal,
            videoHash: hashInfo?.hash,
            videoSize: hashInfo?.size,
          });
          for (const sub of resp.subtitles ?? []) {
            if (!sub?.url) continue;
            const lang = sub.lang ?? 'unknown';
            if (!uniq.has(sub.url)) {
              uniq.set(sub.url, {
                key: `${addon.transportUrl}::${sub.id ?? sub.url}`,
                lang,
                label: sub.lang ?? 'Subtitles',
                origin,
                url: sub.url,
              });
              scheduleFlush();
            }
          }
        }),
      ]);

      if (flushTimer) {
        window.clearTimeout(flushTimer);
        flush();
      } else {
        flush();
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  // `props.url` is intentionally omitted: it's only read inside the
  // effect for the OpenSubtitles hash, and the addon subtitle list is
  // keyed by episode (props.id / props.videoId). Including it would
  // re-trigger this effect every time `playUrl` changes mid-playback
  // (quality switch, hls.js retry, fallback URL swap, etc.) — wiping
  // `selectedSubtitleKey` back to 'off' and making the user's subtitle
  // selection vanish after a transient stream error.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.addons, props.id, props.type, props.videoId, props.playerSettings.subtitlesLanguage]);

  // Probe the resolved stream URL for embedded subtitle tracks via the addon-proxy's
  // ffprobe/ffmpeg endpoints. Text-based codecs (subrip, ass, mov_text, etc.) get added
  // to the picker; bitmap subs (PGS, VobSub) are skipped — no in-browser OCR.
  useEffect(() => {
    // playUrl may be wrapped as `/transcode.m3u8?url=<encoded source>` (RD
    // .mkv → HLS remux). The embedded-subtitle probe + /extract-subtitle.vtt
    // must run against the RAW source, not the transcode endpoint — unwrap it.
    const probeTarget = (() => {
      const u = props.url || '';
      if (u.includes('/transcode')) {
        const m = u.match(/[?&]url=([^&]+)/);
        if (m) {
          try {
            const inner = decodeURIComponent(m[1]);
            return isHttpUrl(inner) ? inner : null;
          } catch { return null; }
        }
        return null;
      }
      return isHttpUrl(u) ? u : null;
    })();
    if (!probeTarget) {
      setEmbeddedSubtitleTracks([]);
      setChapters([]);
      setVideoInfo(null);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setEmbeddedSubtitleTracks([]);
    setChapters([]);
    setVideoInfo(null);
    void (async () => {
      try {
        const resp = await fetch(`/probe-streams?url=${encodeURIComponent(probeTarget)}`, {
          signal: ac.signal,
        });
        if (!resp.ok || cancelled) return;
        const data = (await resp.json()) as {
          subtitles?: Array<{
            index: number;
            codec: string;
            language: string;
            title: string | null;
            forced: boolean;
            default: boolean;
            textBased: boolean;
          }>;
          chapters?: Chapter[];
          video?: {
            width: number | null;
            height: number | null;
            codec: string | null;
            bitDepth: number | null;
            colorTransfer: string | null;
            colorPrimaries: string | null;
            isHdr: boolean;
            is4k: boolean;
          } | null;
        };
        if (cancelled) return;
        const tracks: SubtitleTrack[] = (data.subtitles ?? [])
          .filter((s) => s.textBased)
          .map((s) => {
            const lang = (s.language || 'und').toLowerCase();
            const baseLabel = subtitleLangLabel(lang);
            const label = s.title ? `${baseLabel} – ${s.title}` : baseLabel;
            return {
              key: `embedded:${s.index}`,
              lang,
              label,
              origin: 'Embedded',
              url: `/extract-subtitle.vtt?url=${encodeURIComponent(probeTarget)}&track=${s.index}`,
            };
          });
        setEmbeddedSubtitleTracks(tracks);
        setChapters(data.chapters ?? []);
        if (data.video) {
          setVideoInfo({
            width: data.video.width,
            height: data.video.height,
            codec: data.video.codec,
            colorTransfer: data.video.colorTransfer,
            isHdr: data.video.isHdr,
            is4k: data.video.is4k,
          });
        }
      } catch {
        // ignore — probe is best-effort
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [props.url]);

  // Auto-pick a subtitle whenever tracks change. Runs over the
  // MERGED set (addon + embedded + built-in). If an embedded /
  // Built-in variant arrives AFTER an addon-fetched one was already
  // auto-picked, this swap upgrades to the higher-priority track —
  // matches the Windows app, where embedded always wins.
  // Skipped only if the user made a manual pick this session.
  useEffect(() => {
    if (userPickedSubtitleRef.current) return;
    if (allSubtitleTracks.length === 0) return;
    const savedLang = (() => {
      try { return window.localStorage.getItem('blissful.subtitleLang'); } catch { return null; }
    })();
    // Try preferred language first (from settings → saved → English
    // pattern). If nothing matches AND we have an embedded text sub,
    // fall back to it — pirate-source MKVs almost always embed an
    // English/forced sub tagged `und` (undetermined), which our
    // exact language match would otherwise filter out, leaving the
    // user with no subs at all on the Real-Debrid stream.
    const preferredLang =
      findMatchingLanguage(allSubtitleTracks, props.playerSettings.subtitlesLanguage) ??
      (savedLang ? findMatchingLanguage(allSubtitleTracks, savedLang) : null) ??
      allSubtitleTracks.find((t) => /^(en|eng|english)$/i.test(t.lang))?.lang ??
      allSubtitleTracks.find((t) => isEmbeddedOrigin(t.origin))?.lang ??
      allSubtitleTracks[0].lang;
    const targetCanon = subtitleLangLabel(preferredLang);
    const best = allSubtitleTracks
      .filter((t) => subtitleLangLabel(t.lang) === targetCanon)
      .slice()
      .sort((a, b) => {
        const sa = scoreSubtitleTrack(a);
        const sb = scoreSubtitleTrack(b);
        if (sb !== sa) return sb - sa;
        return a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label);
      })[0];
    if (!best) return;
    if (best.key === selectedSubtitleKey) return;
    setSelectedLanguage(preferredLang);
    autoPickedSubtitleKeyRef.current = best.key;
    setSelectedSubtitleKey(best.key);
  }, [allSubtitleTracks, props.playerSettings.subtitlesLanguage, selectedSubtitleKey]);

  // Load src + apply start time
  // Reset the retry counter whenever the caller hands us a genuinely
  // new stream (props.url change). Bumps to `retryNonce` from inside
  // scheduleStreamRetry should NOT reset — that would loop forever.
  useEffect(() => {
    streamRetriesRef.current = 0;
  }, [props.url]);

  useEffect(() => {
    setError(null);
    startAppliedRef.current = false;

    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Clear the video element's `currentTime` between sources.
    // Without this the element retains the previous episode's
    // position, and in a watch-party context the host's 1Hz
    // `host:tick` keeps broadcasting that stale time before the
    // new HLS source finishes loading — guests then snap to (e.g.)
    // 20:00 on a freshly-started episode. If a real `?t=` resume
    // was requested, the loadedmetadata handler below will seek
    // to it AFTER this reset, so legit resumes are unaffected.
    try {
      video.currentTime = 0;
    } catch {
      // Pre-metadata seek can throw on some browsers — harmless.
    }

    // Placeholder URL = "still resolving via Videasy" (set by
    // PlayerPage between episodes). Hold here without loading
    // anything so the BlissfulPlayer component — and the
    // watch-party WS connection it owns — stays alive across
    // episode transitions. When the real URL arrives, this effect
    // re-runs and the loader below kicks in normally.
    if (!props.url || /^(vidking|videasy):/i.test(props.url)) {
      // Reset the first-frame gate so the in-player buffering
      // overlay shows again until the new episode actually paints.
      firstFrameSeenRef.current = false;
      setFirstFrameSeen(false);
      return;
    }

    const onLoadedMetadata = () => {
      // Post-load duration safety net for Real-Debrid DMCA placeholders
      // that slipped past the HEAD probe (e.g., recently-removed releases
      // whose Content-Length isn't yet < 20 MB). A real movie/episode is
      // never under 5 minutes; if we see one, fall back to the next stream.
      // Mirrors NativeMpvPlayer's duration safety net.
      if (
        /^https:\/\//i.test(props.url) &&
        Number.isFinite(video.duration) &&
        video.duration > 0 &&
        video.duration < 300
      ) {
        autoFallbackToNextStream();
        return;
      }
      if (startAppliedRef.current) return;
      startAppliedRef.current = true;
      try {
        const limit = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 1) : Infinity;
        // Quality switch (or any other src swap mid-playback) takes
        // precedence over startTimeSeconds for this load.
        if (pendingSeekRef.current != null && pendingSeekRef.current > 0) {
          video.currentTime = clamp(pendingSeekRef.current, 0, limit);
          pendingSeekRef.current = null;
          return;
        }
        if (!props.startTimeSeconds || props.startTimeSeconds <= 0) return;
        video.currentTime = clamp(props.startTimeSeconds, 0, limit);
      } catch {
        // ignore
      }
    };

    const onError = () => {
      // Surface the actual MediaError code so iOS issues can be
      // diagnosed (code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED is the one
      // AVPlayer typically uses for stricter HLS rejections).
      const err = video.error;
      playerLog(
        `[player] <video> error code=${err?.code ?? '?'} msg="${err?.message ?? ''}" src=${(props.url ?? '').slice(0, 120)}`
      );
      // Mobile / web: transient errors (cellular blip, segment 502)
      // shouldn't surface as a permanent error. Retry the load a few
      // times with backoff before giving up.
      scheduleStreamRetry();
    };

    const onPlay = () => {
      setIsPlaying(true);
      setHasPlayedOnce(true);
      setIsBuffering(false);
      // Successful playback resets the transient-error budget so a
      // later blip gets the full retry allowance, not whatever's
      // left over from earlier in the session.
      streamRetriesRef.current = 0;
    };
    const onPause = () => {
      setIsPlaying(false);
      flushNow(); // Flush progress to localStorage immediately on pause
    };
    const onTime = () => {
      const t = video.currentTime || 0;
      setCurrentTime(t);
      // First time the video advances past 0 → real frames are
      // painting. Hide BlissfulPlayer's internal buffer UI so the
      // video underneath becomes visible.
      if (t > 0 && !firstFrameSeenRef.current) {
        firstFrameSeenRef.current = true;
        setFirstFrameSeen(true);
      }
    };
    const onDuration = () => setDuration(video.duration || 0);
    const onVolume = () => {
      setVolume(video.volume ?? 1);
      setMuted(Boolean(video.muted));
    };
    // Stremio's exact buffering model: readyState < HAVE_FUTURE_DATA means buffering.
    // Checked on every event that might change the buffering state.
    const checkBuffering = () => {
      setIsBuffering(video.readyState < video.HAVE_FUTURE_DATA);
    };

    // `emptied` fires whenever the MediaSource is detached/reattached
    // — most commonly when hls.js calls recoverMediaError on a
    // bufferAppendError. The browser wipes textTracks, so the
    // previously attached <track> stops rendering subtitles. Bumping
    // this nonce makes the subtitle-apply effect re-run and re-attach.
    const onEmptied = () => {
      setSubtitleReattachNonce((n) => n + 1);
    };
    // Auto-pick can land on a track BEFORE the video has any metadata
    // (HLS still attaching, src not parsed yet). The <track> element
    // is added but its underlying TextTrack hasn't materialized, so
    // `mode = 'showing'` no-ops and the cues never render. Once the
    // video reports `loadedmetadata`, the textTrack is ready — bump
    // the reattach nonce so the subtitle effect re-runs and this time
    // the showing flag sticks. (Manual picks didn't see this bug
    // because the user only opens the picker AFTER playback starts.)
    const onSubtitleMetadataReady = () => {
      setSubtitleReattachNonce((n) => n + 1);
    };

    video.volume = volume;
    video.muted = muted;
    video.addEventListener('emptied', onEmptied);
    video.addEventListener('loadedmetadata', onSubtitleMetadataReady);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onError);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('volumechange', onVolume);
    // Stremio triggers buffering re-check on all of these:
    video.addEventListener('waiting', checkBuffering);
    video.addEventListener('playing', checkBuffering);
    video.addEventListener('stalled', checkBuffering);
    video.addEventListener('canplay', checkBuffering);
    video.addEventListener('canplaythrough', checkBuffering);
    video.addEventListener('loadeddata', checkBuffering);
    video.addEventListener('seeking', checkBuffering);
    video.addEventListener('seeked', checkBuffering);

    // Diagnostic: log every load-pipeline event with timing so we can see
    // exactly where Chromium stalls.
    const tStart = performance.now();
    const logEv = (ev: string) => {
      playerLog(`[player] +${(performance.now() - tStart).toFixed(0)}ms <video> ${ev} readyState=${video.readyState} networkState=${video.networkState}`);
    };
    const diag = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting', 'stalled', 'suspend', 'progress', 'error', 'abort', 'emptied', 'seeking', 'seeked'];
    const diagListeners = diag.map((name) => {
      const fn = () => logEv(name);
      video.addEventListener(name, fn);
      return [name, fn] as const;
    });

    const src = props.url;

    // Our /hls-master proxy URL has the actual `.m3u8` inside a
    // URL-encoded `url=` query param, so a literal `.includes('.m3u8')`
    // check won't match. Detect it explicitly — without this, the src
    // gets routed through native HLS and the browser silently drops
    // the video track on HEVC Main 10 4K streams (audio plays, no
    // picture). Videasy's player works because they always go through
    // MSE/hls.js (their `<video>` src is a blob URL).
    const isHls =
      src.startsWith('blob:')
      || src.includes('.m3u8')
      || src.includes('/hlsv2/')
      || src.includes('/hls-master');
    const hasNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
    // iOS Safari's native HLS (AVPlayer) is stricter than hls.js —
    // it refuses Videasy's media-playlist-only streams (no master
    // playlist with #EXT-X-STREAM-INF codec hints) and surfaces as
    // a generic "Unable to play". Force the hls.js path whenever
    // it's available, even where native HLS exists. Falls back to
    // native only on iOS versions that have neither MSE nor
    // ManagedMediaSource (i.e. pre-iOS 17.1 in Safari).
    // `/party-relay` (watch-party Layer B host relay) and any direct
    // stremio-service `/hlsv2` stream are split-rendition fMP4 masters
    // (separate video0/audio0, no CODECS attr) that the browser's NATIVE
    // HLS player can't assemble — it picks one rendition, fails to append,
    // and dies with MEDIA_ERR code 4. hls.js handles them (it derives codecs
    // from the init segments), so force it just like the other proxied HLS.
    const isProxiedHls =
      isHls && (src.includes('/addon-proxy') || src.includes('/hls-master') || src.includes('/transcode')
        || src.includes('/party-relay') || src.includes('/hlsv2/'));
    const shouldUseHlsJs =
      isHls && Hls.isSupported() && (!hasNativeHls || isProxiedHls);
    playerLog(
      `[player] route hls=${isHls} hlsSupported=${Hls.isSupported()} ` +
        `nativeHls=${hasNativeHls} proxied=${isProxiedHls} useHlsJs=${shouldUseHlsJs}`
    );

    setSelectedAudioTrackId(null);
    let nativeAudioTrackList: NativeAudioTrackList | null = null;
    const updateNativeAudioTracks = () => {
      setSelectedAudioTrackId(getSelectedNativeAudioTrackId(video));
    };

    if (shouldUseHlsJs) {
      // hls.js config. Two flags were previously enabled "for HEVC Main
      // 10 streams" (copied from vidking.net's player) but turned out to
      // do nothing for our actual content and to trigger an internal
      // race in hls.js's BufferController for MPEG-TS sources:
      //
      //   - `progressive: true`  — only affects fMP4 streaming-append
      //     paths, which we don't use (Videasy ships MPEG-TS). With it
      //     on, the buffer controller can append after the SourceBuffer
      //     was removed, surfacing as `HlsJsTrackRemovedError` →
      //     `bufferAppendError` → `recoverMediaError` → visible reload.
      //   - `forceKeyFrameOnDiscontinuity: true` — relevant only to
      //     streams with discontinuity markers (live ads, multi-period
      //     DASH). Videasy VOD has none. Enabling it also widens the
      //     same race window.
      //
      // Buffer ceilings were also way too generous: 300 MB / 5-min
      // each direction exceeds Chrome's per-buffer MSE quota (~150 MB
      // for video), so every minute we'd hit a QuotaExceededError +
      // eviction-during-append, another race-condition trigger. Tuning
      // down to a single-VOD-friendly 90 s ahead / 90 s back.
      // Layer B relay: start hls.js DIRECTLY at the host's position so its FIRST
      // segment fetch is the seek target — not segment1. Fetching segment1 first
      // anchors stremio's live transcode at 0:00; the later currentTime seek then
      // fights it (you see it hit the host's spot, then fall back to playing from
      // the start — segments 1,428,429,6,7,8…). startPosition makes the transcode
      // begin where the host actually is. Non-relay sources keep -1 (auto).
      const relayStartPosition =
        src.includes('/party-relay') && props.startTimeSeconds && props.startTimeSeconds > 0
          ? props.startTimeSeconds
          : -1;
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        startPosition: relayStartPosition,
        lowLatencyMode: false,
        // Lets hls.js pick ManagedMediaSource on iOS 17.1+ — the
        // route that makes Videasy streams playable on iPhone /
        // iPad Safari without going through the strict native
        // AVPlayer pipeline.
        preferManagedMediaSource: true,
        testBandwidth: false,
        startFragPrefetch: true,
        stretchShortVideoTrack: true,
        abrMaxWithRealBitrate: true,
        capLevelToPlayerSize: true,
        autoStartLoad: true,
        initialLiveManifestSize: 1,
        startLevel: -1,
        maxStarvationDelay: 10,
        maxLoadingDelay: 10,
        maxBufferSize: 60 * 1024 * 1024,
        maxBufferLength: 90,
        maxMaxBufferLength: 120,
        backBufferLength: 90,
        abrEwmaDefaultEstimate: 5_000_000,
        abrEwmaFastLive: 2,
        abrEwmaSlowLive: 5,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 6,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 6,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        },
      });
      hlsRef.current = hls;
      // Watch-party relay: count manifest reloads triggered by transient tunnel
      // 404s so a genuinely dead relay can't loop forever (reset on success).
      let relayReloadCount = 0;
      // Consecutive fragment-load timeouts without a completed fragment.
      // Videasy serves each quality as its OWN single-level playlist, so
      // hls.js has no ABR ladder to step down when one tier is throttled
      // (the 4K cdn1 bucket sometimes crawls at KB/s while 1080p stays
      // fast) — it just retries the same fragment forever. We count the
      // 20s timeouts and swap down a quality ourselves.
      let fragTimeoutCount = 0;
      // Fatal network errors without a completed fragment in between —
      // a Videasy source whose segment-host pool died mid-session (fast
      // 504s from the proxy's failover, not slow timeouts, so the frag-
      // timeout counter above never sees them). Two of these hand the
      // source to the page's fallback instead of retrying forever.
      let videasyFatalNetCount = 0;

        const selectAudioTrack = (trackIndex: number) => {
          if (!Number.isFinite(trackIndex) || trackIndex < 0) return;
          try {
            if (hls.audioTrack !== trackIndex) hls.audioTrack = trackIndex;
          } catch {
            // HLS.js may reject selection during teardown.
          }
          setSelectedAudioTrackId(`hls:${trackIndex}`);
        };

        const updateTracks = () => {
          const tracks = (hls.audioTracks ?? []) as unknown as HlsAudioTrack[];
          if (tracks.length === 0) {
            setSelectedAudioTrackId(null);
            return;
          }
          const current = hls.audioTrack;
          // Default the audio language to English when the profile has no
          // explicit preference (mirrors mpv's `alang=eng,en` fallback on
          // desktop and the TV app's `audioLanguage ?? 'English'`), so a
          // multi-audio file lands on the English track out of the box rather
          // than whatever track the file happens to list first.
          if (!userPickedAudioRef.current) {
            const audioPref = props.playerSettings.audioLanguage ?? 'eng';
            const preferred = tracks.findIndex((track) =>
              languageMatch(audioPref, track.lang ?? track.name ?? '')
            );
            if (preferred >= 0) {
              selectAudioTrack(preferred);
              return;
            }
          }
          selectAudioTrack(Number.isFinite(current) && current >= 0 ? current : 0);
        };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        relayReloadCount = 0;
        updateTracks();
        playWithAutoplayFallback(video);
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        fragTimeoutCount = 0;
        videasyFatalNetCount = 0;
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        updateTracks();
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_evt, data) => {
        if (Number.isFinite(data.id) && data.id >= 0) {
          setSelectedAudioTrackId(`hls:${data.id}`);
        }
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        // Pick the best alternate quality — shared by the codec-error and
        // frag-timeout fallbacks. 1080p first (best still-smooth tier),
        // then down the ladder, then anything that isn't the current one.
        const pickLowerQuality = () => {
          const opts = qualityOptionsRef.current ?? [];
          const current = selectedQualityRef.current;
          const byLabel = (needle: string) =>
            opts.find((o) => o.quality.toLowerCase().includes(needle) && o.quality !== current);
          return byLabel('1080p') ?? byLabel('720p') ?? byLabel('480p')
            ?? opts.find((o) => o.quality !== current);
        };
        // A tier whose fragments keep hitting the 20s load timeout is
        // throttled upstream, not blipping — retrying it can never finish.
        // Swap to a lower quality so the user keeps watching.
        const swapDownForStall = (): boolean => {
          if (src.includes('/party-relay')) return false; // guests follow the host's stream
          const fallback = pickLowerQuality();
          if (!fallback || !onSelectQualityRef.current) return false;
          playerLog(`[player] frag timeouts on ${selectedQualityRef.current ?? '?'} — switching to ${fallback.quality}`);
          notifyError(
            `${selectedQualityRef.current ?? 'This'} stream is too slow`,
            `The CDN can't keep up. Switched to ${fallback.label}.`
          );
          onSelectQualityRef.current(fallback.quality);
          try { hls.destroy(); } catch { /* ignore */ }
          if (hlsRef.current === hls) hlsRef.current = null;
          return true;
        };
        if (!data.fatal) {
          // Each frag timeout is already a 20s stall (fragLoadingTimeOut);
          // two in a row without a completed fragment means the tier is
          // dead-slow. Don't sit through all 6 retries (~2min) waiting for
          // the fatal — swap down now.
          if (data.details === 'fragLoadTimeOut') {
            fragTimeoutCount += 1;
            if (fragTimeoutCount >= 2) swapDownForStall();
          }
          return;
        }
        // Surface every fatal HLS error to the log so we can correlate
        // mid-playback reloads (`emptied` → `loadstart`) with their root
        // cause. Dump as much of hls.js's ErrorData as we can to pin
        // down which segment failed and why — critical for diagnosing
        // bufferAppendError (transient corruption vs PTS discontinuity
        // vs structural mismatch all look the same without details).
        const d = data as typeof data & {
          frag?: { url?: string; sn?: number | string; level?: number; duration?: number; type?: string };
          parent?: string;
          sourceBufferName?: string;
          mimeType?: string;
          bytes?: number;
          error?: Error;
          response?: { code?: number; text?: string };
          event?: string;
        };
        const fragUrl = d.frag?.url ? d.frag.url.slice(-80) : null;
        const parts = [
          `type=${data.type}`,
          `details=${data.details}`,
          d.event ? `event=${d.event}` : null,
          d.parent ? `parent=${d.parent}` : null,
          d.sourceBufferName ? `buf=${d.sourceBufferName}` : null,
          d.mimeType ? `mime=${d.mimeType}` : null,
          d.bytes != null ? `bytes=${d.bytes}` : null,
          d.frag?.sn != null ? `sn=${d.frag.sn}` : null,
          d.frag?.level != null ? `lvl=${d.frag.level}` : null,
          d.frag?.duration != null ? `dur=${d.frag.duration.toFixed(2)}` : null,
          d.response?.code != null ? `httpStatus=${d.response.code}` : null,
          d.error?.name ? `errName=${d.error.name}` : null,
          d.error?.message ? `errMsg="${d.error.message.slice(0, 200)}"` : null,
          (data as { reason?: string }).reason ? `reason=${(data as { reason?: string }).reason}` : null,
          fragUrl ? `fragUrl=…${fragUrl}` : null,
          (data as { url?: string }).url ? `url=…${(data as { url?: string }).url!.slice(-80)}` : null,
        ].filter(Boolean);
        playerLog(`[player] hls fatal err ${parts.join(' ')}`);
        // Codec-not-supported (typically 4K HEVC on a browser without
        // hardware HEVC — Chrome/Firefox refuse to attach a source
        // buffer for hvc1/hev1). `recoverMediaError` can't fix this —
        // it'd just loop. Instead, swap to a lower quality so the
        // user actually keeps watching.
        if (data.details === 'bufferAddCodecError') {
          const mime = d.mimeType ?? '';
          if (/hvc1|hev1/i.test(mime)) {
            const fallback = pickLowerQuality();
            if (fallback && onSelectQualityRef.current) {
              notifyError(
                '4K not supported on this browser',
                `Couldn't decode the HEVC stream. Switched to ${fallback.label}.`
              );
              onSelectQualityRef.current(fallback.quality);
              try { hls.destroy(); } catch { /* ignore */ }
              if (hlsRef.current === hls) hlsRef.current = null;
              return;
            }
          }
        }
        // Real-Debrid "not cached yet": the proxy returned 409 instead of
        // transcoding the ElfHosted "not ready" slate. Tell the user + open the
        // Releases picker so they can choose another (cached) torrent.
        if (d.response?.code === 409) {
          playerLog('[player] transcode 409 — torrent not cached on RD');
          notifyError('Not cached on Real-Debrid yet', 'This torrent isn’t ready on debrid — pick another release.');
          setError('Not cached — pick another release');
          try { hls.destroy(); } catch { /* ignore */ }
          if (hlsRef.current === hls) hlsRef.current = null;
          if (!partyNonHostRef.current) {
            if ((releasesRef.current?.length ?? 0) > 0) {
              setSettingsTab('releases');
              setSettingsOpen(true);
            } else {
              // Releases haven't resolved yet — opening now would show an
              // empty drawer. Defer until the list arrives.
              pendingReleasesOpenRef.current = true;
            }
          }
          return;
        }
        // Watch-party relay: the host's tunnel can briefly drop (reconnect /
        // idle), so a playlist fetch may 404 for ~2s. hls.js marks a manifest /
        // level load error fatal, and `startLoad()` can't re-fetch a manifest it
        // never parsed — so the guest sticks on a black buffering screen. Reload
        // the source after a short delay (the tunnel reconnects) instead of
        // giving up; cap attempts so a genuinely dead relay falls through to the
        // normal teardown/fallback.
        if (
          src.includes('/party-relay')
          && relayReloadCount < 10
          && (data.details === 'manifestLoadError'
            || data.details === 'manifestLoadTimeOut'
            || data.details === 'manifestParsingError'
            || data.details === 'levelLoadError'
            || data.details === 'levelLoadTimeOut')
        ) {
          relayReloadCount += 1;
          playerLog(`[player] relay manifest err (${data.details}) — reload in 3s #${relayReloadCount}`);
          window.setTimeout(() => {
            try { hls.loadSource(src); hls.startLoad(); } catch { /* torn down */ }
          }, 3000);
          return;
        }
        // Fatal frag timeout: hls.js already burned all 6 in-policy retries
        // (~2min of stall) — backstop in case the non-fatal counter above
        // didn't catch it (e.g. timeouts interleaved with loaded fragments).
        if (data.details === 'fragLoadTimeOut' && swapDownForStall()) return;
        // Videasy source with recurring fatal network errors: the segment
        // CDN died mid-session (hosts drop out of the pool while a stream
        // plays). startLoad() would retry into the same dead pool forever,
        // and quality swaps don't help — every tier shares the pool. Hand
        // the source to the page, which swaps in the RD fallback.
        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR
          && src.includes('vd=1')
          && !src.includes('/party-relay')
        ) {
          videasyFatalNetCount += 1;
          if (videasyFatalNetCount >= 2 && onSourceDeadRef.current?.(src)) {
            playerLog(`[player] videasy source dead (${videasyFatalNetCount} fatal network errors) — handed to page fallback`);
            try { hls.destroy(); } catch { /* ignore */ }
            if (hlsRef.current === hls) hlsRef.current = null;
            return;
          }
        }
        // Try to recover from media/network errors like Stremio does
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          return;
        }
        // Unrecoverable error
        try { hls.destroy(); } catch { /* ignore */ }
        if (hlsRef.current === hls) hlsRef.current = null;
        scheduleStreamRetry();
      });

      // Buffering is handled by the video element's readyState (Stremio approach).
      // Do NOT use HLS-specific events (MANIFEST_LOADING, BUFFER_APPENDED) for buffering
      // — they cause unnecessary spinner flashes and don't match Stremio's behavior.

      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
      nativeAudioTrackList = getNativeAudioTracks(video);
      video.addEventListener('loadedmetadata', updateNativeAudioTracks);
      nativeAudioTrackList?.addEventListener?.('change', updateNativeAudioTracks);
      nativeAudioTrackList?.addEventListener?.('addtrack', updateNativeAudioTracks);
      nativeAudioTrackList?.addEventListener?.('removetrack', updateNativeAudioTracks);
      playWithAutoplayFallback(video);
    }

    // Mobile-browser "won't start until you rotate" fix. A freshly-mounted
    // `fixed inset-0` <video> in an SPA route can sit suspended on mobile —
    // HLS.js/MSE never starts filling the buffer (stuck at readyState=0) until a
    // layout/resize happens, which is why rotating the device made it play.
    // Simulate that resize ourselves (forced reflow + resize event, a few times
    // as the route transition settles) so playback starts on its own.
    if (/iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent)) {
      const kick = () => {
        try {
          void video.offsetHeight; // force layout/reflow
          window.dispatchEvent(new Event('resize'));
        } catch { /* noop */ }
      };
      requestAnimationFrame(kick);
      const k1 = window.setTimeout(kick, 250);
      const k2 = window.setTimeout(kick, 1000);
      kickTimersRef.current = [k1, k2];
    }

    return () => {
      kickTimersRef.current.forEach((t) => window.clearTimeout(t));
      kickTimersRef.current = [];
      video.removeEventListener('emptied', onEmptied);
      video.removeEventListener('loadedmetadata', onSubtitleMetadataReady);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('volumechange', onVolume);
      video.removeEventListener('waiting', checkBuffering);
      video.removeEventListener('playing', checkBuffering);
      video.removeEventListener('stalled', checkBuffering);
      video.removeEventListener('canplay', checkBuffering);
      video.removeEventListener('canplaythrough', checkBuffering);
      video.removeEventListener('loadeddata', checkBuffering);
      video.removeEventListener('seeking', checkBuffering);
      video.removeEventListener('seeked', checkBuffering);
      for (const [name, fn] of diagListeners) {
        video.removeEventListener(name, fn);
      }

      // Capture the live play position BEFORE destroying hls — calling
      // `hls.destroy()` detaches the MediaSource which can reset the
      // <video> element's currentTime to 0 on some Chromium versions.
      // We need the LIVE position (post-seek) so a *quality switch*
      // resumes where the user actually was, not where they started
      // the episode. Same reason `video.load()` below has to come
      // after this read.
      //
      // The closure here captures `props.videoId` from the render
      // when the effect was set up. `latestVideoIdRef.current` is
      // mutated during the *next* render, so a mismatch means the
      // src is changing because of an episode swap — in which case
      // we explicitly DO NOT carry currentTime over, otherwise the
      // new episode would land at the previous episode's position.
      const isQualitySwitch = latestVideoIdRef.current === props.videoId;
      if (isQualitySwitch) {
        try {
          const t = video.currentTime;
          if (Number.isFinite(t) && t > 0) {
            pendingSeekRef.current = t;
          }
        } catch {
          // ignore
        }
      } else {
        // Episode change — wipe any stale position so the new
        // episode starts fresh (and a real ?t= resume seek can
        // take precedence via onLoadedMetadata).
        pendingSeekRef.current = null;
      }

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeEventListener('loadedmetadata', updateNativeAudioTracks);
      nativeAudioTrackList?.removeEventListener?.('change', updateNativeAudioTracks);
      nativeAudioTrackList?.removeEventListener?.('addtrack', updateNativeAudioTracks);
      nativeAudioTrackList?.removeEventListener?.('removetrack', updateNativeAudioTracks);
      video.removeAttribute('src');
      video.load();
    };
    // Only the audio language is read inside this effect; previously
    // depending on the whole `playerSettings` object meant every
    // unrelated setting toggle (auto-play, popup duration, …) would
    // destroy the HLS instance and reload the video.
  }, [props.playerSettings.audioLanguage, props.startTimeSeconds, props.url, retryNonce]);

  useEffect(() => {
    if (isIos()) {
      setShowControls(true);
      return;
    }
    // While paused, controls stay pinned — auto-hide only applies
    // during active playback, since a paused player is what the
    // user is actually looking at to read meta/decide what to do.
    // EXCEPTION: the watch-party buffer gate pauses under the hood; treat that
    // as active playback so the controls don't pop up on every buffer (it should
    // just look like buffering). Use the LIVE `video.paused` (not the lagging
    // `isPlaying` state) so the brief window right after the gate resumes — when
    // play() already flipped video.paused=false but the `play` event hasn't
    // updated isPlaying yet — doesn't flash the controls.
    const liveVideo = videoRef.current;
    const actuallyPaused = liveVideo ? liveVideo.paused : !isPlaying;
    if (actuallyPaused && !watchParty.partyWaiting) {
      setInstantHideControls(false);
      setShowControls(true);
      return;
    }
    let hideTimer: number | null = null;

    const hideNow = () => {
      setInstantHideControls(true);
      setShowControls(false);
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = null;
    };

    const onMove = () => {
      setInstantHideControls(false);
      setShowControls(true);
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setShowControls(false), 2500);
    };

    const onMouseOut = (event: MouseEvent) => {
      // Pointer leaving the window should hide controls immediately.
      const related = (event.relatedTarget ?? (event as any).toElement) as Node | null;
      if (!related) hideNow();
    };

    // Entering playback: schedule an auto-hide even without a local pointer
    // event. Controls are pinned-visible while paused (the branch above), so on
    // resume they'd otherwise stay up until the user happens to move the mouse.
    // That strands them visible when playback resumes WITHOUT a local gesture —
    // chiefly a watch-party peer pressing play (the resume is a programmatic
    // video.play(), so no mousemove ever fires to start the hide timer).
    hideTimer = window.setTimeout(() => setShowControls(false), 2500);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchstart', onMove);
    window.addEventListener('mouseout', onMouseOut);
    window.addEventListener('blur', hideNow);
    return () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchstart', onMove);
      window.removeEventListener('mouseout', onMouseOut);
      window.removeEventListener('blur', hideNow);
    };
  }, [isPlaying, watchParty.partyWaiting]);

  useEffect(() => {
    const onFsChange = () => {
      if (typeof document === 'undefined') return;
      const native = Boolean(
        document.fullscreenElement || (document as any).webkitFullscreenElement
      );
      setIsFullscreen(native);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange as EventListener);
    };
  }, []);


  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const video = videoRef.current;
      if (!video) return;
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (video.paused) {
          void video.play();
        } else {
          video.pause();
        }
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleFullscreen();
        return;
      }
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleMute();
        return;
      }
      if (event.key === 'Escape') {
        // Browsers consume Esc in fullscreen to exit it; only treat as
        // "go back to detail" when we're not in fullscreen mode.
        if (document.fullscreenElement) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onBack();
        return;
      }
      const seekStep = (event.shiftKey
        ? props.playerSettings.seekShortTimeDurationMs
        : props.playerSettings.seekTimeDurationMs) / 1000;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const next = Math.max(0, video.currentTime - seekStep);
        video.currentTime = next;
        watchParty.broadcastSeek(next);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const limit = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
        const next = Math.min(limit, video.currentTime + seekStep);
        video.currentTime = next;
        watchParty.broadcastSeek(next);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [props.playerSettings.seekShortTimeDurationMs, props.playerSettings.seekTimeDurationMs, toggleFullscreen, toggleMute, onBack, watchParty.broadcastSeek]);

  useEffect(() => {
    if (selectedAudioTrackId === null) return;
    const [kind, rawIndex] = selectedAudioTrackId.split(':');
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) return;

    if (kind === 'hls') {
      if (!hlsRef.current) return;
      if (hlsRef.current.audioTrack === index) return;
      hlsRef.current.audioTrack = index;
      return;
    }

    if (kind === 'native') {
      const tracks = getNativeAudioTracks(videoRef.current);
      if (!tracks || index >= tracks.length) return;
      for (let i = 0; i < tracks.length; i += 1) {
        tracks[i].enabled = i === index;
      }
    }
  }, [selectedAudioTrackId]);

  // Apply subtitle selection (fetch -> blob -> <track>)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const existing = Array.from(video.querySelectorAll('track'));
    for (const t of existing) t.remove();
    for (const tt of Array.from(video.textTracks)) tt.mode = 'disabled';

    if (subtitleBlobUrlRef.current) {
      scheduleRevokeSubtitleBlobUrl(subtitleBlobUrlRef.current);
      subtitleBlobUrlRef.current = null;
    }

    if (!selectedSubtitle) return;

    let cancelled = false;
    let cleanupTrackListeners: (() => void) | null = null;
    void (async () => {
      try {
        const cache: Map<string, string> = (globalThis as any).__bliss_subtitle_blob_cache;
        const cached = subtitleDelay === 0 ? cache.get(selectedSubtitle.url) : undefined;
        const blobUrl = cached ?? (await fetchSubtitleVttBlobUrl(selectedSubtitle.url, subtitleDelay));
        if (!cached && subtitleDelay === 0) cache.set(selectedSubtitle.url, blobUrl);
        if (cancelled) {
          // Keep cached blob urls for this session.
          return;
        }
        subtitleBlobUrlRef.current = blobUrl;

        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = selectedSubtitle.label;
        track.srclang = selectedSubtitle.label.slice(0, 2).toLowerCase();
        track.src = blobUrl;
        track.default = true;
        video.appendChild(track);

        const tryFallback = () => {
          if (cancelled) return;
          if (userPickedSubtitleRef.current) return;
          if (autoPickedSubtitleKeyRef.current !== selectedSubtitle.key) return;

          const attemptKey = `${subtitlesKey ?? ''}|${selectedSubtitle.lang}`;
          const attempts = autoPickAttemptsRef.current.get(attemptKey) ?? 0;
          if (attempts >= 3) return;
          autoPickAttemptsRef.current.set(attemptKey, attempts + 1);

          const candidates = allSubtitleTracksRef.current
            .filter((t) => t.lang === selectedSubtitle.lang)
            .slice()
            .sort((a, b) => {
              const sa = scoreSubtitleTrack(a);
              const sb = scoreSubtitleTrack(b);
              if (sb !== sa) return sb - sa;
              return a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label);
            });
          const idx = candidates.findIndex((t) => t.key === selectedSubtitle.key);
          const next = idx >= 0 ? candidates[idx + 1] : null;
          if (!next) return;
          autoPickedSubtitleKeyRef.current = next.key;
          setSelectedSubtitleKey(next.key);
        };

        const onTrackError = () => {
          tryFallback();
        };

        const onTrackLoad = () => {
          // Only evaluate once the browser finished parsing the track.
          try {
            const cues = track.track?.cues;
            const cueCount = cues ? cues.length : 0;
            if (cueCount === 0) {
              tryFallback();
            }
            if (track.track) {
              applySubtitleLayout(track.track, subtitleLinePosition);
              track.track.mode = 'showing';
            }
          } catch {
            tryFallback();
          }
        };

        track.addEventListener('error', onTrackError);
        track.addEventListener('load', onTrackLoad);

         window.setTimeout(() => {
           try {
             const tt = track.track;
             if (!tt) return;
             tt.mode = 'showing';
              applySubtitleLayout(tt, subtitleLinePosition);
           } catch {
             // ignore
           }
         }, 0);

        // Cleanup listeners when switching tracks
        const cleanup = () => {
          track.removeEventListener('error', onTrackError);
          track.removeEventListener('load', onTrackLoad);
        };
        cleanupTrackListeners = cleanup;

        // Bracket the language with "Embedded" when the active track
        // shipped with the stream — saves the user from having to
        // open the picker to see why a sub appeared. Dedupe by
        // canonical language label, not key: auto-pick frequently
        // upgrades within the same language (addon → built-in), and
        // we don't want a second toast for that.
        const langName = subtitleLangLabel(selectedSubtitle.lang);
        if (lastToastedSubtitleLangRef.current !== langName) {
          lastToastedSubtitleLangRef.current = langName;
          const tag = isEmbeddedOrigin(selectedSubtitle.origin) ? ' (Embedded)' : '';
          setToast(`Subtitles: ${langName}${tag}`);
          window.setTimeout(() => setToast(null), 2000);
        }

      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        // eslint-disable-next-line no-console
        console.error('[subtitle] fetch failed', selectedSubtitle.url, msg);
        try {
          fetch('/player-log', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: `[player] subtitle fetch failed url=${selectedSubtitle.url} err=${msg}`,
            keepalive: true,
          }).catch(() => {});
        } catch { /* ignore */ }
        setToast('Subtitles failed to load');
        window.setTimeout(() => setToast(null), 2500);
      }
    })();

    return () => {
      cancelled = true;
      try {
        cleanupTrackListeners?.();
      } catch {
        // ignore
      }
      if (subtitleBlobUrlRef.current) {
        scheduleRevokeSubtitleBlobUrl(subtitleBlobUrlRef.current);
        subtitleBlobUrlRef.current = null;
      }
    };
    // Intentionally omits allSubtitleTracks from deps — keeping it
    // would re-run this effect (and abort the in-flight subtitle
    // fetch) every time the tracks list grows as addon results
    // trickle in, leading to "Failed to fetch" 12s into the
    // ffmpeg extract. tryFallback reads the latest list via ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubtitle, subtitleDelay, subtitleLinePosition, subtitlesKey, subtitleReattachNonce]);

  useEffect(() => {
    if (selectedSubtitleKey === 'off') return;
    let cancelled = false;
    const apply = () => {
      const video = videoRef.current;
      if (!video) return;
      for (const track of Array.from(video.textTracks)) {
        applySubtitleLayout(track, subtitleLinePosition);
        try {
          track.mode = 'showing';
        } catch {
          // ignore
        }
      }
    };
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      apply();
      attempts += 1;
      if (attempts < 3) {
        window.setTimeout(tick, 300);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [selectedSubtitleKey, subtitleLinePosition]);

   useEffect(() => {
     const video = videoRef.current;
     if (!video) return;
     const tracks = Array.from(video.textTracks);
     for (const track of tracks) {
       track.oncuechange = () => applySubtitlePositionActive(track, subtitleLinePosition);
       applySubtitlePositionActive(track, subtitleLinePosition);
     }
     return () => {
       for (const track of tracks) {
         track.oncuechange = null;
       }
     };
   }, [subtitleLinePosition]);

  useEffect(() => {
    if (selectedSubtitleKey === 'off') return;
    if (subtitleRafRef.current) window.cancelAnimationFrame(subtitleRafRef.current);
    subtitleRafRef.current = window.requestAnimationFrame(() => {
      const video = videoRef.current;
      if (!video) return;
      for (const track of Array.from(video.textTracks)) {
        applySubtitlePositionActive(track, subtitleLinePosition);
      }
    });
    return () => {
      if (subtitleRafRef.current) window.cancelAnimationFrame(subtitleRafRef.current);
      subtitleRafRef.current = null;
    };
  }, [selectedSubtitleKey, subtitleLinePosition]);


  // Adding a title to the user's library is an explicit action via
  // the detail page's "Add to library" button — not a side-effect of
  // hitting Play. Progress writes (handled by
  // updateBlissfulLibraryProgress) only update titles already in the
  // library; titles that aren't there silently no-op on progress.

  // Stremio open trigger: fire-and-forget per-item sync on player mount
  // (and when the item id changes via episode advance). If the user has
  // Stremio linked and a newer progress lives there, this pulls it in
  // so the resume point reflects what they last watched anywhere.
  // No-op when not linked; 10 s cooldown per id prevents storms.
  useEffect(() => {
    triggerStremioItemSync(props.authKey ?? null, props.id ?? null);
  }, [props.authKey, props.id]);

  // Stremio close trigger: on unmount (or episode change), best-effort
  // flush the latest video time to /library/:id, then force a per-item
  // sync — bypasses the cooldown because the close is the critical
  // "push to Stremio" moment for that watch session.
  useEffect(() => {
    return () => {
      const authKey = props.authKey;
      const id = props.id;
      const type = props.type;
      if (!authKey || !id || !type) return;
      const video = videoRef.current;
      const t = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const d = video && Number.isFinite(video.duration) ? video.duration : 0;
      void (async () => {
        if (t > 0) {
          try {
            await updateBlissfulLibraryProgress(authKey, {
              id,
              type,
              videoId: props.videoId ?? null,
              timeSeconds: t,
              durationSeconds: d,
              name: props.metaTitle ?? props.title ?? null,
              poster: props.poster ?? null,
            });
          } catch {
            /* throttled writes will catch up next session; sync anyway */
          }
        }
        try {
          if (await isStremioLinked(authKey)) await syncStremioItem(authKey, id);
        } catch {
          /* cron heals — don't surface */
        }
      })();
    };
  }, [props.authKey, props.id, props.type, props.videoId]);

  // Publish "currently watching" to the presence heartbeat — friends
  // see "watching <title>" in the sidebar while this player is mounted.
  useEffect(() => {
    if (!props.id || !props.type) return;
    const baseName =
      (props.metaTitle && props.metaTitle.trim().length > 0
        ? props.metaTitle
        : props.title && props.title.trim().length > 0
          ? props.title.split('\n')[0]
          : null) ?? props.id;
    setCurrentActivity({
      type: props.type,
      id: props.id,
      name: baseName,
      videoId: props.videoId ?? null,
    });
    return () => {
      clearCurrentActivity();
    };
  }, [props.id, props.type, props.videoId, props.metaTitle, props.title]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!props.type || !props.id) return;

    const lastSyncedRef = { t: 0, offsetMs: 0 };
    const onTimeUpdate = () => {
      const t = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      setProgress({ type: props.type!, id: props.id!, videoId: props.videoId ?? undefined }, { time: t, duration: d });

      if (!props.authKey) return;
      if (!Number.isFinite(t) || t <= 0) return;

      const now = Date.now();
      if (now - lastSyncedRef.t < 5000) return;
      const offsetMs = Math.round(t * 1000);
      if (Math.abs(offsetMs - lastSyncedRef.offsetMs) < 1000) return;
      lastSyncedRef.t = now;
      lastSyncedRef.offsetMs = offsetMs;

      void updateBlissfulLibraryProgress(props.authKey, {
        id: props.id!,
        type: props.type as any,
        videoId: props.videoId ?? null,
        timeSeconds: t,
        durationSeconds: d,
        name: props.metaTitle ?? props.title ?? null,
        poster: props.poster ?? null,
      })
        .then(() => {
          window.dispatchEvent(new Event('blissful:progress'));
        })
        .catch(() => {
          // ignore
        });
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [props.authKey, props.id, props.type, props.videoId]);

  // Auto-advance: navigate to next episode. Refuses to advance when the
  // next episode hasn't aired yet — the button is disabled in that case,
  // but we keep the guard here for any non-button caller (e.g. the auto-
  // advance UpNext overlay).
  // Watch-party gate — when we're a guest in a room, episode changes
  // are host-driven only. The host's `host:episode` broadcast handles
  // moving everyone forward; a non-host triggering their own advance
  // would desync the party.
  const partyNonHost = !!props.roomCode && !watchParty.isHost;
  partyNonHostRef.current = partyNonHost;

  const advanceToNextEpisode = useCallback(() => {
    if (partyNonHost) return;
    const next = props.nextEpisodeInfo;
    if (!next || !props.type || !props.id) return;
    if (next.nextReleased) {
      const releaseMs = Date.parse(next.nextReleased);
      if (Number.isFinite(releaseMs) && releaseMs > Date.now()) return;
    }
    upNextFiredRef.current = true;
    flushNow();

    // Clear stale next-episode sessionStorage so the new player instance
    // doesn't show the same overlay again (DetailPage will write fresh data
    // if the user navigates back through it).
    try { sessionStorage.removeItem(`bliss:nextEpisode:${props.type}:${props.id}`); } catch { /* ignore */ }

    // Look up stored stream for the next episode
    const storedStream = getLastStreamSelection({
      authKey: props.authKey,
      type: props.type,
      id: props.id,
      videoId: next.nextVideoId,
    });

    if (storedStream?.url) {
      // Navigate directly to the player with the stored stream
      const params = new URLSearchParams();
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
      // No stored stream — stay in the player and let PlayerPage
      // resolve the source for the next episode through Videasy
      // (same path navigateToEpisode uses). Avoids bouncing the
      // user out to the detail page on devices that haven't played
      // this episode before.
      const params = new URLSearchParams(window.location.search);
      params.set('url', 'vidking:placeholder');
      params.set('videoId', next.nextVideoId);
      params.delete('t');
      params.delete('autoplay');
      navigate(`/player?${params.toString()}`, { replace: true });
    }
  }, [props.nextEpisodeInfo, props.type, props.id, props.authKey, props.poster, props.metaTitle, props.logo, navigate, partyNonHost]);

  // Jump to an arbitrary episode by videoId — same URL pattern as
  // DetailPage's handlePlayWithVidking. PlayerPage detects the
  // videoId change and re-resolves the Videasy source. When
  // `resumeSeconds` is provided we propagate it via the `?t=` query
  // param so PlayerPage's `startTimeSeconds` memo picks it up and
  // BlissfulPlayer's `onLoadedMetadata` handler seeks there on load.
  const navigateToEpisode = useCallback((videoId: string, resumeSeconds?: number, opts?: { openReleases?: boolean; rdUrl?: string }) => {
    if (!props.type || !props.id) return;
    const params = new URLSearchParams(window.location.search);
    // rdUrl (a torrent picked in the unreleased selector) plays directly in
    // fallback mode; otherwise resolve via Videasy from a placeholder.
    params.set('url', opts?.rdUrl ?? 'vidking:placeholder');
    params.set('videoId', videoId);
    if (resumeSeconds && resumeSeconds > 0) {
      params.set('t', String(Math.floor(resumeSeconds)));
    } else {
      params.delete('t');
    }
    params.delete('autoplay');
    params.delete('pickReleases');
    params.delete('rdsel');
    if (opts?.rdUrl) {
      params.set('rdsel', '1'); // RD-selected: skip Videasy, play this torrent
    } else if (opts?.openReleases) {
      params.set('pickReleases', '1');
    }
    navigate(`/player?${params.toString()}`);
  }, [navigate, props.type, props.id]);

  // Resume-prompt state — when the user picks an episode that has
  // saved watch progress, we surface the ResumeOrStartOverModal
  // (same one Continue Watching uses on /home and /detail) instead
  // of always restarting from minute 0. The poster shown inside the
  // modal is the episode's own thumbnail, not the show poster.
  type EpisodeResumePrompt = {
    video: EpisodesDrawerVideo;
    seconds: number;
  };
  const [episodeResumePrompt, setEpisodeResumePrompt] = useState<EpisodeResumePrompt | null>(null);

  // Unreleased-episode prompt — surfaced when the user clicks a
  // future-dated episode in the drawer (or hits the next-ep button
  // before the new ep airs). Reused as the shared modal in case
  // DetailPage starts using it for the same scenario.
  const [unreleasedPrompt, setUnreleasedPrompt] = useState<EpisodesDrawerVideo | null>(null);
  // Fetch the FULL release list (all installed addons + house RD fallback —
  // same source as the in-player Releases picker) whenever the unreleased modal
  // opens: null = still checking, [] = none, [...] = available. Drives the
  // modal's "Play with RealDebrid" selector.
  const [unreleasedRdStreams, setUnreleasedRdStreams] = useState<ReleaseOption[] | null>(null);
  useEffect(() => {
    if (!unreleasedPrompt || !props.type) {
      setUnreleasedRdStreams(unreleasedPrompt ? [] : null);
      return;
    }
    let cancelled = false;
    setUnreleasedRdStreams(null);
    fetchFallbackReleases({
      type: props.type,
      id: unreleasedPrompt.id,
      addons: props.addons,
      showTitle: props.metaTitle ?? props.title ?? undefined,
      // Flip to the button + show releases as soon as the first source returns
      // something — don't wait on the slowest addon.
      onPartial: (list) => { if (!cancelled && list.length > 0) setUnreleasedRdStreams(list); },
    })
      .then((list) => { if (!cancelled) setUnreleasedRdStreams(list); })
      .catch(() => { if (!cancelled) setUnreleasedRdStreams([]); });
    return () => { cancelled = true; };
  }, [unreleasedPrompt, props.type, props.addons]);

  // In fallback / RD modes the Videasy "Servers" tab is hidden and "Releases"
  // is shown — never leave the panel parked on the now-missing Servers tab.
  useEffect(() => {
    if (props.hideServerPicker && (props.releases?.length ?? 0) > 0 && settingsTab === 'servers') {
      setSettingsTab('releases');
    }
  }, [props.hideServerPicker, props.releases, settingsTab]);

  // Arrived via "Play with RD" (?pickReleases=1) → open the torrent selector
  // once the RD fallback has resolved streams.
  const autoOpenedReleasesRef = useRef(false);
  // Tracks whether the user actually picked a release (set synchronously by the
  // row click BEFORE the panel's onClose fires), so closing via X/backdrop can
  // be told apart from closing via a pick.
  const releasePickMadeRef = useRef(false);
  const handleSelectReleaseTracked = useCallback((u: string) => {
    releasePickMadeRef.current = true;
    props.onSelectRelease?.(u);
  }, [props.onSelectRelease]);
  const handleSettingsClose = useCallback(() => {
    setSettingsOpen(false);
    // Pick-first: closed the auto-opened Releases picker without choosing →
    // fall back to a default so we don't strand them behind the buffering veil.
    if (
      props.autoOpenReleases
      && settingsTab === 'releases'
      && !releasePickMadeRef.current
      && !props.selectedReleaseUrl
    ) {
      props.onReleasesDismissed?.();
    }
  }, [props.autoOpenReleases, settingsTab, props.selectedReleaseUrl, props.onReleasesDismissed]);
  useEffect(() => {
    if (!props.autoOpenReleases) { autoOpenedReleasesRef.current = false; return; }
    if (autoOpenedReleasesRef.current) return;
    // Pick-first mode has no committed fallback yet, so open as soon as the
    // releases resolve (don't wait on fallbackActive).
    if ((props.releases?.length ?? 0) > 0) {
      autoOpenedReleasesRef.current = true;
      setSettingsTab('releases');
      setSettingsOpen(true);
    }
  }, [props.autoOpenReleases, props.releases]);

  // A transcode 409 asked for the Releases drawer before the list had
  // resolved (it loads async while the player starts). Open it as soon as the
  // releases arrive — but only while the dead stream is still what playback
  // is stuck on (fallback or rd mode); if Videasy took over meanwhile there
  // is nothing to swap and popping the drawer would just interrupt.
  useEffect(() => {
    if (!pendingReleasesOpenRef.current) return;
    if ((!props.fallbackActive && !props.rdMode) || partyNonHost) {
      pendingReleasesOpenRef.current = false;
      return;
    }
    if ((props.releases?.length ?? 0) > 0) {
      pendingReleasesOpenRef.current = false;
      setSettingsTab('releases');
      setSettingsOpen(true);
    }
  }, [props.fallbackActive, props.rdMode, props.releases, partyNonHost]);

  const handleSelectEpisode = useCallback((v: EpisodesDrawerVideo) => {
    // Watch-party guests are read-only on the episode picker — host
    // drives the room's episode and broadcasts. Closing the drawer
    // would feel like the click registered, so leave it open too.
    if (partyNonHost) return;
    setEpisodesOpen(false);
    // Clicking the currently-playing episode is a no-op (we're
    // already on it). Re-resolving the same URL would just buffer.
    if (v.id === props.videoId) return;
    // Unreleased gate — if `released` is in the future, surface the
    // not-yet-aired modal instead of navigating into a Videasy
    // 404. The drawer doesn't have the show's overall airing data,
    // so we trust the per-episode field.
    if (v.released) {
      const releaseMs = Date.parse(v.released);
      if (Number.isFinite(releaseMs) && releaseMs > Date.now()) {
        setUnreleasedPrompt(v);
        return;
      }
    }
    if (!props.type || !props.id) {
      navigateToEpisode(v.id);
      return;
    }
    // Inside a watch party, always start the new episode from 0:00
    // so the host's resume/seek doesn't get clobbered by the room's
    // sync layer and so everyone shares the same clean timeline.
    // The progressStore still records progress in the background;
    // it just doesn't surface a resume prompt during a party.
    if (props.roomCode) {
      navigateToEpisode(v.id);
      return;
    }
    const existing = getProgress({ type: props.type, id: props.id, videoId: v.id });
    if (existing && existing.time > 0) {
      // Watched-to-end heuristic: matches progressStore.isWatched (>=90 %).
      // Skip the prompt when there's no point resuming — just restart.
      const pct = existing.duration > 0 ? (existing.time / existing.duration) * 100 : 0;
      if (pct < 90) {
        setEpisodeResumePrompt({ video: v, seconds: existing.time });
        return;
      }
    }
    navigateToEpisode(v.id);
  }, [navigateToEpisode, props.type, props.id, props.videoId, props.roomCode, partyNonHost]);

  // Manual "play next" from the bottom controls. Goes through the
  // same resume-or-start-over prompt that the episode drawer uses
  // when the next episode has saved progress. Distinct from
  // `advanceToNextEpisode` (UpNext + auto-advance), which is meant
  // to feel like a seamless continuation and never prompts.
  const handlePlayNextManual = useCallback(() => {
    const next = props.nextEpisodeInfo;
    if (!next) return;
    const nextVideo = (props.videos ?? []).find((v) => v.id === next.nextVideoId);
    if (nextVideo) {
      handleSelectEpisode(nextVideo);
      return;
    }
    // Fall back to seamless advance when the next-episode meta isn't
    // in our `videos` list (shouldn't happen for series but the
    // auto-advance path is the safe default).
    advanceToNextEpisode();
  }, [props.nextEpisodeInfo, props.videos, handleSelectEpisode, advanceToNextEpisode]);

  // Auto-advance: configurable trigger (Stremio-style).
  // Shows "Up Next" overlay when remaining time <= nextVideoNotificationDurationMs.
  // If the setting is 0 (disabled), only the ended event fires (for bingeWatching).
  const notificationDurationSecRef = useRef(props.playerSettings.nextVideoNotificationDurationMs / 1000);
  notificationDurationSecRef.current = props.playerSettings.nextVideoNotificationDurationMs / 1000;

  const bingeWatchingRef = useRef(props.playerSettings.bingeWatching);
  bingeWatchingRef.current = props.playerSettings.bingeWatching;
  // Quick session override exposed via the Episodes drawer ("Auto
  // next" toggle). Both must be true for the countdown / ended-event
  // handler to actually skip to the next episode.
  const autoNextRef = useRef(autoNext);
  autoNextRef.current = autoNext;

  const showUpNextRef = useRef(showUpNext);
  showUpNextRef.current = showUpNext;

  const advanceRef = useRef(advanceToNextEpisode);
  advanceRef.current = advanceToNextEpisode;

  useEffect(() => {
    if (!props.nextEpisodeInfo) return;

    const video = videoRef.current;
    if (!video) return;

    // Time-based trigger: show overlay when remaining <= configured seconds
    const onTimeCheck = () => {
      if (upNextFiredRef.current || upNextCancelledRef.current) return;
      // bingeWatching is the master enable — when off, the Up Next
      // overlay never surfaces and the next episode never plays.
      if (!bingeWatchingRef.current) return;
      const dur = notificationDurationSecRef.current;
      if (dur <= 0) return; // disabled — rely on ended only
      const t = video.currentTime;
      const d = video.duration;
      if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;
      const remaining = d - t;
      if (remaining <= dur && remaining > 0) {
        setShowUpNext(true);
      }
    };

    // Ended event: when bingeWatching is on, surface the overlay (if it
    // wasn't already shown by the time-based trigger) or advance. When
    // bingeWatching is off, nothing happens — playback ends silently.
    const onEnded = () => {
      if (upNextFiredRef.current) return;
      if (!bingeWatchingRef.current) return;
      if (!showUpNextRef.current && !upNextCancelledRef.current) {
        setShowUpNext(true);
      } else if (!upNextCancelledRef.current) {
        advanceRef.current();
      }
    };

    video.addEventListener('timeupdate', onTimeCheck);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTimeCheck);
      video.removeEventListener('ended', onEnded);
    };
  }, [props.nextEpisodeInfo]);

  // Auto-advance: countdown timer (10s → 0 then navigate if binge-watching is on)
  useEffect(() => {
    if (!showUpNext || upNextCancelledRef.current || upNextFiredRef.current) return;
    if (!props.playerSettings.bingeWatching) return; // master auto-play toggle

    setUpNextCountdown(10);
    const interval = window.setInterval(() => {
      setUpNextCountdown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          window.clearInterval(interval);
          advanceToNextEpisode();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [showUpNext, advanceToNextEpisode, props.playerSettings.bingeWatching]);

  // Reset auto-advance state when stream URL changes (new episode loaded)
  useEffect(() => {
    setShowUpNext(false);
    setUpNextCountdown(10);
    upNextCancelledRef.current = false;
    upNextFiredRef.current = false;
  }, [props.url]);

  const handleCancelUpNext = useCallback(() => {
    upNextCancelledRef.current = true;
    setShowUpNext(false);
  }, []);

  const formattedTime = (value: number) => {
    // Stream metadata not loaded yet → both current and total render
    // as Stremio-style "--:--:--" placeholders. Once duration is
    // known we use mm:ss or hh:mm:ss based on whether the title runs
    // an hour or longer (keeps current and total visually consistent
    // and stops current from jumping "5:23" → "1:00:00" when
    // crossing the hour).
    if (!Number.isFinite(duration) || duration <= 0) return '--:--:--';
    if (!Number.isFinite(value)) return '--:--:--';
    const total = Math.max(0, Math.floor(value));
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const useHours = duration >= 3600;
    const pad = (n: number) => String(n).padStart(2, '0');
    return useHours
      ? `${hours}:${pad(mins)}:${pad(secs)}`
      : `${mins}:${pad(secs)}`;
  };

  return (
    // No `bliss-player-enter` scale — PlayerPage renders its buffering
    // placeholder immediately on route mount and the RouteTransition
    // fade-in handles the entry visually. Mounting BlissfulPlayer with
    // the same black bg means the swap from placeholder to real player
    // is invisible.
    <div ref={playerRootRef} className={props.compact ? 'group/mini absolute inset-0 bg-black' : 'fixed inset-0 z-50 bg-black'}>
      <video
        ref={videoRef}
        data-testid="player-video"
        className="bliss-player-video h-full w-full bg-black"
        style={{
          objectFit: 'contain',
          ['--bliss-subtitle-size' as any]: `${effectiveSubtitleSizePx}px`,
          ['--bliss-subtitle-color' as any]: subtitleColor,
          ['--bliss-subtitle-bg' as any]: subtitleBackgroundColor,
          ['--bliss-subtitle-outline' as any]: subtitleOutlineColor,
        }}
        autoPlay
        playsInline
        // In mini the video is the drag surface (handled by the AppShell
        // container) and the ⤢ button expands; in full, click toggles play.
        onClick={props.compact ? undefined : togglePlay}
      />

      {/* Fallback info banner — announces that primary playback
          (Videasy) is unavailable and we've switched to a
          Real-Debrid stream. On mobile, also offers an
          "Open in VLC" button (native HEVC support, hardware
          decode, better with big MKVs). Dismissible. */}
      {props.fallbackActive && !fallbackBannerDismissed && !props.rdMode ? (
        <div className="pointer-events-auto absolute left-1/2 top-6 z-40 max-w-[92%] -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-black/70 px-4 py-3 text-sm text-white shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)] backdrop-blur-xl">
            <div className="flex-1 leading-snug">
              <div className="font-semibold">Vidking is unavailable right now</div>
              <div className="text-white/70">Playing via Real-Debrid stream instead.</div>
            </div>
            <button
              type="button"
              className="hidden cursor-pointer rounded-full bg-[var(--bliss-accent)]/20 px-3 py-1.5 text-[12px] font-semibold text-[var(--bliss-accent)] hover:bg-[var(--bliss-accent)]/30 md:hidden [@media(max-width:767px)]:inline-flex"
              onClick={() => {
                openInVlc(props.url);
              }}
            >
              Open in VLC
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              className="cursor-pointer rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => setFallbackBannerDismissed(true)}
            >
              <StremioIcon name="x" className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Inline player toast — liquid-glass pill near the top of
          the player so the bottom controls stay visible. Used for
          subtitle change notifications and similar lightweight
          status messages. */}
      {toast && !toast.toLowerCase().includes('downloaded') ? (
        <div className="pointer-events-none absolute left-1/2 top-6 z-30 -translate-x-1/2">
          <div className="relative overflow-hidden rounded-full">
            {/* Inner glass surface — translucent with heavy blur
                and a subtle inner highlight. */}
            <div className="relative rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] backdrop-blur-xl backdrop-saturate-150">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-2 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/25 to-transparent"
              />
              <span className="relative drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{toast}</span>
            </div>
          </div>
        </div>
      ) : null}

      {props.compact ? null : (
        <TopOverlay
          showControls={showControls}
          instantHideControls={instantHideControls}
          headerPrimary={headerPrimary}
          onBack={onBack}
          videoInfo={videoInfo}
          streamUrl={props.url}
          error={error}
          rightSlot={watchPartySlot}
        />
      )}

      {props.roomCode && watchParty.connected ? (
        <WatchPartyActivityToast
          activity={watchParty.activity}
          chat={watchParty.chat}
          selfUserId={watchParty.selfUserId}
        />
      ) : null}

      <WatchPartyDrawer
        open={partyDrawerOpen}
        onClose={() => setPartyDrawerOpen(false)}
        tab={partyDrawerTab}
        onTabChange={setPartyDrawerTab}
        activeRoomTab={partyActiveRoomTab}
        onActiveRoomTabChange={setPartyActiveRoomTab}
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
        hasPassword={roomInfo?.hasPassword ?? false}
        error={watchParty.error}
        onLeave={handleLeaveParty}
        onTransferHost={watchParty.transferHost}
        onRequestHostStream={watchParty.requestHostStream}
        canCreate={!!props.id && !!props.type}
        creatingRoom={creatingRoom}
        onCreateRoom={(pw) => createParty(pw)}
        onNavigateToRoom={handleNavigateToRoom}
      />

      {showNamePrompt ? (
        <WatchPartyNamePrompt
          initialName={profileDisplayName || null}
          onSubmit={handleNameSubmit}
          onCancel={handleNameCancel}
        />
      ) : showPasswordPrompt && props.roomCode ? (
        <WatchPartyPasswordPrompt
          roomCode={props.roomCode}
          onSubmit={handlePasswordSubmit}
          onCancel={handlePasswordCancel}
        />
      ) : null}
        <BufferingOverlay
          visible={isBuffering || !firstFrameSeen || watchParty.partyWaiting}
          logo={props.logo}
        />



       {isMenuOpen ? (
         <div
           className="absolute inset-0 z-25"
           onClick={() => {
             setSettingsOpen(false);
             setEpisodesOpen(false);
           }}
         />
       ) : null}

      <BottomControls
        showControls={showControls}
        instantHideControls={instantHideControls}
        currentTime={currentTime}
        duration={duration}
        setCurrentTime={setCurrentTime}
        scrubBarSliderRef={scrubBarSliderRef}
        scrubHoverPx={scrubHoverPx}
        setScrubHoverPx={setScrubHoverPx}
        scrubHoverTime={scrubHoverTime}
        setScrubHoverTime={setScrubHoverTime}
        formattedTime={formattedTime}
        isPlaying={isPlaying}
        togglePlay={togglePlay}
        muted={muted}
        toggleMute={toggleMute}
        volume={volume}
        videoRef={videoRef}
        onUserSeek={watchParty.broadcastSeek}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        compact={props.compact}
        onMinimize={onPipButton}
        onExpand={props.onExpand}
        onClosePlayer={props.onClosePlayer}
        nextEpisodeInfo={props.nextEpisodeInfo}
        advanceToNextEpisode={handlePlayNextManual}
        episodeChangeDisabled={partyNonHost}
        type={props.type}
        hasVideos={(props.videos?.length ?? 0) > 0}
        qualityOptions={props.qualityOptions}
        selectedQuality={props.selectedQuality ?? null}
        audioTracks={partyNonHost ? undefined : props.audioTracks}
        selectedAudioTrack={props.selectedAudioTrack}
        hideServerPicker={props.hideServerPicker}
        hasReleases={(props.releases?.length ?? 0) > 0}
        sourceChangeDisabled={partyNonHost}
        openSettings={(tab: SettingsTab) => {
          setEpisodesOpen(false);
          setSettingsTab(tab);
          setSettingsOpen((v) => !v);
        }}
        toggleEpisodes={() => {
          setSettingsOpen(false);
          setEpisodesOpen((v) => !v);
        }}
        seekShortTimeDurationMs={props.playerSettings.seekShortTimeDurationMs}
      />

      {chapterSkip ? (
        <SkipChapterButton
          kind={chapterSkip.kind}
          label={chapterSkip.label}
          onSkip={chapterSkip.onSkip}
        />
      ) : null}




      <UpNextOverlay
        visible={showUpNext && !upNextCancelledRef.current && !upNextFiredRef.current}
        nextEpisodeInfo={props.nextEpisodeInfo}
        countdown={upNextCountdown}
        playerSettings={props.playerSettings}
        onCancel={handleCancelUpNext}
        onAdvance={advanceToNextEpisode}
      />



      {/* ── Bitcine-style unified Settings panel ────────────────── */}
      <SettingsPanel
        open={settingsOpen}
        onClose={handleSettingsClose}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        subtitlesView={subtitlesView}
        onSubtitlesViewChange={setSubtitlesView}
        qualityOptions={props.qualityOptions}
        selectedQuality={props.selectedQuality}
        onSelectQuality={props.onSelectQuality}
        audioTracks={partyNonHost ? undefined : props.audioTracks}
        selectedAudioTrack={props.selectedAudioTrack}
        onSelectAudioTrack={props.onSelectAudioTrack}
        favoriteQuality={favoriteQuality}
        onSetFavoriteQuality={setFavoriteQuality}
        selectedSubtitleKey={selectedSubtitleKey}
        onSelectSubtitleKey={setSelectedSubtitleKey}
        subtitleLanguages={subtitleLanguages}
        allSubtitleTracks={allSubtitleTracks}
        onSelectLanguage={setSelectedLanguage}
        userPickedSubtitleRef={userPickedSubtitleRef}
        autoPickedSubtitleKeyRef={autoPickedSubtitleKeyRef}
        subtitleSizePx={subtitleSizePx}
        onSubtitleSizePxChange={setSubtitleSizePx}
        subtitleColor={subtitleColor}
        onSubtitleColorChange={setSubtitleColor}
        subtitleDelay={subtitleDelay}
        onSubtitleDelayChange={setSubtitleDelay}
        hideServerPicker={props.hideServerPicker}
        selectedServer={selectedServer}
        onSelectServer={setSelectedServer}
        unavailableServers={unavailableServers}
        favoriteServer={favoriteServer}
        onSetFavoriteServer={setFavoriteServer}
        releases={partyNonHost ? undefined : props.releases}
        selectedReleaseUrl={props.selectedReleaseUrl}
        onSelectRelease={handleSelectReleaseTracked}
        playerSettings={props.playerSettings}
        savePlayerSettingsToAccount={storageCtx.savePlayerSettings}
      />

      {/* ── Episodes drawer (series only) ─────────────────────── */}
      <EpisodesDrawer
        open={episodesOpen}
        onClose={() => setEpisodesOpen(false)}
        type={props.type}
        videos={props.videos}
        videoId={props.videoId}
        background={props.background}
        poster={props.poster}
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
        progressLookupId={props.id ?? ''}
        progressLookupType={props.type ?? ''}
        onSelectEpisode={handleSelectEpisode}
        disableSelection={partyNonHost}
      />

      {/* Resume-or-start-over modal — shown when the user picks an
          episode in the drawer that has saved progress. The poster
          inside is the episode's thumbnail (not the show poster). */}
      <ResumeOrStartOverModal
        isOpen={episodeResumePrompt != null}
        title={props.metaTitle ?? props.title ?? ''}
        episodeLabel={
          episodeResumePrompt
            && episodeResumePrompt.video.season != null
            && episodeResumePrompt.video.episode != null
              ? `S${String(episodeResumePrompt.video.season).padStart(2, '0')}E${String(episodeResumePrompt.video.episode).padStart(2, '0')}`
              + (episodeResumePrompt.video.title ? ` · ${episodeResumePrompt.video.title}` : '')
              : null
        }
        poster={episodeResumePrompt?.video.thumbnail ?? props.poster ?? null}
        resumeSeconds={episodeResumePrompt?.seconds ?? 0}
        onResume={() => {
          if (episodeResumePrompt) {
            navigateToEpisode(episodeResumePrompt.video.id, episodeResumePrompt.seconds);
          }
        }}
        onStartOver={() => {
          if (episodeResumePrompt) navigateToEpisode(episodeResumePrompt.video.id);
        }}
        onClose={() => setEpisodeResumePrompt(null)}
      />

      {/* Unreleased-episode info modal — same shared component the
          detail page can adopt when its episode panel grows the
          same click handler. */}
      <UnreleasedEpisodeModal
        isOpen={unreleasedPrompt != null}
        title={props.metaTitle ?? props.title ?? ''}
        episodeLabel={
          unreleasedPrompt
            && unreleasedPrompt.season != null
            && unreleasedPrompt.episode != null
              ? `S${String(unreleasedPrompt.season).padStart(2, '0')}E${String(unreleasedPrompt.episode).padStart(2, '0')}`
              + (unreleasedPrompt.title ? ` · ${unreleasedPrompt.title}` : '')
              : null
        }
        poster={unreleasedPrompt?.thumbnail ?? props.poster ?? null}
        releaseDate={unreleasedPrompt?.released ?? null}
        // Early/leaked torrents often exist before the official air date. The
        // modal lists them ("Play with RealDebrid" → selector); picking one
        // navigates straight to the player in fallback mode (no Videasy).
        releases={unreleasedRdStreams}
        onPickTorrent={
          unreleasedPrompt
            ? (rdUrl) => {
                const v = unreleasedPrompt;
                setUnreleasedPrompt(null);
                navigateToEpisode(v.id, undefined, { rdUrl });
              }
            : undefined
        }
        onClose={() => setUnreleasedPrompt(null)}
      />

      {/* ── Pause overlay: bottom-left info card ─────────────── */}
      {/* In the mini window only the CARD is scaled down (cardScale) — the
          dim still covers the whole window. */}
      <PauseOverlay
        // During the watch-party buffer gate the video is paused under the hood,
        // but we want it to read as "buffering" (just the spinner) — not flash
        // the paused title/meta card on every buffer. Treat the gate-hold as
        // playing so this overlay stays hidden.
        isPlaying={isPlaying || watchParty.partyWaiting}
        hasPlayedOnce={hasPlayedOnce}
        // In a connected watch party, the guest may have joined a
        // paused stream via a direct link — their local <video>
        // never fired `play`, so `hasPlayedOnce` stays false and
        // the overlay would hide. Force it visible so they see
        // the title / poster / pause state of the room.
        forceShow={!!props.roomCode && watchParty.connected}
        metaTitle={props.metaTitle}
        title={props.title}
        description={props.description}
        type={props.type}
        videoId={props.videoId}
        videos={props.videos}
        logo={props.logo}
        imdbRating={props.imdbRating}
        released={props.released}
        duration={duration}
        cardScale={pauseOverlayScale}
      />
    </div>
  );
}
