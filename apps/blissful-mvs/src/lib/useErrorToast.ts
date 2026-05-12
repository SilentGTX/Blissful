import { useEffect, useRef } from 'react';
import { notifyError } from './toastQueues';

export function useErrorToast(message: string | null | undefined, title?: string) {
  const lastShownRef = useRef<string | null>(null);

  useEffect(() => {
    if (!message) {
      lastShownRef.current = null;
      return;
    }

    const key = `${title ?? ''}:${message}`;
    if (lastShownRef.current === key) return;

    lastShownRef.current = key;
    notifyError(title ?? 'Error', message);
  }, [message, title]);
}
