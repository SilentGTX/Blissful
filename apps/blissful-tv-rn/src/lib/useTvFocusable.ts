import { useRef, useState } from 'react';
import { markContentFocus } from './focusBus';
import { useSelfTag } from './useSelfTag';
import { useSettingsLeftTarget } from './settingsLeftTarget';

// The single shared TV-focus primitive — the RN analogue of the old app's
// spatial/useTvFocusable. Every focusable CONTENT element (cards, chips, hero
// buttons, rail items, the shared ui/ Chip/Button/IconButton) uses this so the
// focus contract lives in ONE place:
//
//   - Geometry is the native engine's job. We add NOTHING for normal moves.
//   - The ONLY override is at a row's LEFT EDGE (atRowStart). What Left does
//     there depends on context:
//       * Settings detail panel (under SettingsLeftTargetContext) → route Left
//         to the active category row, and do NOT engage the rail trap (the panel
//         owns Left). This is why a single shared Button works in Settings.
//       * Everywhere else → trap Left on self so the nav rail's open-on-Left can
//         fire instead of focus drifting diagonally (the native engine otherwise
//         jumps down-left to a lower row).
//   - autoFocus = claim focus on mount (route entry). Keep it STATIC per screen;
//     never bind it to focus-updated state (that re-grabs focus and loops).
//
// Returns { focused, focusProps } — spread focusProps onto the Pressable, read
// `focused` for styling. This folds in the leftTarget/selfTag/markContentFocus
// block that TvSelect + settings/PillButton used to each re-implement.
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
  // undefined unless rendered inside the Settings detail panel; harmless (a cheap
  // context read) for every other focusable.
  const leftTarget = useSettingsLeftTarget();
  // Self-trap Left for the rail only when there's no Settings category to route
  // to — inside Settings the panel handles Left, so the rail must not engage.
  const railTrap = leftTarget == null && Boolean(opts.atRowStart);
  const selfTag = useSelfTag(ref, railTrap);
  const focusProps = {
    ref: ref as never,
    hasTVPreferredFocus: opts.autoFocus,
    // Edge-only: undefined when not at a row start, so the native engine handles
    // every interior move geometrically. At a row start: the Settings category
    // (if any), else self (rail trap).
    nextFocusLeft: opts.atRowStart ? (leftTarget != null ? leftTarget : selfTag) : undefined,
    onFocus: () => {
      setFocused(true);
      markContentFocus(railTrap);
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
