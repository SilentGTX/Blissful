import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import Hls from 'hls.js';
import { ChromePicker, type ColorResult } from 'react-color';
// HeroUI overlays are handled by the caller on iOS.
import type { AddonDescriptor } from '../lib/stremioApi';
import type { PlayerSettings } from '../lib/playerSettings';
import { desktop, isNativeShell } from '../lib/desktop';
import type { NextEpisodeInfo } from '../pages/PlayerPage';
import { fetchSubtitles } from '../lib/stremioAddon';
import { setProgress, flushNow } from '../lib/progressStore';
import { addToLibraryItem, updateLibraryItemProgress } from '../lib/stremioApi';
import { getLastStreamSelection, setLastStreamSelection } from '../lib/streamHistory';
import { isElectronDesktopApp } from '../lib/platform';
import { notifyError, notifyInfo, notifySuccess } from '../lib/toastQueues';

type SubtitleTrack = {
  key: string;
  lang: string;
  label: string;
  origin: string;
  url: string;
};

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
  | 'minimize';

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
};

export function StremioIcon({ name, className }: { name: StremioIconName; className?: string }) {
  const icon = STREMIO_ICONS[name];
  if (!icon) return null;
  return (
    <svg viewBox={icon.viewBox} className={className} aria-hidden="true">
      {icon.paths.map((path, index) => (
        <path key={index} d={path.d} style={path.style} />
      ))}
    </svg>
  );
}

type HlsAudioTrack = {
  id: number;
  name?: string;
  lang?: string;
};

type NativeAudioTrack = {
  id?: string;
  label?: string;
  language?: string;
  enabled?: boolean;
};

type NativeAudioTrackList = {
  length: number;
  [index: number]: NativeAudioTrack;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
};

