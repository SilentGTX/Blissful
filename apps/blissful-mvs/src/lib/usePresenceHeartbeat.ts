// Sends a presence heartbeat to blissful-storage every ~30s while the
// user is signed in. The body optionally carries the current playback
// activity so friends see "watching <title>" rather than just
// "online". Cleared on logout / tab close.

import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthProvider';
import { postHeartbeat, type PresenceActivity } from './blissfulAuthApi';

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Module-level mutable activity ref — set from anywhere (e.g. the
// player) by calling `setCurrentActivity(...)`. The heartbeat reads
// this on each tick. Keeping it outside React so the player doesn't
// have to pierce through the provider tree to update it.
let currentActivityRef: PresenceActivity | null = null;
export function setCurrentActivity(activity: PresenceActivity | null) {
  currentActivityRef = activity;
}
export function clearCurrentActivity() {
  currentActivityRef = null;
}

export function usePresenceHeartbeat() {
  const { authKey } = useAuth();
  const lastBeatRef = useRef(0);

  useEffect(() => {
    if (!authKey) return;
    const beat = () => {
      lastBeatRef.current = Date.now();
      void postHeartbeat(authKey, currentActivityRef).catch(() => {
        // ignore — network blips are fine, next tick retries
      });
    };
    // Fire immediately + on visibility change so "online" toggles
    // promptly when the user comes back to the tab.
    beat();
    const interval = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authKey]);
}
