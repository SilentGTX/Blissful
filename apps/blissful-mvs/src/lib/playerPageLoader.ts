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
    pending = import('../pages/PlayerPage').then((mod) => {
      cached = mod.default;
      return mod.default;
    });
  }
  return pending;
}
