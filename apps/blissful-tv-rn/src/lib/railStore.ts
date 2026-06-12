import { useSyncExternalStore } from 'react';

// Whether the nav rail (sidebar) is open. While it's open, ALL content
// focusables go non-focusable (isTVSelectable={!railOpen}) so D-pad focus is
// trapped inside the rail — it can only leave via D-pad Right, which closes it.
// This is what makes "only Right closes the sidebar" actually hold: focus can
// never wander out the bottom/top of the rail into the content behind it.
let railOpen = false;
const listeners = new Set<() => void>();

export function setRailOpen(v: boolean): void {
  if (v === railOpen) return;
  railOpen = v;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): boolean {
  return railOpen;
}

export function useRailOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
