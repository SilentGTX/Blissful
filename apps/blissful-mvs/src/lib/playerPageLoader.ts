import type { ComponentType } from 'react';

/** Module-level cache for the code-split PlayerPage chunk (see
 *  pages/PlayerPageLazy.tsx for why React.lazy/Suspense is not used).
 *  Lives in its own module (not PlayerPageLazy.tsx) so component files
 *  keep a single component export for react-refresh. */
let cached: ComponentType | null = null;
let pending: Promise<ComponentType> | null = null;

export function getCachedPlayerPage(): ComponentType | null {
  return cached;
}

export function preloadPlayerPage(): Promise<ComponentType> {
  if (!pending) {
    pending = import('../pages/PlayerPage').then(
      (mod) => {
        cached = mod.default;
        return mod.default;
      },
      (err: unknown) => {
        // Don't memoise a FAILED import: a transient fetch error (dev server
        // hiccup, flaky network on web) would otherwise poison every future
        // preload/mount with the same rejected promise — a permanent black
        // screen on /player. Clearing lets the next call retry the import.
        pending = null;
        throw err;
      }
    );
  }
  return pending;
}
