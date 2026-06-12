// Tracks the currently-focused CONTENT element: whether it's at its row's LEFT
// EDGE (first card / first dropdown / leftmost hero button) and WHEN it got
// focus. The NavRail opens on D-pad Left only if focus has been RESTING on an
// edge element — not if this very Left just moved focus onto it.
//
// Why the timestamp: on some tvos builds the focus change fires BEFORE the
// `left` TV event, so a synchronous "is edge?" check sees the card the Left just
// landed on (the 1st card) and wrongly opens. Requiring the edge focus to be a
// little stale means a Left that moves 2nd -> 1st card can't open it; only a
// deliberate second Left (while already resting on the 1st card) does.
let atLeftEdge = false;
let lastFocusAt = 0;

export function markContentFocus(rowStart: boolean): void {
  atLeftEdge = rowStart;
  lastFocusAt = Date.now();
}

export function isAtLeftEdge(minAgeMs = 130): boolean {
  return atLeftEdge && Date.now() - lastFocusAt > minAgeMs;
}

/** True if the currently-focused content element is at its row's left edge,
 *  regardless of how recently it got focus. */
export function atLeftEdgeRaw(): boolean {
  return atLeftEdge;
}

/** Timestamp of the last content-focus change. The NavRail uses this to tell a
 *  Left that MOVED focus onto the edge tile (don't open) from a Left pressed while
 *  already parked on it (open) — the move bumps this, a parked Left doesn't. */
export function focusStamp(): number {
  return lastFocusAt;
}
