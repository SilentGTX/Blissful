// Presence heartbeat — ports the desktop usePresenceHeartbeat + setCurrentActivity.
// The player sets the current activity ("watching X"); a 30s heartbeat reports it
// (and plain online otherwise) so friends see online/watching and "Request party"
// can light up. Module-level activity ref (set imperatively from the player), one
// app-root hook does the posting.
import { useEffect, useRef } from 'react';
import { postHeartbeat, type PresenceActivity } from '@blissful/core';

let currentActivity: PresenceActivity | null = null;

export function setCurrentActivity(activity: PresenceActivity | null): void {
  currentActivity = activity;
}
export function clearCurrentActivity(): void {
  currentActivity = null;
}

export function usePresenceHeartbeat(token: string | null): void {
  const tokenRef = useRef(token);
  tokenRef.current = token;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const beat = () => {
      if (cancelled || !tokenRef.current) return;
      postHeartbeat(tokenRef.current, currentActivity).catch(() => { /* best-effort */ });
    };
    beat();
    const id = setInterval(beat, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token]);
}
