import { useEffect, useState } from 'react';
import type { LibraryItem } from '../../../lib/mediaTypes';
import { fetchBlissfulLibrary } from '../../../lib/blissfulAuthApi';

export function useContinueWatching(authKey: string | null) {
  const [continueWatching, setContinueWatching] = useState<LibraryItem[]>([]);

  useEffect(() => {
    if (!authKey) {
      setContinueWatching([]);
      return;
    }

    let cancelled = false;

    const refreshContinueWatching = () => {
      fetchBlissfulLibrary<LibraryItem>(authKey)
        .then((items) => {
          if (cancelled) return;
          const inProgress = items
            // Continue Watching is purely "things I'm currently
            // watching" — bookmark status (item.removed) is irrelevant
            // here. The in-CW "Remove" action wipes state.timeOffset to
            // 0, which is the only thing that hides a row from CW.
            // Otherwise removing from Library would also nuke CW for
            // any title the user had played but un-bookmarked.
            .filter((item) => typeof item.state?.timeOffset === 'number')
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
        .catch(() => {
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
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blissful:progress', onProgress as EventListener);
    };
  }, [authKey]);

  return { continueWatching, setContinueWatching };
}
