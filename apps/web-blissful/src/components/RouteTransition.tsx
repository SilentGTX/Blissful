import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

// Plain CSS route transition. No Framer Motion, no AnimatePresence,
// no popLayout — those piled up animations and caused flicker. The
// wrapper remounts on every pathname change (via the `key` prop) so
// the CSS keyframe runs once per route. Old route unmounts instantly;
// new route fades in via `bliss-route-fade`. Body bg is `#000`, so
// the brief gap before the new route paints isn't a flash.
export function RouteTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  // Key by the *first path segment* (e.g. "discover", "detail", "player",
  // "library", "home" for "/") instead of the full pathname. Otherwise
  // sub-route changes within the same section retrigger the keyframe —
  // notably DiscoverPage's mount-time redirect from `/discover` to
  // `/discover/<encoded-cinemeta>/movie/top` would cause the route fade
  // to run *twice* in quick succession, which reads as "the page
  // flashing multiple times" during what should be a single transition.
  const sectionKey = location.pathname.split('/')[1] || 'home';
  return (
    <div
      key={sectionKey}
      style={{
        minHeight: 'inherit',
        height: 'inherit',
        animation: 'bliss-route-fade 220ms ease-out both',
      }}
    >
      {children}
    </div>
  );
}
