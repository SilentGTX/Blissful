// Tracks the last time D-pad focus landed on a CONTENT element (a poster card,
// hero button, etc.). The NavRail uses it to decide whether a D-pad Left was at
// the content's left edge — if Left did NOT move focus to another content
// element, the user is at the edge and the rail should open. Left that just
// moved between cards (focus moved → markContentFocus fired) must NOT open it.
let lastContentFocusAt = 0;

export function markContentFocus(): void {
  lastContentFocusAt = Date.now();
}

export function contentFocusMovedSince(t: number): boolean {
  return lastContentFocusAt > t;
}