type PlayerAudioTrack = {
  kind: 'hls' | 'native';
  index: number;
  id: string;
  label: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseColor(value: string): { hex: string; alpha: number } {
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hexMatch) {
    return { hex: `#${hexMatch[1]}`, alpha: 1 };
  }
  const rgbaMatch =
    /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/i.exec(value.trim()) ||
    /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(value.trim());
  if (rgbaMatch) {
    const r = Math.min(255, Math.max(0, Number(rgbaMatch[1])));
    const g = Math.min(255, Math.max(0, Number(rgbaMatch[2])));
    const b = Math.min(255, Math.max(0, Number(rgbaMatch[3])));
    const alpha = rgbaMatch[4] ? Math.min(1, Math.max(0, Number(rgbaMatch[4]))) : 1;
    const hex = `#${[r, g, b]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')}`;
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
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

function srtToVtt(input: string): string {
  const normalized = input.replace(/\r+/g, '').trim();
  const withDots = normalized.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
  return `WEBVTT\n\n${withDots}\n`;
}

function looksLikeSrt(text: string): boolean {
  return /(\d\d:\d\d:\d\d,\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d,\d\d\d)/.test(text);
}

function shiftVtt(text: string, delaySeconds: number): string {
  if (!delaySeconds) return text;
  const toSeconds = (value: string) => {
    const [h, m, rest] = value.split(':');
    const [s, ms] = rest.split('.');
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };
  const toTimestamp = (value: number) => {
    const clamped = Math.max(0, value);
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = Math.floor(clamped % 60);
    const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  return text.replace(/(\d\d:\d\d:\d\d\.\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d\.\d\d\d)/g, (_m, a, b) => {
    const start = toTimestamp(toSeconds(a) + delaySeconds);
    const end = toTimestamp(toSeconds(b) + delaySeconds);
    return `${start} --> ${end}`;
  });
}

async function fetchSubtitleVttBlobUrl(url: string, delaySeconds: number): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Subtitle fetch failed: ${resp.status}`);
  const text = await resp.text();
  const base = text.trim().startsWith('WEBVTT') ? text : looksLikeSrt(text) ? srtToVtt(text) : text;
  const body = delaySeconds ? shiftVtt(base, delaySeconds) : base;
  const blob = new Blob([body], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

function isCachedSubtitleBlobUrl(url: string): boolean {
  try {
    const cache: Map<string, string> | undefined = (globalThis as any).__bliss_subtitle_blob_cache;
    if (!cache) return false;
    return Array.from(cache.values()).includes(url);
  } catch {
    return false;
  }
}

function scheduleRevokeSubtitleBlobUrl(url: string): void {
  if (isCachedSubtitleBlobUrl(url)) return;
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, 500);
}

function parseTitleLines(title: string | null): { primary: string | null; secondary: string | null; meta: string | null } {
  if (!title) return { primary: null, secondary: null, meta: null };
  const lines = title
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    primary: lines[0] ?? null,
    secondary: lines[1] ?? null,
    meta: lines.slice(2).join(' · ') || null,
  };
}

function shortenTitle(title: string | null): string | null {
  if (!title) return null;
  const line = title.split(/\r?\n/)[0] ?? '';
  const slashSplit = line.split(' / ')[0] ?? line;
  const dashSplit = slashSplit.split(' - ')[0] ?? slashSplit;
  const bracketSplit = dashSplit.split(' [')[0] ?? dashSplit;
  const cleaned = bracketSplit.replace(/[\[\(].*?[\]\)]/g, '').trim();
  return cleaned || title;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ can report itself as Macintosh.
  const platform = (navigator as any).platform as string | undefined;
  const maxTouchPoints = (navigator as any).maxTouchPoints as number | undefined;
  if (platform === 'MacIntel' && typeof maxTouchPoints === 'number' && maxTouchPoints > 1) return true;
  return false;
}

function isElectron(): boolean {
  // Name kept for grep stability — semantics are now "are we in a desktop
  // shell of any flavor" (legacy Electron OR the native Rust shell).
  if (typeof navigator === 'undefined') return false;
  if (/Electron/i.test(navigator.userAgent || '')) return true;
  return isNativeShell();
}

function applySubtitleLayout(track: TextTrack, position: number): void {
  const cues = track.cues ? Array.from(track.cues) : [];
  for (const cue of cues) {
    try {
      const text = (cue as VTTCue).text ?? (cue as any).text ?? '';
      const next = new VTTCue(cue.startTime, cue.endTime, text);
      next.id = cue.id;
      next.snapToLines = false;
      next.line = position;
      next.lineAlign = 'center';
      next.position = 50;
      next.positionAlign = 'center';
      next.size = 100;
      next.align = 'center';
      track.removeCue(cue);
      track.addCue(next);
    } catch {
      // ignore
    }
  }
  try {
    track.mode = 'disabled';
    track.mode = 'showing';
  } catch {
    // ignore
  }
}

function applySubtitlePositionActive(track: TextTrack, position: number): void {
  const active = track.activeCues ? Array.from(track.activeCues) : [];
  for (const cue of active) {
    try {
      if (cue instanceof VTTCue) {
        cue.snapToLines = false;
        cue.line = position;
        cue.lineAlign = 'center';
        cue.position = 50;
        cue.positionAlign = 'center';
        cue.size = 100;
        cue.align = 'center';
      }
    } catch {
      // ignore
    }
  }
}

function parseMagnetInfo(value: string): { infoHash: string; trackers: string[]; fileIdx: number | null } | null {
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

function parseSeriesInfo(videoId: string | null): { season?: number; episode?: number } | undefined {
  if (!videoId) return undefined;
  const parts = videoId.split(':');
  if (parts.length < 3) return undefined;
  const season = Number.parseInt(parts[parts.length - 2], 10);
  const episode = Number.parseInt(parts[parts.length - 1], 10);
  const result: { season?: number; episode?: number } = {};
  if (Number.isFinite(season) && season > 0) result.season = season;
  if (Number.isFinite(episode) && episode > 0) result.episode = episode;
  return result.season || result.episode ? result : undefined;
}

type MediaCapabilities = {
  formats: string[];
  videoCodecs: string[];
  audioCodecs: string[];
  maxAudioChannels: number;
};


/** Detect which codecs & formats the browser can play natively (matches Stremio's mediaCapabilities.js) */
function detectMediaCapabilities(): MediaCapabilities {
  const v = document.createElement('video');
  const isChrome = !!(window as any).chrome || !!(window as any).cast;
  const inElectron = isElectron();

  // Formats — Stremio always includes mp4, adds matroska/webm for Chrome
  const formats: string[] = ['mp4'];
  if (isChrome) formats.push('matroska,webm');

  // Video codecs — order matters: Stremio's HLS picks the FIRST codec from
  // our list that matches the source. We put HEVC first so HEVC sources are
  // copied (no re-encode, HDR/DV preserved) instead of transcoded to H.264
  // which destroys 4K seek perf. H.264 stays as fallback for H.264 sources.
  const videoCodecs: string[] = [];
  // h265/hevc first — In Electron desktop with GPU acceleration enabled, HEVC
  // is supported via hardware decode (DXVA2/D3D11 on Windows).
  if (inElectron || (!isChrome && (v.canPlayType('video/mp4; codecs="hev1.1.6.L150.B0"') || v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')))) {
    videoCodecs.push('h265', 'hevc');
  }
  // AV1 — modern codec, widely supported in Chromium
  if (v.canPlayType('video/mp4; codecs="av01.0.08M.08"')) videoCodecs.push('av1');
  // H.264 — always supported in Chrome
  if (isChrome || v.canPlayType('video/mp4; codecs="avc1.42E01E"')) videoCodecs.push('h264');
  // VP8/VP9 — Stremio uses mp4 container for probing
  if (v.canPlayType('video/mp4; codecs="vp9"')) videoCodecs.push('vp9');
  if (v.canPlayType('video/mp4; codecs="vp8"')) videoCodecs.push('vp8');

  // Audio codecs — match Stremio's order
  const audioCodecs: string[] = [];
  if (v.canPlayType('audio/mp4; codecs="mp4a.40.2"')) audioCodecs.push('aac');
  if (v.canPlayType('audio/mp4; codecs="mp3"')) audioCodecs.push('mp3');
  if (v.canPlayType('audio/mp4; codecs="ac-3"')) audioCodecs.push('ac3');
  if (v.canPlayType('audio/mp4; codecs="ec-3"')) audioCodecs.push('eac3');
  if (v.canPlayType('audio/mp4; codecs="vorbis"')) audioCodecs.push('vorbis');
  if (v.canPlayType('audio/mp4; codecs="opus"')) audioCodecs.push('opus');
  // DTS — Electron desktop can passthrough to audio hardware
  if (inElectron && v.canPlayType('audio/mp4; codecs="dtsc"')) audioCodecs.push('dts');

  // Max audio channels — Electron desktop supports surround sound (5.1/7.1).
  // In regular Chrome, default to 2 (stereo). Firefox gets 6.
  let maxAudioChannels = 2;
  if (inElectron) {
    // Desktop app — allow surround sound passthrough
    maxAudioChannels = 8;
  } else if (/firefox/i.test(navigator.userAgent)) {
    maxAudioChannels = 6;
  } else if (typeof AudioContext !== 'undefined' && !isChrome) {
    try {
      const ctx = new AudioContext();
      const max = ctx.destination.maxChannelCount;
      maxAudioChannels = max > 0 ? max : 2;
      ctx.close().catch(() => {});
    } catch { /* fallback to 2 */ }
  }

  return { formats, videoCodecs, audioCodecs, maxAudioChannels };
}

let _cachedCapabilities: MediaCapabilities | null = null;
function getMediaCapabilities(playerSettings?: PlayerSettings): MediaCapabilities {
  if (!_cachedCapabilities) _cachedCapabilities = detectMediaCapabilities();
  const caps = _cachedCapabilities;

  if (isElectron() && !playerSettings?.surroundSound) {
    return {
      ...caps,
      videoCodecs: Array.from(new Set([...caps.videoCodecs, 'h264', 'h265', 'hevc', 'av1'])),
      audioCodecs: ['aac'],
      maxAudioChannels: 2,
    };
  }

  return caps;
}

/** Probe media via the streaming server to check if it can be played directly */
/** Build transcoding URL through the streaming server (only used when direct play isn't possible) */
function buildTranscodeUrl(mediaUrl: string, serverUrl: string, playerSettings?: PlayerSettings): string {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const caps = getMediaCapabilities(playerSettings);
  const params = new URLSearchParams();
  params.set('mediaURL', mediaUrl);
  for (const vc of caps.videoCodecs.length > 0 ? caps.videoCodecs : ['h264']) params.append('videoCodecs', vc);
  for (const ac of caps.audioCodecs.length > 0 ? caps.audioCodecs : ['aac', 'mp3', 'opus']) params.append('audioCodecs', ac);
  params.set('maxAudioChannels', String(caps.maxAudioChannels));
  return `${serverUrl}/hlsv2/${id}/master.m3u8?${params.toString()}`;
}

function playerLog(line: string) {
  if (isNativeShell()) {
    desktop.log(line).catch(() => {});
  }
  // eslint-disable-next-line no-console
  console.info(line);
}

/** Drain bytes from BOTH the head and tail of a torrent stream URL in
 *  parallel for a short bootstrap period. Chrome's MKV demuxer reads the head
 *  (format/seekhead), then seeks to end-of-file for cues — without warming
 *  the tail, that seek stalls 5–30s on a cold torrent. Drain budget starts
 *  AFTER first byte so cold-torrent peer discovery doesn't burn the window. */
async function warmTorrentStream(url: string, signal: AbortSignal, t0: number): Promise<void> {
  const headCap = 48 * 1024 * 1024;
  const tailCap = 8 * 1024 * 1024;
  const drainBudgetMs = 4000;

  const drainRange = async (rangeHeader: string, label: string, cap: number): Promise<number> => {
    let drained = 0;
    let firstByteAt: number | null = null;
    try {
      const resp = await fetch(url, { headers: { Range: rangeHeader }, signal });
      if (!resp.ok || !resp.body) return 0;
      playerLog(`[player] +${(performance.now() - t0).toFixed(0)}ms warm ${label}: ${resp.status} ${rangeHeader}`);
      const reader = resp.body.getReader();
      while (drained < cap) {
        if (firstByteAt !== null && performance.now() - firstByteAt > drainBudgetMs) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (firstByteAt === null) firstByteAt = performance.now();
        drained += value.byteLength;
      }
      reader.cancel().catch(() => {});
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        playerLog(`[player] warm ${label} failed: ${(err as Error)?.message ?? String(err)}`);
      }
    }
    return drained;
  };

  const [headBytes, tailBytes] = await Promise.all([
    drainRange('bytes=0-', 'head', headCap),
    drainRange(`bytes=-${tailCap}`, 'tail', tailCap),
  ]);

  playerLog(`[player] +${(performance.now() - t0).toFixed(0)}ms warm done: head=${(headBytes / 1024 / 1024).toFixed(1)} MB tail=${(tailBytes / 1024 / 1024).toFixed(1)} MB`);
}

// IMPORTANT: 127.0.0.1 (IPv4) must come before localhost — on Windows,
// `localhost` resolves to ::1 first and libavformat inside mpv waits the
// full 60s TCP timeout for IPv6 before falling back to IPv4.
const STREAMING_SERVER_CANDIDATES = [
  'http://127.0.0.1:11470',
  'http://localhost:11470',
  'http://[::1]:11470',
];

function getNativeAudioTracks(video: HTMLVideoElement | null): NativeAudioTrackList | null {
  if (!video) return null;
  return ((video as unknown as { audioTracks?: NativeAudioTrackList }).audioTracks) ?? null;
}

function readNativeAudioTracks(video: HTMLVideoElement | null): PlayerAudioTrack[] {
  const tracks = getNativeAudioTracks(video);
  if (!tracks || tracks.length === 0) return [];
  return Array.from({ length: tracks.length }, (_, index) => {
    const track = tracks[index];
    const label = track.label || track.language || `Track ${index + 1}`;
    return {
      kind: 'native',
      index,
      id: `native:${track.id || index}`,
      label,
    };
  });
}

function getSelectedNativeAudioTrackId(video: HTMLVideoElement | null): string | null {
  const tracks = getNativeAudioTracks(video);
  if (!tracks || tracks.length === 0) return null;
  for (let index = 0; index < tracks.length; index += 1) {
    if (tracks[index]?.enabled) return `native:${tracks[index]?.id || index}`;
  }
  return 'native:0';
}

async function pickStreamingServerUrl(): Promise<string> {
  const cached = (globalThis as any).__bliss_streaming_server_url as string | undefined;
  if (cached) return cached;

  for (const base of STREAMING_SERVER_CANDIDATES) {
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), 800);
    try {
      const resp = await fetch(`${base}/`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (resp.ok) {
        (globalThis as any).__bliss_streaming_server_url = base;
        return base;
      }
    } catch {
      // ignore
    } finally {
      window.clearTimeout(timeout);
    }
  }

  const fallback = STREAMING_SERVER_CANDIDATES[0];
  (globalThis as any).__bliss_streaming_server_url = fallback;
  return fallback;
}

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.openbittorrent.com:80/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
];

/** Build the streaming URL directly — same pattern as Stremio desktop: /{infoHash}/{fileIdx}?tr=... */
function buildTorrentStreamUrl(
  infoHash: string,
  trackers: string[],
  serverUrl: string,
  fileIdx: number | null
): string {
  const trackerList = trackers.length > 0 ? trackers : DEFAULT_TRACKERS;
  const params = new URLSearchParams();
  for (const t of trackerList) params.append('tr', t);
  const query = params.toString();
  // -1 tells the streaming server to pick the largest file automatically.
  const selectedFile = fileIdx !== null ? fileIdx : -1;
  return `${serverUrl}/${infoHash}/${selectedFile}${query ? `?${query}` : ''}`;
}

/** Await torrent creation — matches Stremio's createTorrent() which resolves
 *  only after the streaming server has started downloading the torrent.
 *  The server must have data available before we can probe the stream. */
async function createTorrent(
  infoHash: string,
  trackers: string[],
  serverUrl: string,
  seriesInfo?: { season?: number; episode?: number },
): Promise<number | null> {
  const trackerList = trackers.length > 0 ? trackers : DEFAULT_TRACKERS;
  const sources = Array.from(
    new Set([`dht:${infoHash}`, ...trackerList.map((t) => `tracker:${t}`)])
  );
  const body: Record<string, unknown> = {
    torrent: { infoHash },
    // Aggressive peer discovery: ask trackers/DHT for many peers at once so
    // cold-torrent first-byte time is closer to Stremio Desktop. Defaults to
    // 40/200 in Stremio Web; bumping up here.
    peerSearch: sources.length > 0 ? { sources, min: 100, max: 500 } : undefined,
  };
  // Let the streaming server pick the playable file when the addon did not send fileIdx.
  const guess: Record<string, number> = {};
  if (seriesInfo && (seriesInfo.season != null || seriesInfo.episode != null)) {
    if (seriesInfo.season != null) guess.season = seriesInfo.season;
    if (seriesInfo.episode != null) guess.episode = seriesInfo.episode;
  }
  body.guessFileIdx = guess;
  try {
    const resp = await fetch(`${serverUrl}/${infoHash}/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json().catch(() => null)) as { guessedFileIdx?: unknown } | null;
    const guessedFileIdx = data?.guessedFileIdx;
    return Number.isInteger(guessedFileIdx) && (guessedFileIdx as number) >= 0
      ? (guessedFileIdx as number)
      : null;
  } catch {
    // If create fails/times out, continue anyway — probe will decide direct vs transcode
    return null;
  }
}

