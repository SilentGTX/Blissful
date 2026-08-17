// Is the device online? Drives the app's offline mode (see AppShell).
//
// `navigator.onLine === false` is the only signal a browser gives that is
// reliable in the direction we care about: false means there is definitively no
// connection (airplane mode, no Wi-Fi). True does NOT mean the internet is
// reachable — a captive portal or a dead server still reports true — so this is
// used to decide "collapse to the downloads-only view", never to decide that
// something IS reachable.

import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

/** Read once, without subscribing — for non-React callers. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
