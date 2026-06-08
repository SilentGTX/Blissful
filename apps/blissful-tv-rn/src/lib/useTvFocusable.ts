import { useRef, useState } from 'react';
import { markContentFocus } from './focusBus';
import { useSelfTag } from './useSelfTag';

// The single shared TV-focus primitive — the RN analogue of the old app's
// spatial/useTvFocusable. Every focusable CONTENT element (cards, chips, hero
// buttons, rail items) uses this so the focus contract lives in ONE place:
//
//   - Geometry is the native engine's job. We add NOTHING for normal moves.
//   - The ONLY override is at a row's LEFT EDGE (atRowStart): trap Left on self
//     so the nav rail's open-on-Left can fire instead of focus drifting
//     diagonally (the native engine otherwise jumps down-left to a lower row).
//   - autoFocus = claim focus on mount (route entry). Keep it STATIC per screen;
//     never bind it to focus-updated state (that re-grabs focus and loops).
//
// Returns { focused, focusProps } — spread focusProps onto the Pressable, read
// `focused` for styling. This replaces the 6-line atRowStart/selfTag/
// markContentFocus/hasTVPreferredFocus block that was duplicated per component.
export function useTvFocusable(opts: {
  atRowStart?: boolean;
  autoFocus?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
} = {}) {
  const ref = useRef<unknown>(null);
  const [focused, setFocused] = useState(false);
  const selfTag = useSelfTag(ref, Boolean(opts.atRowStart));
  const focusProps = {
    ref: ref as never,
    hasTVPreferredFocus: opts.autoFocus,
    // Edge-only: undefined when not at a row start, so the native engine handles
    // every interior move geometrically.
    nextFocusLeft: opts.atRowStart ? selfTag : undefined,
    onFocus: () => {
      setFocused(true);
      markContentFocus(Boolean(opts.atRowStart));
      opts.onFocus?.();
    },
    onBlur: () => {
      setFocused(false);
      opts.onBlur?.();
    },
    onPress: opts.onPress,
    onLongPress: opts.onLongPress,
  };
  return { focused, focusProps };
}
