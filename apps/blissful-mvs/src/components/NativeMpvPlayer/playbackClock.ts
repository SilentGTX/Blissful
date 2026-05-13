// Module-level external store carrying mpv's `time-pos` at full tick
// rate. The NativeMpvPlayer property observer writes to it on every
// mpv tick; consumers (currently the ScrubBar) subscribe via
// `useSyncExternalStore` so only the subscribing component re-renders
// when the clock advances — the rest of NativeMpvPlayer's heavy tree
// only re-renders at the rate-limited React-state tick (~5 Hz).
//
// Single-instance store: there is only ever one mpv playback session
// at a time, so a singleton suffices. If the shell ever supports
// multiple concurrent players (picture-in-picture, etc.) this becomes
// a context-scoped store.

export const playbackClock = (() => {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: number) {
      if (next === value) return;
      value = next;
      // Notify subscribers; failures in one don't block the rest.
      for (const l of listeners) {
        try {
          l();
        } catch {
          // A broken subscriber shouldn't poison the clock.
        }
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

/**
 * Throttle window for the React `setTimePos` state update path. mpv
 * ticks at ~10 Hz; this caps the React state churn at ~5 Hz — fast
 * enough that effects keyed off `timePos` (up-next overlay arming,
 * hasVideo gate) still feel live, slow enough that the rest of the
 * component isn't being re-rendered constantly.
 */
export const TIME_POS_STATE_THROTTLE_MS = 200;
