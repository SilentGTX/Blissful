import { useEffect, useState } from 'react';

// matchMedia-backed hook for height-based breakpoints. Returns true
// when `(max-height: maxPx)` matches the current viewport. Re-runs
// on resize via the MediaQueryList's change event (no manual resize
// listener needed).
//
// Used by SideNav to fold its footer accordions into drawer triggers
// on short displays, and to flip the whole sidebar into mobile
// bottom-nav mode when the viewport is too short for even the
// collapsed sidebar to be useful.
export function useViewportShorterThan(maxPx: number): boolean {
  const query = `(max-height: ${maxPx}px)`;
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