function subtitleLangLabel(lang: string): string {
  const l = lang.trim().toLowerCase();
  if (!l) return 'Unknown';
  if (l === 'local') return 'Local';
  const map: Record<string, string> = {
    en: 'English',
    eng: 'English',
    es: 'Spanish',
    spa: 'Spanish',
    fr: 'French',
    fra: 'French',
    fre: 'French',
    it: 'Italian',
    ita: 'Italian',
    pt: 'Portuguese',
    por: 'Portuguese',
    ptbr: 'Portuguese (BR)',
    de: 'German',
    deu: 'German',
    ger: 'German',
    nl: 'Dutch',
    nld: 'Dutch',
    dut: 'Dutch',
    ru: 'Russian',
    rus: 'Russian',
    pl: 'Polish',
    pol: 'Polish',
    tr: 'Turkish',
    tur: 'Turkish',
    ar: 'Arabic',
    ara: 'Arabic',
    hi: 'Hindi',
    hin: 'Hindi',
    ja: 'Japanese',
    jpn: 'Japanese',
    ko: 'Korean',
    kor: 'Korean',
    zh: 'Chinese',
    zho: 'Chinese',
    chi: 'Chinese',
    uk: 'Ukrainian',
    ukr: 'Ukrainian',
  };
  if (map[l]) return map[l];
  return l.length <= 4 ? l.toUpperCase() : l;
}

function langPriority(lang: string): number {
  const l = lang.trim().toLowerCase();
  if (l === 'local') return 2;
  if (l === 'eng' || l === 'en') return 1;
  return 0;
}

