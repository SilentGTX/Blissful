import { useEffect, useState, type RefObject } from 'react';

// Computes per-list maxHeight values for the two footer accordions
// (Friends + Continue Watching) so each list shows whole items only —
// no half-clipped row at the bottom edge.
//
// Two big design points worth knowing:
//
// 1. We measure each rendered child of the list, not just the first
//    row. Earlier versions assumed uniform heights but real rows vary
//    (long names wrap, online badges add height, etc.) and a uniform
//    estimate produced half-rows. With per-child measurement we
//    accumulate actual row heights until we hit the available cap.
//
// 2. When both accordions are expanded we use a round-robin row
//    allocation — alternate giving one row to the side with fewer
//    rows so far — instead of splitting pixels 50/50. Equal pixels
//    starves the side with taller rows. Round-robin produces
//    visually balanced counts (within 1 of each other).
//
// Re-runs on:
//   - Footer ResizeObserver (window resize, sidebar collapse, etc.)
//   - Item count / expand toggle changes (deps)
//   - First mount once refs are attached

export type FooterAccordionParams = {
  footerRef: RefObject<HTMLElement | null>;
  /** The Friends list scroll viewport. We walk its child rows to read
   *  real per-row heights. */
  friendsListRef: RefObject<HTMLElement | null>;
  /** Same for Continue Watching. */
  cwListRef: RefObject<HTMLElement | null>;
  /** Friends "header chrome" = collapsible trigger + (when expanded)
   *  the search/Requests row. Measured externally. */
  friendsChromeRef: RefObject<HTMLElement | null>;
  /** CW header trigger. */
  cwHeaderRef: RefObject<HTMLElement | null>;
  friendsExpanded: boolean;
  cwExpanded: boolean;
  friendsItemCount: number;
  cwItemCount: number;
  /** Vertical padding inside each accordion's box (top + bottom).
   *  Matches p-2.5 = 10px each side = 20 total by default. */
  boxPaddingY?: number;
  /** Default item heights used when no rows have rendered yet. */
  fallbackFriendsItemH?: number;
  fallbackCwItemH?: number;
};

export type FooterAccordionHeights = {
  friendsListMaxHeight: number | null;
  cwListMaxHeight: number | null;
};

const DEFAULT_FRIENDS_ITEM_H = 60;
const DEFAULT_CW_ITEM_H = 78;
const DEFAULT_BOX_PADDING_Y = 20;
// Hard cap per accordion — when there's room for more rows, the
// remainder shows as empty space at the top of the footer (the
// `justify-end` cluster doesn't grow past this cap). Prevents
// cross-accordion reflow when one side toggles (since neither side
// ever needs more than this even when the other side is collapsed).
const PER_ACCORDION_MAX_ROWS = 5;

// Read the heights of the list's rendered children, in DOM order.
// We treat each direct child as one "row" — works because the parent
// uses `flex-col gap-…` so each child IS a row.
function rowHeights(listEl: HTMLElement | null): number[] {
  if (!listEl) return [];
  const heights: number[] = [];
  for (const child of Array.from(listEl.children)) {
    if (child instanceof HTMLElement) {
      // offsetHeight excludes margins (we use gap instead, which
      // sits between rows and is measured separately).
      heights.push(child.offsetHeight);
    }
  }
  return heights;
}

