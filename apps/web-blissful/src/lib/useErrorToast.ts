import { useEffect, useRef } from 'react';
import { notifyError } from './toastQueues';

export function useErrorToast(message: string | null | undefined, title?: string) {
  const lastShownRef = useRef<string | null>(null);

  useEffect(() => {
    if (!message) {
      lastShownRef.current = null;
      return;
    }

    // Offline is an expected state now that downloads exist: opening the app on
    // a plane would otherwise stack up a toast per network-backed feature
    // (catalog, addons, library, presence…) to report the one fact the user
    // already knows. Only suppress when the browser is CERTAIN there's no
    // connection — `onLine === true` doesn't imply reachable, so a dead server
    // on a live connection still reports normally.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }

    const key = `${title ?? ''}:${message}`;
    if (lastShownRef.current === key) return;

    lastShownRef.current = key;
    notifyError(title ?? 'Error', message);
  }, [message, title]);
}
