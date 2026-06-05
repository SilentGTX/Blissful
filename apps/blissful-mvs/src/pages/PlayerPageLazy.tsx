import { useEffect, useState, type ComponentType } from 'react';
import { getCachedPlayerPage, preloadPlayerPage } from '../lib/playerPageLoader';

/** Suspense-free lazy PlayerPage.
 *
 *  PlayerPage (and its NativeMpvPlayer subtree — the single largest feature
 *  in the bundle) used to be statically imported by App.tsx, which kept it
 *  inside the blocking entry chunk parsed before first paint on every cold
 *  start. That parse cost is what a low-end Android TV (Cortex-A53) feels as
 *  a slow boot, so the player must be code-split out of the entry.
 *
 *  React.lazy + <Suspense> is deliberately NOT used: Suspense's reconnect
 *  cycle in React 19 fires effects twice during resolution and caused a
 *  visible flash on every player open (the reason the import was made eager
 *  in the first place). This wrapper instead reads the module-level cache in
 *  lib/playerPageLoader: once the chunk has landed — via `preloadPlayerPage()`
 *  from AppShell's idle prefetch or DetailPage's on-mount prefetch — every
 *  mount renders PlayerPage synchronously, identical to the old eager
 *  import. Only a never-prefetched first open (deep-link straight to
 *  /player before idle) briefly shows the black backdrop the player opens
 *  over anyway. */
export default function PlayerPageLazy() {
  const [Comp, setComp] = useState<ComponentType | null>(() => getCachedPlayerPage());
  // Bumped to re-arm the load effect after a failed import (the loader
  // clears its poisoned promise; this retriggers a fresh attempt).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (Comp) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    preloadPlayerPage().then(
      (c) => {
        if (!cancelled) setComp(() => c);
      },
      () => {
        // Transient import failure: retry after a beat instead of sitting on
        // the black fallback forever. Back button stays functional throughout.
        if (!cancelled) retryTimer = window.setTimeout(() => setAttempt((n) => n + 1), 1000);
      }
    );
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [Comp, attempt]);

  // Matches the black surface the player itself opens over, so the
  // unprefetched first-open fallback is imperceptible.
  if (!Comp) return <div className="fixed inset-0 z-50 bg-black" />;
  return <Comp />;
}
