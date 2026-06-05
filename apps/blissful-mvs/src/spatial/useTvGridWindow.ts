import { useCallback, useRef, useState } from 'react';
import { isTvMode } from '../lib/platform';

/** Items kept mounted on EACH side of the focused index. At the grid's
 *  5-7 columns this is ~4-6 full rows of lookahead in every direction —
 *  comfortably ahead of Norigin's ~100ms keydown throttle, so the next
 *  D-pad target is always mounted+measured before focus can reach it. */
const TV_GRID_WINDOW_BUFFER = 30;

/** TV unmount-windowing for poster GRIDS (Discover / Library) — the grid
 *  sibling of HomePage's row windowing (see the OVERSCAN comment there for
 *  why UNMOUNT windowing, not content-visibility, is the Norigin-safe
 *  choice: Norigin measures focusables via an offsetParent/offsetTop walk
 *  that reads 0 for skipped subtrees).
 *
 *  Unlike the home rows, a grid has no per-row container to swap for a
 *  spacer — and the column count is responsive (auto-fit/minmax), so
 *  row-based math would need fragile resize tracking. Instead every item
 *  KEEPS its own grid cell and only the cell's content is windowed: cells
 *  within ±TV_GRID_WINDOW_BUFFER of the focused index mount the real
 *  MediaCard, the rest render an empty same-height div. Column layout,
 *  total scrollHeight (infinite-scroll triggers included) and every
 *  mounted card's offset geometry are exactly what a fully-mounted grid
 *  would produce. Off-TV `windowed` is false and `isMounted` is always
 *  true — desktop/mobile render byte-for-byte as before.
 *
 *  Cell height comes from measuring the first real cell (`measureCell` on
 *  each mounted cell's wrapper; it records once). Until that resolves,
 *  `cellH` falls back to the caller's default — only below-the-fold
 *  spacers exist that early, so the one-frame correction is invisible. */
export function useTvGridWindow(focusedIdx: number) {
  const windowed = isTvMode();
  const [cellH, setCellH] = useState(0);
  const measuredRef = useRef(false);
  const measureCell = useCallback((el: HTMLDivElement | null) => {
    if (el && !measuredRef.current && el.offsetHeight > 0) {
      measuredRef.current = true;
      setCellH(el.offsetHeight);
    }
  }, []);
  const isMounted = useCallback(
    (index: number) => !windowed || Math.abs(index - focusedIdx) <= TV_GRID_WINDOW_BUFFER,
    [windowed, focusedIdx]
  );
  return { windowed, cellH, measureCell, isMounted };
}
