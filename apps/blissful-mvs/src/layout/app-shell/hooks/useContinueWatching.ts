import { useEffect, useState } from 'react';
import { datastoreGetLibraryItems, type LibraryItem } from '../../../lib/stremioApi';

export function useContinueWatching(authKey: string | null) {
  const [continueWatching, setContinueWatching] = useState<LibraryItem[]>([]);

  useEffect(() => {
    if (!authKey) {
      setContinueWatching([]);
      return;
    }

    let cancelled = false;
    let activeController: AbortController | null = null;

    const refreshContinueWatching = () => {
      // Abort any in-flight request before starting a new one
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;

      datastoreGetLibraryItems({ authKey, signal: controller.signal })
        .then((items) => {
          if (cancelled) return;
          const inProgress = items
            .filter((item) => (!item.removed || item.temp) && typeof item.state?.timeOffset === 'number')
            .filter((item) => {
              const timeOffset = item.state?.timeOffset ?? 0;
              const duration = item.state?.duration ?? 0;
              const isExternalPlayer = timeOffset === 0 && duration === 1;
              return timeOffset > 0 || isExternalPlayer;
            })
            .sort((a, b) => {
              const am = typeof a._mtime === 'number' ? a._mtime : Date.parse(String(a._mtime ?? ''));
              const bm = typeof b._mtime === 'number' ? b._mtime : Date.parse(String(b._mtime ?? ''));
              return (bm || 0) - (am || 0);
            });
          setContinueWatching(inProgress);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (cancelled) return;
          setContinueWatching([]);
        });
    };

    refreshContinueWatching();
    const interval = window.setInterval(refreshContinueWatching, 15000);
    const onFocus = () => refreshContinueWatching();
    const onProgress = () => refreshContinueWatching();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blissful:progress', onProgress as EventListener);

    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blissful:progress', onProgress as EventListener);
    };
  }, [authKey]);

  return { continueWatching, setContinueWatching };
}
