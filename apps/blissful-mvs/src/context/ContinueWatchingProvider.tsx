// Continue-watching feed + open-flow, lifted out of AppShell.
//
// Owns:
//   * the list itself (delegates to `useContinueWatching`),
//   * the per-account `useContinueWatchingActions` adapter (which
//     handles the navigation + state cleanup + iOS-VLC drawer),
//   * the resume-modal flow and the black-veil "pending navigation"
//     overlay timing.
//
// Consumers (SideNav, ResumeOrStartOverModal, pending overlay) read
// `continueWatching`, `onOpenContinueItem`, and `onRemoveContinueItem`
// directly without going through AppShell or the deprecated
// AppContext facade.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { LibraryItem } from '../lib/mediaTypes';
import { hasMeaningfulResume } from '../layout/app-shell/utils';
import { useContinueWatching } from '../layout/app-shell/hooks/useContinueWatching';
import { useContinueWatchingActions } from '../layout/app-shell/hooks/useContinueWatchingActions';
import { useAuth } from './AuthProvider';
import { useModals } from './ModalsProvider';

type ContinueOpenOptions = { source?: 'mobile' | 'desktop' };
type ContinueRunOptions = ContinueOpenOptions & {
  mode?: 'resume' | 'start-over' | 'advance';
};

type ContinueWatchingContextValue = {
  continueWatching: LibraryItem[];
  continueSyncError: string | null;
  setContinueSyncError: (value: string | null) => void;
  onOpenContinueItem: (item: LibraryItem, options?: ContinueOpenOptions) => void;
  onRemoveContinueItem: (item: LibraryItem) => void;
  /** Drives the resume-vs-start-over modal's Resume button. */
  runResume: (item: LibraryItem) => void;
  /** Drives the resume-vs-start-over modal's Start-over button. */
  runStartOver: (item: LibraryItem) => void;
};

export const ContinueWatchingContext = createContext<ContinueWatchingContextValue | null>(null);

export function useContinueWatchingContext(): ContinueWatchingContextValue {
  const ctx = useContext(ContinueWatchingContext);
  if (!ctx) {
    throw new Error(
      'useContinueWatchingContext must be used within a ContinueWatchingProvider',
    );
  }
  return ctx;
}

export function ContinueWatchingProvider({ children }: { children: ReactNode }) {
  const { authKey } = useAuth();
  const navigate = useNavigate();
  const {
    setResumeModalItem,
    setUnavailableItem,
    setUnavailableReason,
  } = useModals();

  const { continueWatching, setContinueWatching } = useContinueWatching(authKey);
  const [continueSyncError, setContinueSyncError] = useState<string | null>(null);

  const { onOpenContinueItem: navigateContinueItem, onRemoveContinueItem } =
    useContinueWatchingActions({
      authKey,
      navigate,
      setContinueWatching,
      setContinueSyncError,
      onStreamUnavailable: (item) => {
        // The only caller today is the RD-only Android resume guard, so
        // flag the reason before opening the global modal — the mount in
        // AppShell reads it to swap in the Real-Debrid-specific copy.
        setUnavailableReason('rd-required');
        setUnavailableItem(item);
      },
    });

  // Simplified: navigate straight to the destination. The old code raised a
  // full-screen black "pending" veil here (+ a route-change effect + a 10s
  // timeout backstop that could strand a black screen if you re-opened the
  // route you were already on). The destination already renders its own
  // loading state — the player's mpv-buffering screen, the detail autoplay
  // overlay — so the veil only masked a sub-second flash at the cost of a real
  // stuck-screen failure mode. Dropped entirely; just navigate.
  const runContinue = useCallback(
    async (item: LibraryItem, options?: ContinueRunOptions) => {
      await navigateContinueItem(item, options);
    },
    [navigateContinueItem],
  );

  const onOpenContinueItem = useCallback(
    (item: LibraryItem, options?: ContinueOpenOptions) => {
      const isSeries = item.type === 'series' || item.type === 'anime';
      // Only offer Resume for GENUINE mid-watch progress on the last-played
      // episode/movie: a sub-15s leftover (would render "Resume 0:00") or a
      // basically-finished item (offset > 95% of duration) is NOT resumable.
      const meaningfulResume = hasMeaningfulResume(item);

      // Inside a watch party (current URL carries ?room=…), skip the
      // Resume / Start-over modal entirely — the party's video is
      // host-driven and we don't want a per-user resume seek fighting the
      // room's timeline. Just start the new show from the beginning;
      // navigation drops ?room= so the user cleanly leaves the party.
      if (typeof window !== 'undefined' && /[?&]room=/.test(window.location.search)) {
        void runContinue(item, { ...options, mode: 'start-over' });
        return;
      }

      if (meaningfulResume) {
        // Case (a): real partial progress — bounce through the
        // Resume / Start-over modal first.
        setResumeModalItem(item);
        return;
      }

      // Case (b): no meaningful progress. A series opens the detail page and
      // lands the bottom EPISODES rail on the next-to-watch episode (focused, no
      // autoplay, no stale `t=`/videoId) WITHOUT opening the stream-selection
      // popup — the detail page computes the target from the watched bitfield.
      // A movie just starts over.
      void runContinue(item, { ...options, mode: isSeries ? 'advance' : 'start-over' });
    },
    [runContinue, setResumeModalItem],
  );

  const runResume = useCallback(
    (item: LibraryItem) => {
      setResumeModalItem(null);
      void runContinue(item, { mode: 'resume' });
    },
    [runContinue, setResumeModalItem],
  );

  const runStartOver = useCallback(
    (item: LibraryItem) => {
      setResumeModalItem(null);
      void runContinue(item, { mode: 'start-over' });
    },
    [runContinue, setResumeModalItem],
  );

  const value = useMemo<ContinueWatchingContextValue>(
    () => ({
      continueWatching,
      continueSyncError,
      setContinueSyncError,
      onOpenContinueItem,
      onRemoveContinueItem,
      runResume,
      runStartOver,
    }),
    [
      continueWatching,
      continueSyncError,
      setContinueSyncError,
      onOpenContinueItem,
      onRemoveContinueItem,
      runResume,
      runStartOver,
    ],
  );

  return (
    <ContinueWatchingContext.Provider value={value}>{children}</ContinueWatchingContext.Provider>
  );
}
