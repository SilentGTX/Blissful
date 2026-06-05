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
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  /** Pre-navigation buffering veil (black + stream logo). Non-null from the
   *  moment Resume/Start-over is clicked until the destination route
   *  commits — AppShell renders PlayerBufferingScreen from it so the click
   *  feels instant and the veil merges into /player's own buffer screen. */
  pendingContinueVeil: { logo: string | null } | null;
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
  const location = useLocation();
  const {
    setResumeModalItem,
    setUnavailableItem,
    setUnavailableReason,
  } = useModals();

  const { continueWatching, setContinueWatching } = useContinueWatching(authKey);
  const [continueSyncError, setContinueSyncError] = useState<string | null>(null);

  // Pre-navigation buffering veil. The stored-stream resume path runs a
  // dead-link probe + a meta-image fetch BEFORE navigate('/player') — network
  // round-trips during which the user otherwise just stares at the page they
  // clicked on (seconds on a TV). Raise the black+logo veil the instant the
  // click lands; AppShell renders it via PlayerBufferingScreen so it pixel-
  // matches /player's own buffer screen and the handoff is seamless.
  //
  // An earlier veil was removed because it could strand a black screen. The
  // failure modes are each closed here: (a) cleared on LOCATION IDENTITY
  // change — every navigate() commits a new location object (new key) even
  // for an identical path, so "re-opened the route you were on" clears too;
  // (b) cleared when the RD-required guard bails without navigating;
  // (c) cleared if the navigation path throws; (d) a backstop timeout
  // catches anything left.
  const [pendingContinueVeil, setPendingContinueVeil] =
    useState<{ logo: string | null } | null>(null);
  useEffect(() => {
    setPendingContinueVeil(null);
  }, [location]);
  useEffect(() => {
    if (!pendingContinueVeil) return;
    const t = window.setTimeout(() => setPendingContinueVeil(null), 12000);
    return () => window.clearTimeout(t);
  }, [pendingContinueVeil]);

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
        // No navigation happens on this path, so drop the veil here.
        setPendingContinueVeil(null);
        setUnavailableReason('rd-required');
        setUnavailableItem(item);
      },
      // Player-bound stored-stream path: upgrade the veil's logo (fires
      // synchronously with the stream history's logo, and possibly again
      // when the parallel meta fetch resolves one). UPGRADE-ONLY: if the
      // veil was already cleared (route committed, RD guard bailed), a late
      // resolve must not re-raise it — `runContinue` does the raising.
      onPendingNavigation: (logo) =>
        setPendingContinueVeil((prev) => (prev ? { logo } : prev)),
    });

  const runContinue = useCallback(
    async (item: LibraryItem, options?: ContinueRunOptions) => {
      // 'advance' opens the detail page's episode rail — a normal screen,
      // no veil. Everything else is playback-bound: cover instantly (logo
      // upgraded by onPendingNavigation when the stored stream has one).
      if (options?.mode !== 'advance') setPendingContinueVeil({ logo: null });
      try {
        await navigateContinueItem(item, options);
      } catch {
        // Navigation never happened — never leave the veil stranded.
        setPendingContinueVeil(null);
      }
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
      pendingContinueVeil,
    }),
    [
      continueWatching,
      continueSyncError,
      setContinueSyncError,
      onOpenContinueItem,
      onRemoveContinueItem,
      runResume,
      runStartOver,
      pendingContinueVeil,
    ],
  );

  return (
    <ContinueWatchingContext.Provider value={value}>{children}</ContinueWatchingContext.Provider>
  );
}
