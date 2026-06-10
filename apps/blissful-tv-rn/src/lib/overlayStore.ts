// Tracks whether a modal / overlay (anything wrapped in <FocusTrap>) is currently
// mounted. The NavRail reads this to suppress its GLOBAL open-on-Left gesture while
// an overlay is up: the rail listens for D-pad Left via useTVEventHandler (not via
// focus), so a Left pressed inside a centered modal (e.g. Customize Home, on the
// leftmost button) would otherwise open the sidebar behind the modal and steal
// focus. Counter-based so overlapping overlays don't clear the flag early.
let overlayCount = 0;

/** Mark an overlay as open; returns a release fn (call on unmount). */
export function pushOverlay(): () => void {
  overlayCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlayCount = Math.max(0, overlayCount - 1);
  };
}

export function isOverlayOpen(): boolean {
  return overlayCount > 0;
}