const LANGUAGE_ALIASES: Record<string, string[]> = {
  en: ['en', 'eng'],
  eng: ['en', 'eng'],
  es: ['es', 'spa'],
  spa: ['es', 'spa'],
  fr: ['fr', 'fre', 'fra'],
  fre: ['fr', 'fre', 'fra'],
  fra: ['fr', 'fre', 'fra'],
  de: ['de', 'ger', 'deu'],
  ger: ['de', 'ger', 'deu'],
  deu: ['de', 'ger', 'deu'],
  it: ['it', 'ita'],
  ita: ['it', 'ita'],
  pt: ['pt', 'por', 'pob', 'ptbr'],
  por: ['pt', 'por', 'pob', 'ptbr'],
  pob: ['pt', 'por', 'pob', 'ptbr'],
  ptbr: ['pt', 'por', 'pob', 'ptbr'],
  ru: ['ru', 'rus'],
  rus: ['ru', 'rus'],
  uk: ['uk', 'ukr'],
  ukr: ['uk', 'ukr'],
  zh: ['zh', 'zho', 'chi'],
  zho: ['zh', 'zho', 'chi'],
  chi: ['zh', 'zho', 'chi'],
  ja: ['ja', 'jpn'],
  jpn: ['ja', 'jpn'],
  ko: ['ko', 'kor'],
  kor: ['ko', 'kor'],
  ar: ['ar', 'ara'],
  ara: ['ar', 'ara'],
  hi: ['hi', 'hin'],
  hin: ['hi', 'hin'],
  tr: ['tr', 'tur'],
  tur: ['tr', 'tur'],
  pl: ['pl', 'pol'],
  pol: ['pl', 'pol'],
  nl: ['nl', 'nld', 'dut'],
  nld: ['nl', 'nld', 'dut'],
  dut: ['nl', 'nld', 'dut'],
  sv: ['sv', 'swe'],
  swe: ['sv', 'swe'],
  no: ['no', 'nor', 'nob', 'nno'],
  nor: ['no', 'nor', 'nob', 'nno'],
  nob: ['no', 'nor', 'nob', 'nno'],
  nno: ['no', 'nor', 'nob', 'nno'],
  da: ['da', 'dan'],
  dan: ['da', 'dan'],
  fi: ['fi', 'fin'],
  fin: ['fi', 'fin'],
  he: ['he', 'heb'],
  heb: ['he', 'heb'],
  el: ['el', 'ell'],
  ell: ['el', 'ell'],
  ro: ['ro', 'ron'],
  ron: ['ro', 'ron'],
  cs: ['cs', 'ces', 'cze'],
  ces: ['cs', 'ces', 'cze'],
  cze: ['cs', 'ces', 'cze'],
  hu: ['hu', 'hun'],
  hun: ['hu', 'hun'],
};

function languageMatch(target: string | null, candidate: string | null): boolean {
  if (!target || !candidate) return false;
  const t = target.trim().toLowerCase();
  const c = candidate.trim().toLowerCase();
  if (!t || !c) return false;
  if (t === c) return true;
  const aliases = LANGUAGE_ALIASES[t] ?? [t];
  return aliases.includes(c);
}

function findMatchingLanguage(list: SubtitleTrack[], target: string | null): string | null {
  if (!target) return null;
  const match = list.find((t) => languageMatch(target, t.lang));
  return match?.lang ?? null;
}

function scoreSubtitleTrack(t: SubtitleTrack): number {
  const origin = t.origin.toLowerCase();
  const url = t.url.toLowerCase();
  let score = 0;
  if (origin.includes('opensubtitles')) score += 50;
  if (origin.includes('subtitles')) score += 20;
  if (url.endsWith('.vtt')) score += 10;
  if (url.endsWith('.srt')) score += 5;
  return score;
}

