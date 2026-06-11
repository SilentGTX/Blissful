import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BlissTooltip } from './base/BlissTooltip';

type TruncatedTextProps = {
  /** The full text shown in the tooltip — always the real, unmodified
   *  string (not a glitched / decorated render). */
  content: string;
  /** What to render inside the clamped element. Defaults to `content`.
   *  Pass a different node when the visible text differs from the
   *  tooltip text (e.g. MediaCard's hover-glitch effect). */
  display?: ReactNode;
  /** Classes for the clamped element — include your `truncate` /
   *  `line-clamp-N` + sizing here exactly as before. */
  className?: string;
  /** Tooltip placement. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
};

// Shows a tooltip (shared BlissTooltip styling) with the full text ONLY
// when the clamped element is actually overflowing (ellipsis active).
// Detection covers both single-line `truncate` (width overflow) and
// multi-line `line-clamp-N` (height overflow); a ResizeObserver
// re-checks on layout changes. The clamped element IS the tooltip
// trigger (a single stable node carrying both the measurement ref and
// React Aria's hover binding), and `isDisabled` gates it so the node
// never remounts.
export function TruncatedText({ content, display, className, placement = 'top' }: TruncatedTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      setTruncated(
        el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
      );
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content]);

  return (
    <BlissTooltip
      content={content}
      placement={placement}
      isDisabled={!truncated}
      triggerClassName={className}
      triggerRef={ref}
      contentClassName="max-w-[min(20rem,80vw)] text-center whitespace-normal"
    >
      {display ?? content}
    </BlissTooltip>
  );
}
