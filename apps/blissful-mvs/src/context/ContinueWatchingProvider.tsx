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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { LibraryItem } from '../lib/stremioApi';
import { getResumeSeconds } from '../layout/app-shell/utils';
import { useContinueWatching } from '../layout/app-shell/hooks/useContinueWatching';
import { useContinueWatchingActions } from '../layout/app-shell/hooks/useContinueWatchingActions';
import { useAuth } from './AuthProvider';
import { useModals } from './ModalsProvider';

type ContinueOpenOptions = { source?: 'mobile' | 'desktop' };
type ContinueRunOptions = ContinueOpenOptions & { mode?: 'resume' | 'start-over' };

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
  const location = useLocation();
  const {
    setResumeModalItem,
    setUnavailableItem,
    setIosPlayPrompt,
    setPendingContinueItem,
  } = useModals();

  const { continueWatching, setContinueWatching } = useContinueWatching(authKey);
  const [continueSyncError, setContinueSyncError] = useState<string | null>(null);

  const { onOpenContinueItem: navigateContinueItem, onRemoveContinueItem } =
    useContinueWatchingActions({
      authKey,
      navigate,
      setContinueWatching,
      setContinueSyncError,
      setIosPlayPrompt,
      onStreamUnavailable: (item) => setUnavailableItem(item),
    });

  // Pending-overlay path tracking. We clear the black veil only after
  // React commits the new route — clearing on `navigate()` return
  // gives a paint of the old page before the new one mounts.
  const continueOverlayPathRef = useRef(location.pathname);
  useEffect(() => {
    if (continueOverlayPathRef.current !== location.pathname) {
      continueOverlayPathRef.current = location.pathname;
      setPendingContinueItem(null);
    }
  }, [location.pathname, setPendingContinueItem]);

  const runContinue = useCallback(
    async (item: LibraryItem, options?: ContinueRunOptions) => {
      setPendingContinueItem(item);
      try {
        await navigateContinueItem(item, options);
      } catch {
        // Navigation itself can't throw today, but if it ever does the
        // overlay-clear timeout below acts as a backstop.
      }
      // Safety net for "we navigated to the route we're already on" —
      // the route-change effect would never fire, so the overlay would
      // get stuck until next navigation. 10s is long enough for the
      // slowest plausible load.
      window.setTimeout(() => setPendingContinueItem(null), 10000);
    },
    [navigateContinueItem, setPendingContinueItem],
  );

  const onOpenContinueItem = useCallback(
    (item: LibraryItem, options?: ContinueOpenOptions) => {
      const seconds = getResumeSeconds(item);
      if (!seconds || seconds <= 0) {
        void runContinue(item, { ...options, mode: 'start-over' });
        return;
      }
      // Has a saved offset — bounce through the Resume/Start-over
      // modal first.
      setResumeModalItem(item);
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
