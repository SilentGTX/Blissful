// Tiny curated emoji picker used by the watch-party chat for both
// (a) inserting an emoji into the message draft and (b) reacting to
// a message. Deliberately not a full-blown emoji library — keeping
// the bundle small and the UX focused on the dozen emojis people
// actually use during a watch party.
//
// Auto-flips its vertical anchor when the requested side would clip
// inside the nearest scrolling ancestor — e.g. opening the reaction
// picker on the first chat message used to overflow the top of the
// chat scroll container and get hidden behind the tab pill.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const WATCH_PARTY_EMOJI = [
  '\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F525}',
  '\u{1F62E}', '\u{1F622}', '\u{1F389}', '\u{1F44F}',
  '\u{1F64F}', '\u{1F621}', '\u{1F914}', '\u{1F440}',
] as const;

export type EmojiPickerProps = {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
  /** Horizontal anchor — where the picker aligns relative to the
   *  trigger button. Defaults to 'left'. */
  align?: 'left' | 'right';
  /** Preferred vertical anchor. Defaults to 'above' (bottom-full).
   *  The picker auto-flips to the other side when the preferred
   *  one would clip inside the nearest scrolling ancestor. */
  side?: 'above' | 'below';
};

export function EmojiPicker({
  open,
  onClose,
  onPick,
  align = 'left',
  side = 'above',
}: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Effective vertical anchor — starts as the requested side, may
  // flip after mount once we can measure the bounding rect.
  const [effectiveSide, setEffectiveSide] = useState<'above' | 'below'>(side);

  // Outside-click dismiss.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, onClose]);

  // Auto-flip the vertical anchor when the requested side wouldn't
  // fit inside the nearest scrolling ancestor.
  //
  // useLayoutEffect (not useEffect) so the measurement + setState
  // happen BEFORE the browser paints — otherwise the user sees a
  // one-frame flash of the picker in the wrong position before it
  // settles, and on a second-open the flash is even longer because
  // effectiveSide has to reset -> render -> measure -> flip -> render.
  //
  // We measure the TRIGGER's position (the picker's parent) rather
  // than the picker itself: that way the decision is independent
  // of where the picker happens to be currently rendered.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const picker = ref.current;
    const trigger = picker.parentElement;
    if (!trigger) return;
    let scrollEl: HTMLElement | null = trigger.parentElement;
    while (scrollEl) {
      const cs = window.getComputedStyle(scrollEl);
      const overflowY = cs.overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') break;
      scrollEl = scrollEl.parentElement;
    }
    if (!scrollEl) {
      setEffectiveSide(side);
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const containerRect = scrollEl.getBoundingClientRect();
    const pickerHeight = picker.offsetHeight + 8; // +mb-2 gap
    const spaceAbove = triggerRect.top - containerRect.top;
    const spaceBelow = containerRect.bottom - triggerRect.bottom;
    if (side === 'above') {
      setEffectiveSide(spaceAbove < pickerHeight && spaceBelow >= pickerHeight ? 'below' : 'above');
    } else {
      setEffectiveSide(spaceBelow < pickerHeight && spaceAbove >= pickerHeight ? 'above' : 'below');
    }
  }, [open, side]);

  if (!open) return null;

  const verticalClass = effectiveSide === 'above' ? 'bottom-full mb-2' : 'top-full mt-2';
  const horizontalClass = align === 'left' ? 'left-0' : 'right-0';

  return (
    <div
      ref={ref}
      // `w-44` (11rem = 176px) is explicit because the popover lives
      // inside a narrow `relative` parent (the trigger button is
      // only ~32px wide). Without it, the absolute box shrinks to
      // fit and `grid-cols-4 -> 1fr` columns collapse, stacking
      // every emoji in a single column.
      className={
        'absolute z-50 grid w-44 grid-cols-4 gap-1 rounded-2xl border border-white/15 bg-black/85 p-2 shadow-[0_18px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl '
        + verticalClass + ' '
        + horizontalClass
      }
      // Stop the outer click handler in the chat tab from picking
      // this up as "outside" before our own handler runs.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {WATCH_PARTY_EMOJI.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            onPick(emoji);
            onClose();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition hover:bg-white/15"
          aria-label={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