export default function SimplePlayer(props: {
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
}) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const subtitleBlobUrlRef = useRef<string | null>(null);
  const startAppliedRef = useRef(false);
  const hlsRef = useRef<Hls | null>(null);
  const [desktopStreamUrl, setDesktopStreamUrl] = useState<string | null>(null);
  const [streamingServerUrl, setStreamingServerUrl] = useState<string | null>(null);
  const transcodeFallbackTriedRef = useRef(false);
  const warmAbortRef = useRef<AbortController | null>(null);

  const magnetInfo = useMemo(() => {
    if (!isElectron()) return null;
    return parseMagnetInfo(props.url);
  }, [props.url]);

  useEffect(() => {
    if (!isElectron()) return;
    let cancelled = false;
    void (async () => {
      // Nudge the shell to (re)spawn the bundled stremio-runtime if it
      // died between plays. Safe to call repeatedly; the shell short-
      // circuits if it's healthy. In Phase 1 this command is a stub
      // returning true; Phase 3 wires the real spawn/supervise loop.
      if (isNativeShell()) {
        try {
          await desktop.ensureStreamingServer();
        } catch {
          // ignore — pickStreamingServerUrl will retry/probe
        }
      }
      if (cancelled) return;
      const picked = await pickStreamingServerUrl();
      if (!cancelled) setStreamingServerUrl(picked);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.2);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [instantHideControls, setInstantHideControls] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [subtitleSizePx, setSubtitleSizePx] = useState(props.playerSettings.subtitlesSizePx);
  const [subtitlePosition, setSubtitlePosition] = useState(10);
  const [subtitleColor, setSubtitleColor] = useState(props.playerSettings.subtitlesTextColor);
  const [subtitleBackgroundColor, setSubtitleBackgroundColor] = useState(
    props.playerSettings.subtitlesBackgroundColor
  );
  const [subtitleOutlineColor, setSubtitleOutlineColor] = useState(
    props.playerSettings.subtitlesOutlineColor
  );
  const [colorModal, setColorModal] = useState<'text' | 'bg' | 'outline' | null>(null);
  const [colorPopoverPos, setColorPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [selectedSubtitleKey, setSelectedSubtitleKey] = useState<string>('off');
  const [menuOpen, setMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [audioTracks, setAudioTracks] = useState<PlayerAudioTrack[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const userPickedSubtitleRef = useRef(false);
  const userPickedAudioRef = useRef(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const autoPickedSubtitleKeyRef = useRef<string | null>(null);
  const autoPickAttemptsRef = useRef<Map<string, number>>(new Map());
  const isMenuOpen = menuOpen || audioMenuOpen || optionsMenuOpen;
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

  useEffect(() => {
    if (!toast) return;
    if (toast.toLowerCase().includes('downloaded')) {
      notifySuccess('Player', toast);
      return;
    }
    notifyInfo('Player', toast);
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
    setLastStreamSelection({
      authKey: props.authKey,
      type: props.type,
      id: props.id,
      videoId: props.videoId,
      url: props.url,
      title: props.title,
      logo: props.logo ?? null,
    });
  }, [props.id, props.logo, props.title, props.type, props.url, props.videoId]);

  // ── Electron: resolve desktop stream URL ──
  // HTTP streams: play directly (same as web) — no probe, no streaming server wait.
  // The video element tries the URL immediately; if it fails (incompatible codec),
  // the onError handler falls back to transcode via the streaming server.
  // Torrent streams: need the streaming server for createTorrent + probe.
  useEffect(() => {
    if (!isElectron()) return;
    transcodeFallbackTriedRef.current = false;
    const magnet = magnetInfo;
    if (!magnet && !streamingServerUrl) {
      // HTTP streams can start directly while the desktop server is still booting.
      // Once the server is available, this effect reruns and probes codec support.
      setDesktopStreamUrl(null);
      return;
    }

    if (!streamingServerUrl) return;
    const serverUrl = streamingServerUrl;
    let cancelled = false;
    void (async () => {
      const t0 = performance.now();
      let mediaUrl = props.url;
      if (magnet) {
        // Fire /create. We DO wait briefly (1.5s) for guessedFileIdx so we
        // can use a concrete fileIdx in the URL when the magnet doesn't carry
        // one — but don't block longer than that.
        const createPromise = createTorrent(
          magnet.infoHash,
          magnet.trackers,
          serverUrl,
          parseSeriesInfo(props.videoId)
        );
        const guessedIdx = magnet.fileIdx == null
          ? await Promise.race([
              createPromise,
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
            ])
          : null;
        if (cancelled) return;
        mediaUrl = buildTorrentStreamUrl(
          magnet.infoHash,
          magnet.trackers,
          serverUrl,
          magnet.fileIdx ?? guessedIdx
        );
        playerLog(`[player] +${(performance.now() - t0).toFixed(0)}ms torrent URL ready, fileIdx=${magnet.fileIdx ?? guessedIdx ?? '-1'}`);
      }
      if (cancelled) return;

      // Audio works for ALL streams, but the path depends on the source codec:
      //  - AAC audio: direct play (Chrome's <video> handles it natively, fast
      //    cold-start, no Stremio HLS retry loops on cold torrents).
      //  - Non-AAC audio (E-AC-3/TrueHD/DTS/FLAC/Opus): Stremio HLS with
      //    audioCodecs=aac so audio is transcoded to AAC. Slower cold-start
      //    because HLS.js retries init.mp4 until torrent piece 0 is ready,
      //    but it's the only way to get those codecs playable in Chrome.
      // Probe takes <300ms when stremio-runtime has the source cached.
      let probe: { streams?: Array<{ track?: string; codec?: string }> } | null = null;
      try {
        const resp = await fetch(`${serverUrl}/hlsv2/probe?mediaURL=${encodeURIComponent(mediaUrl)}`, {
          signal: AbortSignal.timeout(2500),
        });
        if (resp.ok) probe = await resp.json();
      } catch {
        // probe failed — default to HLS so we don't silently drop audio
      }
      if (cancelled) return;

      const audio = probe?.streams?.find((s) => s.track === 'audio');
      const audioCodec = (audio?.codec ?? '').toLowerCase();
      const audioIsAac = audioCodec === 'aac' || audioCodec === 'mp4a';

      if (audioIsAac) {
        playerLog(`[player] +${(performance.now() - t0).toFixed(0)}ms audio=aac, direct play (fast): ${mediaUrl}`);
        // For magnet sources, kick off a parallel warm reader that drains
        // head (48 MB) + tail (8 MB, where MKV cues live) for a few seconds.
        // Without this, Chrome's MKV demuxer stalls 5–30s waiting for tail
        // pieces from the cold torrent. After the warm window, we yield
        // bandwidth back to Chrome.
        if (magnet) {
          warmAbortRef.current?.abort();
          const warmAbort = new AbortController();
          warmAbortRef.current = warmAbort;
          void warmTorrentStream(mediaUrl, warmAbort.signal, t0);
        }
        if (!cancelled) setDesktopStreamUrl(mediaUrl);
        return;
      }

      const hlsUrl = buildTranscodeUrl(mediaUrl, serverUrl, props.playerSettings);
      playerLog(`[player] +${(performance.now() - t0).toFixed(0)}ms audio=${audioCodec || 'unknown'}, routing via HLS (audio→aac): ${hlsUrl}`);
      if (!cancelled) setDesktopStreamUrl(hlsUrl);
    })();
    return () => {
      cancelled = true;
      warmAbortRef.current?.abort();
      warmAbortRef.current = null;
    };
  }, [magnetInfo, props.playerSettings, props.url, streamingServerUrl]);

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

  const updateColor = (key: 'text' | 'bg' | 'outline', hex: string, alpha: number) => {
    const rgba = buildRgba(hex, alpha);
    if (key === 'text') setSubtitleColor(rgba);
    if (key === 'bg') setSubtitleBackgroundColor(rgba);
    if (key === 'outline') setSubtitleOutlineColor(rgba);
  };

  const openColorPopover = (key: 'text' | 'bg' | 'outline', target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const popoverWidth = 272;
    const popoverHeight = 340;
    const left = clamp(rect.left + rect.width / 2 - popoverWidth / 2, 12, window.innerWidth - popoverWidth - 12);
    const top = clamp(rect.top - popoverHeight - 10, 12, window.innerHeight - popoverHeight - 12);
    setColorPopoverPos({ top, left });
    setColorModal(key);
  };

  const showExternalPlayer = useMemo(() => !isElectronDesktopApp(), []);
  const hasExternalAction = useMemo(
    () => showExternalPlayer && isHttpUrl(props.url),
    [props.url, showExternalPlayer]
  );
  const externalPlaylistTitle = useMemo(() => {
    const raw = titleLines.secondary ?? titleLines.primary ?? props.title ?? 'stream';
    return safeFilename(raw) || 'stream';
  }, [props.title, titleLines.primary, titleLines.secondary]);

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

  const downloadExternalPlaylist = useCallback(() => {
    if (!isHttpUrl(props.url)) return;
    const body = `#EXTM3U\n#EXTINF:-1,${externalPlaylistTitle}\n${props.url}\n`;
    const blob = new Blob([body], { type: 'audio/x-mpegurl' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${externalPlaylistTitle}.m3u`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    setToast('Downloaded playlist');
    window.setTimeout(() => setToast(null), 1500);
  }, [externalPlaylistTitle, props.url]);


  // iOS prompting happens before opening the player now (DetailPage).

  const selectedSubtitle = useMemo(() => {
    if (selectedSubtitleKey === 'off') return null;
    return subtitleTracks.find((t) => t.key === selectedSubtitleKey) ?? null;
  }, [selectedSubtitleKey, subtitleTracks]);

  const subtitleLanguages = useMemo(() => {
    const uniq = new Map<string, string>();
    for (const t of subtitleTracks) {
      if (!uniq.has(t.lang)) uniq.set(t.lang, t.lang);
    }
    return Array.from(uniq.values()).sort((a, b) => {
      const pa = langPriority(a);
      const pb = langPriority(b);
      if (pb !== pa) return pb - pa;
      return subtitleLangLabel(a).localeCompare(subtitleLangLabel(b));
    });
  }, [subtitleTracks]);

  const tracksForLanguage = useMemo(() => {
    if (!selectedLanguage) return [];
    return subtitleTracks
      .filter((t) => t.lang === selectedLanguage)
      .slice()
      .sort((a, b) => {
        const sa = scoreSubtitleTrack(a);
        const sb = scoreSubtitleTrack(b);
        if (sb !== sa) return sb - sa;
        return a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label);
      });
  }, [selectedLanguage, subtitleTracks]);

  const onBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

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

  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.();
      return;
    }
    void document.exitFullscreen?.();
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
          const preferredTrack = sortedCached[1] ?? sortedCached[0];
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
        const preferredTrack = sortedList[1] ?? sortedList[0];
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

      await Promise.allSettled(
        addons.map(async (addon) => {
          const baseUrl = addon.transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
          const origin = addon.manifest?.name ?? addon.transportUrl;
          const resp = await fetchSubtitles({ type: type as any, id: baseId, baseUrl, signal: controller.signal });
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
        })
      );

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
  }, [props.addons, props.id, props.type, props.videoId, props.playerSettings.subtitlesLanguage]);

  // Load src + apply start time
  useEffect(() => {
    setError(null);
    startAppliedRef.current = false;

    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const onLoadedMetadata = () => {
      if (startAppliedRef.current) return;
      startAppliedRef.current = true;
      if (!props.startTimeSeconds || props.startTimeSeconds <= 0) return;
      try {
        const limit = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 1) : Infinity;
        video.currentTime = clamp(props.startTimeSeconds, 0, limit);
      } catch {
        // ignore
      }
    };

    const onError = () => {
      // If playing directly failed in Electron, fall back to transcoding via
      // the streaming server. Lazily discover the server if not yet known.
      if (isElectron() && !transcodeFallbackTriedRef.current) {
        const currentSrc = desktopStreamUrl ?? props.url;
        if (!currentSrc.includes('/hlsv2/')) {
          transcodeFallbackTriedRef.current = true;
          if (streamingServerUrl) {
            setDesktopStreamUrl(buildTranscodeUrl(currentSrc, streamingServerUrl, props.playerSettings));
          } else {
            void (async () => {
              const serverUrl = await pickStreamingServerUrl();
              setStreamingServerUrl(serverUrl);
              setDesktopStreamUrl(buildTranscodeUrl(currentSrc, serverUrl, props.playerSettings));
            })();
          }
          return;
        }
      }
      setError('Unable to play this stream.');
    };

    const onPlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };
    const onPause = () => {
      setIsPlaying(false);
      flushNow(); // Flush progress to localStorage immediately on pause
    };
    const onTime = () => setCurrentTime(video.currentTime || 0);
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

    video.volume = volume;
    video.muted = muted;
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

    const src = desktopStreamUrl ?? props.url;

    // In Electron, magnets need a resolved local server URL; HTTP streams can attach immediately.
    if (isElectron() && !desktopStreamUrl && !isHttpUrl(props.url)) {
      setIsBuffering(true);
      return () => {};
    }

    const isHls = src.startsWith('blob:') || src.includes('.m3u8') || src.includes('/hlsv2/');
    const hasNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
    const shouldUseHlsJs = isHls && Hls.isSupported() && !hasNativeHls;

    setAudioTracks([]);
    setSelectedAudioTrackId(null);
    let nativeAudioTrackList: NativeAudioTrackList | null = null;
    const updateNativeAudioTracks = () => {
      const tracks = readNativeAudioTracks(video);
      setAudioTracks(tracks);
      setSelectedAudioTrackId(getSelectedNativeAudioTrackId(video));
    };

    if (shouldUseHlsJs) {
      const hls = new Hls({
        debug: false,
        defaultAudioCodec: isElectron() && !props.playerSettings.surroundSound ? 'mp4a.40.2' : undefined,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 50,
        maxMaxBufferLength: 80,
        maxFragLookUpTolerance: 0,
        maxBufferHole: 0,
        appendErrorMaxRetry: 20,
        nudgeMaxRetry: 20,
        manifestLoadingTimeOut: 30000,
        manifestLoadingMaxRetry: 10,
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 10000,
            maxLoadTimeMs: 120000,
            timeoutRetry: { maxNumRetry: 20, retryDelayMs: 0, maxRetryDelayMs: 15 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 15 },
          },
        },
      });
      hlsRef.current = hls;

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
          const tracks = hls.audioTracks ?? [];
          setAudioTracks((tracks as unknown as HlsAudioTrack[]).map((track, index) => ({
            kind: 'hls',
            index,
            id: `hls:${index}`,
            label: track.name || track.lang || `Track ${index + 1}`,
          })));
          if (tracks.length === 0) {
            setSelectedAudioTrackId(null);
            return;
          }
          const current = hls.audioTrack;
          if (!userPickedAudioRef.current && props.playerSettings.audioLanguage) {
            const preferred = tracks.findIndex((track) =>
              languageMatch(props.playerSettings.audioLanguage, track.lang ?? track.name ?? '')
            );
            if (preferred >= 0) {
              selectAudioTrack(preferred);
              return;
            }
          }
          selectAudioTrack(Number.isFinite(current) && current >= 0 ? current : 0);
        };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        updateTracks();
        void video.play().catch(() => {
          // autoplay may be blocked
        });
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
        if (!data.fatal) return;
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
        if (isElectron() && !transcodeFallbackTriedRef.current) {
          const currentSrc = desktopStreamUrl ?? props.url;
          if (!currentSrc.includes('/hlsv2/')) {
            transcodeFallbackTriedRef.current = true;
            if (streamingServerUrl) {
                setDesktopStreamUrl(buildTranscodeUrl(currentSrc, streamingServerUrl, props.playerSettings));
            } else {
              void (async () => {
                const serverUrl = await pickStreamingServerUrl();
                setStreamingServerUrl(serverUrl);
                setDesktopStreamUrl(buildTranscodeUrl(currentSrc, serverUrl, props.playerSettings));
              })();
            }
            return;
          }
        }
        setError('Unable to play this stream.');
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
      void video.play().catch(() => {
        // autoplay may be blocked
      });
    }

    return () => {
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
  }, [desktopStreamUrl, props.playerSettings, props.startTimeSeconds, props.url]);

  useEffect(() => {
    if (isIos()) {
      setShowControls(true);
      return;
    }
    let hideTimer: number | null = null;

    const hideNow = () => {
      setInstantHideControls(true);
      setShowControls(false);
      setMenuOpen(false);
      setAudioMenuOpen(false);
      setOptionsMenuOpen(false);
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
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      if (typeof document === 'undefined') return;
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
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
      const seekStep = (event.shiftKey
        ? props.playerSettings.seekShortTimeDurationMs
        : props.playerSettings.seekTimeDurationMs) / 1000;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const next = Math.max(0, video.currentTime - seekStep);
        video.currentTime = next;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const limit = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
        const next = Math.min(limit, video.currentTime + seekStep);
        video.currentTime = next;
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [props.playerSettings.seekShortTimeDurationMs, props.playerSettings.seekTimeDurationMs]);

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

          const candidates = subtitleTracks
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

        setToast(`Subtitles: ${selectedSubtitle.label}`);
        window.setTimeout(() => setToast(null), 2000);

      } catch {
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
  }, [selectedSubtitle, subtitleDelay, subtitleLinePosition, subtitleTracks, subtitlesKey]);

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


  // Progress sync (local + Stremio) so Continue Watching updates
  useEffect(() => {
    if (!props.authKey || !props.type || !props.id) return;

    const baseName =
      (props.metaTitle && props.metaTitle.trim().length > 0
        ? props.metaTitle
        : props.title && props.title.trim().length > 0
          ? props.title.split('\n')[0]
          : null) ?? props.id;
    const normalizedType = props.type === 'anime' ? 'series' : props.type;

    void addToLibraryItem({
      authKey: props.authKey,
      id: props.id,
      type: normalizedType as any,
      name: baseName,
      poster: props.poster ?? null,
    }).catch(() => {
      // ignore library bootstrap failures
    });
  }, [props.authKey, props.id, props.metaTitle, props.poster, props.title, props.type]);

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

      void updateLibraryItemProgress({
        authKey: props.authKey,
        id: props.id!,
        type: props.type as any,
        videoId: props.videoId ?? null,
        timeSeconds: t,
        durationSeconds: d,
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

  // Auto-advance: navigate to next episode
  const advanceToNextEpisode = useCallback(() => {
    const next = props.nextEpisodeInfo;
    if (!next || !props.type || !props.id) return;
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
      // No stored stream — go to detail page with season/episode hint
      const params = new URLSearchParams();
      params.set('videoId', next.nextVideoId);
      if (next.nextSeason !== null) params.set('season', String(next.nextSeason));
      if (next.nextEpisode !== null) params.set('episode', String(next.nextEpisode));
      navigate(
        `/detail/${encodeURIComponent(props.type)}/${encodeURIComponent(props.id)}?${params.toString()}`,
        { replace: true }
      );
    }
  }, [props.nextEpisodeInfo, props.type, props.id, props.authKey, props.poster, props.metaTitle, props.logo, navigate]);

  // Auto-advance: configurable trigger (Stremio-style).
  // Shows "Up Next" overlay when remaining time <= nextVideoNotificationDurationMs.
  // If the setting is 0 (disabled), only the ended event fires (for bingeWatching).
  const notificationDurationSecRef = useRef(props.playerSettings.nextVideoNotificationDurationMs / 1000);
  notificationDurationSecRef.current = props.playerSettings.nextVideoNotificationDurationMs / 1000;

  const bingeWatchingRef = useRef(props.playerSettings.bingeWatching);
  bingeWatchingRef.current = props.playerSettings.bingeWatching;

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

    // Ended event: always fires as fallback so binge-watching works even if
    // notification is disabled (0) or the time-based trigger was cancelled.
    const onEnded = () => {
      if (upNextFiredRef.current) return;
      if (!showUpNextRef.current && !upNextCancelledRef.current) {
        setShowUpNext(true);
      } else if (bingeWatchingRef.current && !upNextCancelledRef.current) {
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
    if (!props.playerSettings.bingeWatching) return; // no auto-advance countdown

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
    if (!Number.isFinite(value)) return '00:00:00';
    const total = Math.max(0, Math.floor(value));
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video
        ref={videoRef}
        className="bliss-player-video h-full w-full bg-black"
        style={{
          objectFit: 'contain',
          ['--bliss-subtitle-size' as any]: `${subtitleSizePx}px`,
          ['--bliss-subtitle-color' as any]: subtitleColor,
          ['--bliss-subtitle-bg' as any]: subtitleBackgroundColor,
          ['--bliss-subtitle-outline' as any]: subtitleOutlineColor,
        }}
        autoPlay
        playsInline
        onClick={togglePlay}
      />

      {/* Top overlay */}
      <div
        className={
          'pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 via-black/50 to-transparent px-6 pt-6 pb-4 transition-opacity ' +
          (instantHideControls ? 'duration-0 ' : 'duration-300 ') +
          (showControls || isIos() ? 'opacity-100' : 'opacity-0')
        }
      >
         <div className="pointer-events-auto flex items-start justify-between gap-3">
           <button
             type="button"
             className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/15"
             onClick={onBack}
           >
             <StremioIcon name="chevron-back" className="h-5 w-5" />
             <span className="max-w-[40vw] truncate">{headerPrimary ?? 'Back'}</span>
           </button>
         </div>
       </div>
        {isBuffering ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
             <div className="bliss-buffering-panel">
               {props.logo || props.poster ? (
                 <img
                  className="bliss-buffering-loader"
                  src={props.logo ?? props.poster ?? undefined}
                  alt=" "
                />
              ) : (
                <div className="bliss-buffering-fallback">Buffering</div>
             )}
            </div>
          </div>
        ) : null}



       {isMenuOpen ? (
         <div
           className="absolute inset-0 z-25"
           onClick={() => {
             setMenuOpen(false);
             setAudioMenuOpen(false);
             setOptionsMenuOpen(false);
           }}
         />
       ) : null}

      <div
        className={
          'pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-6 pb-6 pt-10 transition-opacity ' +
          (instantHideControls ? 'duration-0 ' : 'duration-300 ') +
          (showControls ? 'opacity-100' : 'opacity-0')
        }
      >
        <div className="pointer-events-auto flex w-full flex-col gap-3 rounded-2xl border border-white/10 bg-black/60 p-4 backdrop-blur">
          <div className="flex items-center gap-4 text-xs text-white/70">
            <div className="w-14 text-right">{formattedTime(currentTime)}</div>
            <input
              className="bliss-player-range h-2 w-full cursor-pointer appearance-none"
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={Math.max(1, Math.round(props.playerSettings.seekShortTimeDurationMs / 1000))}
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => {
                const next = Number.parseFloat(event.target.value);
                const video = videoRef.current;
                if (!video || !Number.isFinite(next)) return;
                video.currentTime = next;
                setCurrentTime(next);
              }}
            />
            <div className="w-14">{formattedTime(duration)}</div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/80">
            <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="bliss-player-icon-btn flex h-12 w-12 items-center justify-center rounded-full"
                  onClick={togglePlay}
                >
                 {isPlaying ? <StremioIcon name="pause" className="h-6 w-6" /> : <StremioIcon name="play" className="h-6 w-6" />}
                </button>
                <button
                  type="button"
                  className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
                  onClick={toggleMute}
                >
                 <StremioIcon
                   name={
                     muted || volume === 0
                       ? 'volume-mute'
                       : !Number.isFinite(volume)
                         ? 'volume-off'
                         : volume < 0.3
                           ? 'volume-low'
                           : volume < 0.7
                             ? 'volume-medium'
                             : 'volume-high'
                   }
                   className="h-5 w-5"
                 />
               </button>
              <input
                className="bliss-player-volume h-2 w-28 cursor-pointer appearance-none"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(event) => {
                  const next = Number.parseFloat(event.target.value);
                  const video = videoRef.current;
                  if (!video || !Number.isFinite(next)) return;
                  video.volume = next;
                  video.muted = next === 0;
                }}
              />
            </div>
            <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={
                    'bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full ' +
                    (audioTracks.length > 1 ? '' : 'cursor-not-allowed opacity-60')
                  }
                  disabled={audioTracks.length <= 1}
                  onClick={() => {
                    if (audioTracks.length <= 1) return;
                    setMenuOpen(false);
                    setOptionsMenuOpen(false);
                    setAudioMenuOpen((v) => !v);
                  }}
                >
                 <StremioIcon name="audio-tracks" className="h-5 w-5" />
               </button>
                <button
                  type="button"
                  className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
                  onClick={() => {
                    setAudioMenuOpen(false);
                    setOptionsMenuOpen(false);
                    setMenuOpen((v) => !v);
                  }}
                >
                 <StremioIcon name="subtitles" className="h-5 w-5" />
               </button>
                <button
                  type="button"
                  className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
                  onClick={() => {
                    setAudioMenuOpen(false);
                    setMenuOpen(false);
                    setOptionsMenuOpen((v) => !v);
                  }}
                >
                 <StremioIcon name="more-horizontal" className="h-5 w-5" />
               </button>
                <button
                  type="button"
                  className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
                  onClick={toggleFullscreen}
                >
                 {isFullscreen ? (
                   <StremioIcon name="minimize" className="h-5 w-5" />
                 ) : (
                   <StremioIcon name="maximize" className="h-5 w-5" />
                 )}
               </button>
            </div>
          </div>
        </div>
      </div>

      {audioMenuOpen && audioTracks.length > 0 ? (
        <div className="absolute right-6 bottom-36 z-30 w-[min(260px,92vw)] overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-2 text-sm text-white backdrop-blur">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/70">Audio</div>
          {audioTracks.map((track) => {
            const isSelected = selectedAudioTrackId === track.id;
            return (
              <button
                key={track.id}
                type="button"
                className={
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10 ' +
                  (isSelected ? 'bg-white/10' : '')
                }
                onClick={() => {
                  userPickedAudioRef.current = true;
                  setSelectedAudioTrackId(track.id);
                  setAudioMenuOpen(false);
                }}
              >
                <span className="truncate">{track.label}</span>
                {isSelected ? <span className="h-2 w-2 rounded-full bg-emerald-300" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {menuOpen ? (
        <div className="absolute right-6 bottom-36 z-30 w-[min(720px,92vw)] rounded-2xl border border-white/10 bg-black/80 p-3 text-sm text-white backdrop-blur">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_220px]">
            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-white/70">Languages</div>
              <div className="max-h-[50vh] overflow-auto rounded-xl border border-white/10 p-1">
                <button
                  type="button"
                  className={
                    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10 ' +
                    (selectedSubtitleKey === 'off' ? 'bg-white/10' : '')
                  }
                  onClick={() => {
                    userPickedSubtitleRef.current = true;
                    autoPickedSubtitleKeyRef.current = null;
                    setSelectedSubtitleKey('off');
                    setSelectedLanguage(null);
                    setMenuOpen(false);
                    try {
                      window.localStorage.removeItem('blissful.subtitleLang');
                    } catch {
                      // ignore
                    }
                  }}
                >
                  <span>Off</span>
                  {selectedSubtitleKey === 'off' ? <span className="h-2 w-2 rounded-full bg-emerald-300" /> : null}
                </button>

                {subtitleLanguages.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    className={
                      'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10 ' +
                      (selectedLanguage === lang ? 'bg-white/10' : '')
                    }
                    onClick={() => {
                      userPickedSubtitleRef.current = true;
                      setSelectedLanguage(lang);
                      const pick = subtitleTracks
                        .filter((t) => t.lang === lang)
                        .slice()
                        .sort((a, b) => a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label))[0];
                      if (pick) setSelectedSubtitleKey(pick.key);
                    }}
                  >
                    <span className="truncate">{subtitleLangLabel(lang)}</span>
                    {selectedLanguage === lang ? <span className="h-2 w-2 rounded-full bg-emerald-300" /> : null}
                  </button>
                ))}

                {subtitleTracks.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-white/60">No subtitles</div>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-white/70">Variants</div>
              <div className="max-h-[50vh] overflow-auto rounded-xl border border-white/10 p-1">
                {selectedLanguage ? (
                  tracksForLanguage.length > 0 ? (
                    tracksForLanguage.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        className={
                          'flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/10 ' +
                          (selectedSubtitleKey === t.key ? 'bg-white/10' : '')
                        }
                        onClick={() => {
                          userPickedSubtitleRef.current = true;
                          autoPickedSubtitleKeyRef.current = null;
                          setSelectedSubtitleKey(t.key);
                          setMenuOpen(false);
                          try {
                            window.localStorage.setItem('blissful.subtitleLang', t.lang);
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        <span className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white/90">{subtitleLangLabel(t.lang)}</div>
                          <div className="truncate text-xs text-white/60">{t.origin}</div>
                        </span>
                        {selectedSubtitleKey === t.key ? <span className="h-2 w-2 rounded-full bg-emerald-300" /> : null}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-xs text-white/60">No variants</div>
                  )
                ) : (
                  <div className="px-3 py-2 text-xs text-white/60">Choose a language</div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-white/70">Settings</div>
              <div className="space-y-4 rounded-xl border border-white/10 p-3 text-xs text-white/70">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span>Delay (s)</span>
                    <span>{subtitleDelay.toFixed(1)}</span>
                  </div>
                  <input
                    className="bliss-player-range h-2 w-full cursor-pointer appearance-none"
                    type="range"
                    min={-5}
                    max={5}
                    step={0.1}
                    value={subtitleDelay}
                    onChange={(event) => setSubtitleDelay(Number.parseFloat(event.target.value))}
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span>Size</span>
                    <span>{subtitleSizePx}px</span>
                  </div>
                  <input
                    className="bliss-player-range h-2 w-full cursor-pointer appearance-none"
                    type="range"
                    min={16}
                    max={64}
                    step={2}
                    value={subtitleSizePx}
                    onChange={(event) => setSubtitleSizePx(Number.parseFloat(event.target.value))}
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span>Position</span>
                    <span>{subtitlePosition}%</span>
                  </div>
                  <input
                    className="bliss-player-range h-2 w-full cursor-pointer appearance-none"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={subtitlePosition}
                    onChange={(event) => setSubtitlePosition(Number.parseFloat(event.target.value))}
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span>Text color</span>
                    <span>{subtitleTextParsed.alpha === 0 ? 'transparent' : subtitleTextParsed.hex.toUpperCase()}</span>
                  </div>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-end rounded-lg border border-white/10 bg-transparent px-2"
                    onClick={(event) => openColorPopover('text', event.currentTarget)}
                  >
                    {subtitleTextParsed.alpha === 0 ? (
                      <span className="text-xs text-white/60">transparent</span>
                    ) : (
                      <span
                        className="h-5 w-full rounded border border-white/20"
                        style={{ background: subtitleTextParsed.hex }}
                      />
                    )}
                  </button>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span>Background</span>
                    <span>{subtitleBgParsed.alpha === 0 ? 'transparent' : subtitleBgParsed.hex.toUpperCase()}</span>
                  </div>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-end rounded-lg border border-white/10 bg-transparent px-2"
                    onClick={(event) => openColorPopover('bg', event.currentTarget)}
                  >
                    {subtitleBgParsed.alpha === 0 ? (
                      <span className="text-xs text-white/60">transparent</span>
                    ) : (
                      <span
                        className="h-5 w-full rounded border border-white/20"
                        style={{ background: subtitleBgParsed.hex }}
                      />
                    )}
                  </button>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span>Outline</span>
                    <span>{subtitleOutlineParsed.alpha === 0 ? 'transparent' : subtitleOutlineParsed.hex.toUpperCase()}</span>
                  </div>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-end rounded-lg border border-white/10 bg-transparent px-2"
                    onClick={(event) => openColorPopover('outline', event.currentTarget)}
                  >
                    {subtitleOutlineParsed.alpha === 0 ? (
                      <span className="text-xs text-white/60">transparent</span>
                    ) : (
                      <span
                        className="h-5 w-full rounded border border-white/20"
                        style={{ background: subtitleOutlineParsed.hex }}
                      />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {colorModal && activeColor && colorPopoverPos ? (
        <div
          className="fixed z-40 rounded-2xl border border-white/10 bg-black/70 p-4 text-white backdrop-blur"
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

      {/* Up Next overlay — auto-advance for series/anime episodes */}
      {showUpNext && props.nextEpisodeInfo && !upNextCancelledRef.current && !upNextFiredRef.current ? (
        <div className="absolute right-4 bottom-24 z-30 w-[min(340px,90vw)] overflow-hidden rounded-2xl border border-white/10 bg-black/80 text-white backdrop-blur sm:right-6 sm:bottom-28">
          {/* Episode thumbnail */}
          {props.nextEpisodeInfo.nextThumbnail ? (
            <div className="relative aspect-video w-full overflow-hidden">
              <img
                src={props.nextEpisodeInfo.nextThumbnail}
                alt=""
                className="h-full w-full object-cover"
                loading="eager"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-2 left-3 text-[10px] font-medium uppercase tracking-wider text-white/60">
                Up Next
              </div>
            </div>
          ) : (
            <div className="px-4 pt-4 text-[10px] font-medium uppercase tracking-wider text-white/50">
              Up Next
            </div>
          )}
          <div className="p-4 pt-2">
            <div className="mb-3 text-sm font-semibold leading-snug">
              {props.nextEpisodeInfo.nextEpisodeTitle}
            </div>
            {/* Countdown progress bar (only when binge-watching auto-advances) */}
            {props.playerSettings.bingeWatching ? (
              <>
                <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#19f7d2] transition-all duration-1000 ease-linear"
                    style={{ width: `${(upNextCountdown / 10) * 100}%` }}
                  />
                </div>
              </>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                onClick={handleCancelUpNext}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-[#19f7d2] px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-[#14dbb8]"
                onClick={advanceToNextEpisode}
              >
                Play Now
              </button>
            </div>
            {props.playerSettings.bingeWatching ? (
              <div className="mt-2 text-center text-[10px] text-white/30">
                Playing in {upNextCountdown}s
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {optionsMenuOpen && hasExternalAction ? (
        <div className="absolute right-6 bottom-36 z-30 w-[min(280px,92vw)] overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-2 text-sm text-white backdrop-blur">
          {isIos() ? (
            <button
              type="button"
              className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10"
              onClick={() => {
                openInVlc(props.url);
                setOptionsMenuOpen(false);
              }}
            >
              Play in VLC
            </button>
          ) : (
            <button
              type="button"
              className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10"
              onClick={() => {
                downloadExternalPlaylist();
                setOptionsMenuOpen(false);
              }}
            >
              Download VLC Playlist (.m3u)
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