function rowGapOf(listEl: HTMLElement | null, fallback: number): number {
  if (!listEl) return fallback;
  const parsed = parseFloat(window.getComputedStyle(listEl).rowGap || '0');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Sum the first `n` row heights with `n-1` inter-row gaps. Snapping
// to the real heights of the rows we'll actually show means the
// maxHeight is always an exact fit — never clips mid-row.
function heightForFirstN(rows: number[], n: number, gap: number): number {
  if (n <= 0) return 0;
  const take = Math.min(n, rows.length);
  let total = 0;
  for (let i = 0; i < take; i++) {
    total += rows[i];
    if (i > 0) total += gap;
  }
  return total;
}

export function useFooterAccordionHeights(params: FooterAccordionParams): FooterAccordionHeights {
  const {
    footerRef,
    friendsListRef,
    cwListRef,
    friendsChromeRef,
    cwHeaderRef,
    friendsExpanded,
    cwExpanded,
    friendsItemCount,
    cwItemCount,
    boxPaddingY = DEFAULT_BOX_PADDING_Y,
    fallbackFriendsItemH = DEFAULT_FRIENDS_ITEM_H,
    fallbackCwItemH = DEFAULT_CW_ITEM_H,
  } = params;

  const [heights, setHeights] = useState<FooterAccordionHeights>({
    friendsListMaxHeight: null,
    cwListMaxHeight: null,
  });

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;

    const compute = () => {
      const friendsListEl = friendsListRef.current;
      const cwListEl = cwListRef.current;
      const friendsChromeEl = friendsChromeRef.current;
      const cwHeaderEl = cwHeaderRef.current;

      const friendsRowsRaw = rowHeights(friendsListEl);
      const cwRowsRaw = rowHeights(cwListEl);
      const friendsGap = rowGapOf(friendsListEl, 6);
      const cwGap = rowGapOf(cwListEl, 6);

      // Detect the "just-flipped-expanded" transient: HeroUI's
      // Disclosure.Content starts the open animation from height 0,
      // so for the first frame after expansion every child reports
      // offsetHeight = 0. If we trust that we'd allocate the whole
      // available height to the OTHER (stable) list, then recompute
      // away from it on the next ResizeObserver tick — that bounce
      // is what the user sees as a "jump". Substitute fallbacks until
      // the items report real heights.
      const friendsAllZero = friendsRowsRaw.length > 0 && friendsRowsRaw.every((h) => h === 0);
      const cwAllZero = cwRowsRaw.length > 0 && cwRowsRaw.every((h) => h === 0);
      const friendsRows = friendsAllZero
        ? friendsRowsRaw.map(() => fallbackFriendsItemH)
        : friendsRowsRaw;
      const cwRows = cwAllZero ? cwRowsRaw.map(() => fallbackCwItemH) : cwRowsRaw;

      // "Cost to add one more row" given how many we already have.
      // First row: just the row height. Subsequent rows: row + leading
      // gap.
      const friendsRowCost = (idx: number) => {
        const h = friendsRows[idx] ?? fallbackFriendsItemH;
        return idx === 0 ? h : h + friendsGap;
      };
      const cwRowCost = (idx: number) => {
        const h = cwRows[idx] ?? fallbackCwItemH;
        return idx === 0 ? h : h + cwGap;
      };

      const footerH = footer.clientHeight;
      const friendsChromeH = friendsChromeEl?.offsetHeight ?? 0;
      const cwHeaderH = cwHeaderEl?.offsetHeight ?? 0;

      const friendsOverhead = boxPaddingY + friendsChromeH;
      const cwOverhead = boxPaddingY + cwHeaderH;

      // Total claimed by accordion headers + paddings, regardless of
      // expanded state. (Collapsed boxes still occupy the same
      // header-strip space.)
      const overheadTotal =
        (friendsExpanded ? friendsOverhead : friendsChromeH + boxPaddingY) +
        (cwExpanded ? cwOverhead : cwHeaderH + boxPaddingY);
      const availableForLists = Math.max(0, footerH - overheadTotal);

      // Per-side independent allocation. Each list shows up to
      // PER_ACCORDION_MAX_ROWS rows (or fewer if there genuinely
      // isn't space). Allocations don't depend on the other side's
      // expand state — that's deliberate, so toggling one accordion
      // never reshuffles the other and the cluster never reflows.
      // Extra space ends up above the cluster (justify-end empty
      // strip), which is exactly what the user asked for.
      const allocateOneSide = (
        wantsExpand: boolean,
        rows: number[],
        rowCost: (i: number) => number,
        itemCount: number,
        rowGap: number,
        budget: number,
      ): number => {
        if (!wantsExpand) return 0;
        const cap = Math.min(itemCount, PER_ACCORDION_MAX_ROWS);
        let n = 0;
        let remaining = budget;
        while (n < cap) {
          const cost = rowCost(n);
          if (cost > remaining) break;
          remaining -= cost;
          n += 1;
        }
        if (cap > 0 && n === 0) n = 1; // never zero when there's at least one item
        return heightForFirstN(rows, n, rowGap);
      };

      // Half the available height is each side's max budget — even
      // alone, an accordion never takes more than its half, so the
      // top "gap above the cluster" requirement is preserved when
      // one side is collapsed.
      const halfBudget = Math.max(0, Math.floor(availableForLists / 2));
      const friendsTarget = allocateOneSide(
        friendsExpanded,
        friendsRows,
        friendsRowCost,
        friendsItemCount,
        friendsGap,
        halfBudget,
      );
      const cwTarget = allocateOneSide(
        cwExpanded,
        cwRows,
        cwRowCost,
        cwItemCount,
        cwGap,
        halfBudget,
      );

      setHeights({
        friendsListMaxHeight: friendsExpanded ? friendsTarget : null,
        cwListMaxHeight: cwExpanded ? cwTarget : null,
      });
    };

    compute();

    // Observe ONLY the footer and the two collapsible-header chromes —
    // not the row children. Observing rows caused the hook to re-run
    // on every frame of Framer Motion's expand/collapse animation
    // (the rows' offsetHeights stay stable but the containing
    // motion.div's resize fires ResizeObserver for everything inside),
    // and each re-run re-applied a slightly different max-height,
    // which made the cluster wiggle. Footer + chrome cover the only
    // legitimate triggers (window resize, sidebar collapse, search
    // row appear/disappear). Per-row reflow on something like a
    // friend coming online is handled on next user interaction.
    const ro = new ResizeObserver(compute);
    ro.observe(footer);
    if (friendsChromeRef.current) ro.observe(friendsChromeRef.current);
    if (cwHeaderRef.current) ro.observe(cwHeaderRef.current);

    return () => ro.disconnect();
  }, [
    footerRef,
    friendsListRef,
    cwListRef,
    friendsChromeRef,
    cwHeaderRef,
    friendsExpanded,
    cwExpanded,
    friendsItemCount,
    cwItemCount,
    boxPaddingY,
    fallbackFriendsItemH,
    fallbackCwItemH,
  ]);

  return heights;
}
