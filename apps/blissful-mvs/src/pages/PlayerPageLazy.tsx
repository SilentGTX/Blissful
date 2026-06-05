import { useEffect, useState, type ComponentType } from 'react';

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
 *  in the first place). This wrapper instead caches the resolved component
 *  at module level: once the chunk has landed — via `preloadPlayerPage()`
 *  from AppShell's idle prefetch or DetailPage's on-mount prefetch — every
 *  mount renders PlayerPage synchronously, identical to the old eager
 *  import. Only a never-prefetched first open (deep-link straight to
 *  /player before idle) briefly shows the black backdrop the player opens
 *  over anyway. */
let cached: ComponentType | null = null;
let pending: Promise<ComponentType> | null = null;

export function preloadPlayerPage(): Promise<ComponentType> {
  if (!pending) {
    pending = import('./PlayerPage').then((mod) => {
      cached = mod.default;
      return mod.default;
    });
  }
  return pending;
}

export default function PlayerPageLazy() {
  const [Comp, setComp] = useState<ComponentType | null>(() => cached);

  useEffect(() => {
    if (Comp) return;
    let cancelled = false;
    preloadPlayerPage().then((c) => {
      if (!cancelled) setComp(() => c);
    });
    return () => {
      cancelled = true;
    };
  }, [Comp]);

  // Matches the black surface the player itself opens over, so the
  // unprefetched first-open fallback is imperceptible.
  if (!Comp) return <div className="fixed inset-0 z-50 bg-black" />;
  return <Comp />;
}
