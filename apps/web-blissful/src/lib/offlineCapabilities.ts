// Can THIS browser play a downloaded stream back?
//
// Offline playback feeds stored MPEG-TS segments into MSE through hls.js. That
// makes MSE the hard gate — and on iPhone, MSE only exists as
// `ManagedMediaSource` (iOS 17.1+). Everything below 17.1 has native HLS only,
// and native HLS goes through AVFoundation, which we cannot feed from
// IndexedDB. So: no MSE, no offline. We detect the capability itself rather
// than sniffing versions, because that's what actually determines playability.
//
// Downloading has a second, softer gate: storage. iOS storage is evictable, and
// a plain Safari tab's script-writable storage can be cleared after a week of
// no interaction — an installed (Add to Home Screen) web app is the durable
// case. We report that as a warning, not a block.

import { offlineStorageAvailable } from './offlineStore';

export type OfflineCapabilities = {
  /** Segments can be stored. */
  canStore: boolean;
  /** Stored segments can be played back (MSE or ManagedMediaSource present). */
  canPlay: boolean;
  /** Full MediaSource — desktop, Android, iPad. */
  hasMse: boolean;
  /** ManagedMediaSource only — iPhone on iOS 17.1+. */
  hasManagedMse: boolean;
  /** Running as an installed PWA (Home Screen / standalone window). */
  isInstalled: boolean;
  /** iOS/iPadOS (including iPad's desktop-class Safari UA). */
  isIosLike: boolean;
  /** iOS major.minor when we can read it from the UA, else null. */
  iosVersion: string | null;
  /** Screen Wake Lock available — keeps a long download from being cut off by
   *  the display sleeping. Absent is survivable; the user just has to keep the
   *  screen awake themselves. */
  hasWakeLock: boolean;
  /** Human-readable reason `canPlay` is false, else null. */
  blockedReason: string | null;
};

function detectIosLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports a macOS UA; touch points give it away.
  return /Macintosh/i.test(ua) && typeof document !== 'undefined' && navigator.maxTouchPoints > 1;
}

function detectIosVersion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const m = (navigator.userAgent || '').match(/OS (\d+)[._](\d+)(?:[._](\d+))?/);
  return m ? `${m[1]}.${m[2]}` : null;
}

export function detectOfflineCapabilities(): OfflineCapabilities {
  const w = typeof window === 'undefined' ? undefined : (window as unknown as Record<string, unknown>);
  const hasMse = typeof w?.MediaSource === 'function';
  const hasManagedMse = typeof w?.ManagedMediaSource === 'function';
  const isIosLike = detectIosLike();
  const canStore = offlineStorageAvailable();
  const canPlay = hasMse || hasManagedMse;
  const isInstalled =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches === true ||
      // iOS's own flag for a Home Screen web app.
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  let blockedReason: string | null = null;
  if (!canPlay) {
    blockedReason = isIosLike
      ? 'Offline playback needs iOS 17.1 or later. Older iOS versions can only play streams through Safari’s built-in player, which cannot read downloaded files.'
      : 'This browser has no Media Source Extensions, so it cannot play downloaded streams.';
  } else if (!canStore) {
    blockedReason = 'This browser has storage disabled (private mode?), so downloads cannot be saved.';
  }

  return {
    canStore,
    canPlay,
    hasMse,
    hasManagedMse,
    isInstalled,
    isIosLike,
    iosVersion: isIosLike ? detectIosVersion() : null,
    hasWakeLock: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
    blockedReason,
  };
}

/** True when downloading is worth offering at all. */
export function offlineSupported(): boolean {
  const caps = detectOfflineCapabilities();
  return caps.canStore && caps.canPlay;
}

/** Warning to show alongside the download UI when storage is likely to be
 *  evicted — the "you should install this to the Home Screen" nudge. Null when
 *  there's nothing to warn about. */
export function offlineDurabilityWarning(caps: OfflineCapabilities): string | null {
  if (!caps.isIosLike || caps.isInstalled) return null;
  return 'In a Safari tab, iOS can delete downloads after about a week of not using Blissful. Add Blissful to your Home Screen (Share → Add to Home Screen) to keep them.';
}
