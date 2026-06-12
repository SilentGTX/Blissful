import { useEffect, useState, type RefObject } from 'react';
import { findNodeHandle } from 'react-native';

// Returns the element's own native node handle, for use as `nextFocusLeft={self}`
// on a LEFT-EDGE focusable. Without it, D-pad Left at the row's left edge lets
// the native tvos focus engine grab the nearest focusable down-and-to-the-left
// (e.g. Left on the hero's first genre chip jumps to the first CW poster).
// Trapping Left on itself keeps focus put, so the rail-open handler fires cleanly
// instead of focus drifting diagonally.
export function useSelfTag(ref: RefObject<unknown>, enabled: boolean): number | undefined {
  const [tag, setTag] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      setTag(undefined);
      return;
    }
    const id = setTimeout(() => {
      const t = ref.current ? findNodeHandle(ref.current as never) : null;
      if (t) setTag(t);
    }, 0);
    return () => clearTimeout(id);
  }, [ref, enabled]);
  return tag;
}
