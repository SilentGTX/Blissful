// Shared Trakt scrobble hook for both players (SimplePlayer + NativeMpvPlayer).
//
// WHY A SHARED HOOK: the browser/TV player (SimplePlayer) and the Windows
// desktop player (NativeMpvPlayer) have completely different event models
// (HTMLMediaElement events vs. libmpv IPC props/events). Putting the scrobble
// debounce/dedup logic in one place means the two players can never drift in
// how they report start/pause/stop to Trakt.
//
// CONTRACT (locked decisions — see project memory):
//   - PAYS ZERO COST when Trakt isn't configured/connected: the hook reads
//     isTraktConfigured() + isTraktConnected() once per call and bails before
//     touching the network. When inert, start/pause/stop are pure no-ops.
//   - FIRE-AND-FORGET: every Trakt call is wrapped so a network error / Trakt
//     outage can NEVER bubble into playback. We never await in the player's
//     event handlers and we swallow rejections.
//   - DEBOUNCE + DEDUP: Trakt's scrobble endpoints are POSTs (1/sec limit).
//     We:
//       * ignore a `start` whose progress moved < MIN_PROGRESS_DELTA from the
//         last `start` we sent (timeupdate fires many times/sec),
//       * enforce >= MIN_ACTION_GAP_MS between any two POSTs we initiate,
//       * dedup identical (action, rounded-progress) pairs.
//     A state change (start->pause, pause->start, *->stop) always passes the
//     dedup gate so play/pause/seek-resume edges are reported promptly.
//   - CONTENT GUARD: buildMediaPayload() (in traktApi.ts) returns null for
//     non-imdb ids / malformed series videoIds, so we skip the scrobble rather
//     than POST garbage. We pre-check here too to avoid even constructing the
//     call.

import { useCallback, useRef } from 'react';
import {
  isTraktConfigured,
} from './traktConfig';
import {
  isTraktConnected,
  buildMediaPayload,
  scrobble,
  type ScrobbleAction,
  type TraktContentRef,
} from './traktApi';

/** Minimum progress (percentage points) change before we resend `start`. */
const MIN_PROGRESS_DELTA = 0.5;

/** Minimum gap between any two scrobble POSTs we initiate (ms). The traktApi
 *  POST throttle also enforces 1/sec at the network layer; this is the
 *  hook-level guard so we don't even queue redundant calls. */
const MIN_ACTION_GAP_MS = 1000;

/** What the hook exposes to a player. Each takes progress 0-100. */
export type TraktScrobbleControls = {
  /** Call on play / resume / seek-while-playing. */
  start: (progressPct: number) => void;
  /** Call on user pause. */
  pause: (progressPct: number) => void;
  /** Call on natural end / unmount-at-end. progress >= 80 marks watched. */
  stop: (progressPct: number) => void;
};

type LastSent = {
  action: ScrobbleAction | null;
  progress: number;
  /** performance.now() of the last POST we initiated. */
  at: number;
};

/**
 * Returns stable {start,pause,stop} callbacks for the given content. The
 * callbacks read identity/connection state lazily on each call, so they stay
 * referentially stable across the player's lifetime (safe to drop into a ref
 * and call from event handlers without re-subscribing).
 *
 * Pass null/empty ids freely — the hook simply no-ops until the player has a
 * resolvable movie/series identity.
 */
export function useTraktScrobble(content: {
  type: string | null | undefined;
  id: string | null | undefined;
  videoId: string | null | undefined;
}): TraktScrobbleControls {
  // Keep the latest identity in a ref so the callbacks can stay stable while
  // still seeing fresh values (videoId changes on chained episode advance).
  const contentRef = useRef(content);
  contentRef.current = content;

  const lastRef = useRef<LastSent>({ action: null, progress: -1, at: 0 });

  const send = useCallback((action: ScrobbleAction, progressPct: number) => {
    // Cheap inert gates first — zero cost when Trakt isn't set up.
    if (!isTraktConfigured()) return;
    if (!isTraktConnected()) return;

    const { type, id, videoId } = contentRef.current;
    if (!type || !id || !videoId) return;

    const ref: TraktContentRef = { type, id, videoId };
    // Skip unresolvable content (non-imdb ids, malformed series videoIds)
    // rather than POSTing garbage — buildMediaPayload is the source of truth.
    if (!buildMediaPayload(ref)) return;

    const progress = Math.max(0, Math.min(100, progressPct));
    const last = lastRef.current;
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    const stateChanged = action !== last.action;
    const progressDelta = Math.abs(progress - last.progress);

    // Dedup: identical action with negligible progress movement is dropped.
    // `stop` always passes (we always want the final watched mark).
    if (action !== 'stop' && !stateChanged && progressDelta < MIN_PROGRESS_DELTA) {
      return;
    }

    // Throttle: never initiate POSTs closer than MIN_ACTION_GAP_MS apart,
    // EXCEPT for a state change or a stop, which we let through so play/pause
    // edges and the final stop are reported without delay (the traktApi POST
    // throttle still serialises them at 1/sec at the network layer).
    if (action !== 'stop' && !stateChanged && now - last.at < MIN_ACTION_GAP_MS) {
      return;
    }

    lastRef.current = { action, progress, at: now };

    // Fire-and-forget. scrobble() already swallows its own errors and returns
    // null on failure, but we add a defensive catch so a synchronous throw or
    // an unexpected rejection can never reach the player's event loop.
    try {
      void scrobble(action, { ...ref, progress }).catch(() => undefined);
    } catch {
      /* never let Trakt affect playback */
    }
  }, []);

  const start = useCallback((p: number) => send('start', p), [send]);
  const pause = useCallback((p: number) => send('pause', p), [send]);
  const stop = useCallback((p: number) => send('stop', p), [send]);

  return { start, pause, stop };
}
