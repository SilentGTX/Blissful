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
// Registered by the heartbeat hook so an activity CHANGE publishes immediately
// instead of waiting up to 30s for the next tick — that delay (plus the friend's
// poll interval) was why friends took ~a minute to see someone start/stop
// watching.
let beatNowRef: (() => void) | null = null;
function activityKey(a: PresenceActivity | null): string {
  return a ? `${a.type}:${a.id}:${a.videoId ?? ''}` : '';
}
export function setCurrentActivity(activity: PresenceActivity | null) {
  const changed = activityKey(activity) !== activityKey(currentActivityRef);
  currentActivityRef = activity;
  if (changed) beatNowRef?.(); // publish the new "watching X" right away
}
export function clearCurrentActivity() {
  const had = currentActivityRef !== null;
  currentActivityRef = null;
  if (had) beatNowRef?.(); // publish "stopped watching" right away
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
    beatNowRef = beat; // let setCurrentActivity publish changes instantly
    // Fire immediately + on visibility change so "online" toggles
    // promptly when the user comes back to the tab.
    beat();
    const interval = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (beatNowRef === beat) beatNowRef = null;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authKey]);
}
