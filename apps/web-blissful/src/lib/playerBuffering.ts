// Pure decision logic for the web player's buffering logo and coalesced seeks.
// Kept free of React and the DOM so the rules can be unit-tested.

export const HAVE_CURRENT_DATA = 2;
export const HAVE_FUTURE_DATA = 3;

export type BufferingInput = {
  readyState: number;
  paused: boolean;
  seeking: boolean;
  ended: boolean;
};

// True when the buffering logo should be (eventually) shown.
// - ended: never.
// - paused and not seeking: a frame to display (HAVE_CURRENT_DATA) is enough.
//   A paused element never advances to HAVE_FUTURE_DATA on its own in some
//   browsers, which would otherwise pin the logo over a perfectly good frame.
// - otherwise: Stremio's rule, fewer than HAVE_FUTURE_DATA means buffering.
export function isBufferingState({ readyState, paused, seeking, ended }: BufferingInput): boolean {
  if (ended) return false;
  if (paused && !seeking) return readyState < HAVE_CURRENT_DATA;
  return readyState < HAVE_FUTURE_DATA;
}

export type SeekCoalescer = {
  // Adds `delta` to the pending target (or to `from` when none is pending),
  // clamps to [0, duration] and returns the new target.
  seekBy: (delta: number, from: number, duration?: number) => number;
  // Sets the pending target to `t` (clamped) and returns it.
  seekTo: (t: number, duration?: number) => number;
  // Applies the pending target now, if any.
  flush: () => void;
  // Drops the pending target without applying it.
  cancel: () => void;
  hasPending: () => boolean;
};

function clampSeek(t: number, duration: number | undefined): number {
  const upper = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.min(upper, Math.max(0, t));
}

// Collapses a burst of relative or absolute seeks (arrow-key taps and
// auto-repeat) into a single `apply` once input has been quiet for `delayMs`.
// Targets accumulate from the pending target, not from the element's
// currentTime, which does not move until the seek is applied.
export function createSeekCoalescer({
  apply,
  delayMs = 200,
}: {
  apply: (t: number) => void;
  delayMs?: number;
}): SeekCoalescer {
  let pending: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const flush = () => {
    clearTimer();
    if (pending === null) return;
    const t = pending;
    pending = null;
    apply(t);
  };
  const schedule = () => {
    clearTimer();
    timer = setTimeout(flush, delayMs);
  };

  return {
    seekBy(delta, from, duration) {
      pending = clampSeek((pending ?? from) + delta, duration);
      schedule();
      return pending;
    },
    seekTo(t, duration) {
      pending = clampSeek(t, duration);
      schedule();
      return pending;
    },
    flush,
    cancel() {
      clearTimer();
      pending = null;
    },
    hasPending: () => pending !== null,
  };
}
