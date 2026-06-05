import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isTvMode, isAndroidTv } from './platform';

/**
 * Global hardware-Back / Escape handler for TV. If an overlay (dialog / select /
 * listbox) is open, it lets that overlay handle Escape (HeroUI closes it);
 * otherwise it navigates to the tracked `bliss:safe-back` route (never
 * navigate(-1), which can walk into /player).
 *
 * In the browser, Esc stands in for the Android hardware Back button. On-device
 * the real Back never reaches JS keydown — the native shell's OnKeyListener
 * (BlissfulMpvPlugin) intercepts KEYCODE_BACK and calls `window.__blissOnBack`,
 * falling back to WebView goBack()/activity finish() when it's undefined or
 * returns false. Only the PLAYER used to define it, so on every other screen
 * Back walked raw WebView history or KILLED THE APP (the on-device "Back exits
 * Blissful" bug). The app-wide ladder is installed here:
 *   1. overlay open → synthesize Escape (every overlay's close path listens);
 *   2. not on the safe-back target → navigate to it;
 *   3. at home → return false so the native side exits (standard TV UX).
 * NativeMpvPlayer still installs its own richer ladder while mounted; this
 * hook stands down on /player and re-installs when the route changes away
 * (the player deletes the global on unmount).
 */
// Native BACK can reach the page through more than one channel at once (the
// OnBackInvokedCallback on 33+, the legacy dispatchKeyEvent path, historical
// view-level listeners) — two ladder invocations for ONE press race each
// other: the first navigates, the second sees "already at target", returns
// false, and the native fallback's goBack() UNDOES the navigation. One press
// = one ladder run; duplicates inside the window report "handled".
let lastNativeBackMs = 0;
export function consumeNativeBackOnce(): boolean {
  const now = Date.now();
  if (now - lastNativeBackMs < 350) return false;
  lastNativeBackMs = now;
  return true;
}

export function useTvBackHandler(): void {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isTvMode()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'GoBack' && e.key !== 'BrowserBack') return;
      // Let an open overlay handle Escape itself (close), don't also navigate.
      if (document.querySelector('[role="dialog"],[role="listbox"],[role="menu"],[aria-modal="true"]')) return;
      e.preventDefault();
      const safeBack = sessionStorage.getItem('bliss:safe-back') ?? '/';
      navigate(safeBack);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Android: the app-wide __blissOnBack ladder (see header comment). Keyed on
  // pathname so it re-installs after the player (which owns the global while
  // mounted, and deletes it on unmount) goes away. Skipped ON /player so a
  // parent-effect re-run can never clobber the player's own ladder.
  useEffect(() => {
    if (!isAndroidTv()) return;
    if (location.pathname.startsWith('/player')) return;
    const w = window as Window & { __blissOnBack?: () => boolean };
    const appBack = () => {
      // Swallow duplicate native deliveries of the same press (see
      // consumeNativeBackOnce) — "true" so no fallback fires for the dupe.
      if (!consumeNativeBackOnce()) return true;
      // 1. An open overlay owns Back: close it via a synthesized Escape —
      //    useTvOverlay, the settings panel, TvSelect etc. all close on it.
      if (
        document.querySelector('[role="dialog"],[role="listbox"],[role="menu"],[aria-modal="true"]')
      ) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
        return true;
      }
      // 2. Page back along the tracked safe route.
      const safeBack = sessionStorage.getItem('bliss:safe-back') ?? '/';
      const here = window.location.pathname + window.location.search;
      if (here !== safeBack && window.location.pathname !== '/') {
        navigate(safeBack);
        return true;
      }
      // 3. At home (or already on the safe target): let the native side
      //    finish the activity — Back at the home screen exits the app.
      return false;
    };
    w.__blissOnBack = appBack;
    return () => {
      if (w.__blissOnBack === appBack) delete w.__blissOnBack;
    };
  }, [navigate, location.pathname]);
}
