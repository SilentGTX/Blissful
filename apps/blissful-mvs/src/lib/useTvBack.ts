import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isTvMode } from './platform';

/**
 * Global hardware-Back / Escape handler for TV. If an overlay (dialog / select /
 * listbox) is open, it lets that overlay handle Escape (HeroUI closes it);
 * otherwise it navigates to the tracked `bliss:safe-back` route (never
 * navigate(-1), which can walk into /player).
 *
 * In the browser, Esc stands in for the Android hardware Back button. On-device
 * the real Back is wired separately via Tauri `app.onBackButtonPress` (Phase 2,
 * device-only) — this handler is the browser-testable equivalent.
 */
export function useTvBackHandler(): void {
  const navigate = useNavigate();
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
}
