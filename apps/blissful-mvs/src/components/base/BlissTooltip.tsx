import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

type Placement = 'top' | 'bottom' | 'left' | 'right';

type BlissTooltipProps = {
  /** Trigger element (button, icon, label, …). */
  children: ReactNode;
  /** Tooltip body. */
  content: ReactNode;
  placement?: Placement;
  /** Disable the tooltip entirely (e.g. text isn't truncated). */
  isDisabled?: boolean;
  /** Show delay in ms. */
  delay?: number;
  /** Extra classes merged onto the content surface. */
  contentClassName?: string;
  /** Classes applied to the trigger wrapper (e.g. `truncate`,
   *  `line-clamp-2` for the truncated-text use case). */
  triggerClassName?: string;
  /** Ref to the trigger wrapper DOM node — e.g. for overflow
   *  measurement by TruncatedText. */
  triggerRef?: Ref<HTMLElement>;
};

// Shared surface style: frosted white-on-glass pill. `whitespace-nowrap`
// suits short labels (nav, buttons); the truncated-text use case
// overrides with `whitespace-normal` + a max-width via contentClassName.
const SURFACE =
  'bg-white/10 text-white px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md shadow-lg whitespace-nowrap';

const OFFSET = 8;

// Self-owned portal tooltip — deliberately NOT React Aria's Tooltip.
// The collapsed sidebar showed EVERY nav tooltip at once with both the
// controlled-isOpen approach and HeroUI's uncontrolled Tooltip: React
// Aria's global tooltip warmup/cooldown state machine doesn't reliably
// close siblings in that tightly-stacked layout. This implementation
// has zero shared/global state — each instance opens only while its own
// trigger is under the pointer (pointerenter→open, pointerleave→close;
// pointer events fire reliably even on fast movement, unlike mouse
// events). With a single pointer it's physically impossible to show two
// at once. Rendered via portal to <body> so it escapes any ancestor
// `overflow-hidden` (sidebar surface, card frames, player chrome).
export function BlissTooltip({
  children,
  content,
  placement = 'right',
  isDisabled = false,
  delay = 0,
  contentClassName,
  triggerClassName,
  triggerRef,
}: BlissTooltipProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const labelId = useId();

  const computeCoords = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    switch (placement) {
      case 'top':
        setCoords({ top: r.top - OFFSET, left: r.left + r.width / 2 });
        break;
      case 'bottom':
        setCoords({ top: r.bottom + OFFSET, left: r.left + r.width / 2 });
        break;
      case 'left':
        setCoords({ top: r.top + r.height / 2, left: r.left - OFFSET });
        break;
      case 'right':
      default:
        setCoords({ top: r.top + r.height / 2, left: r.right + OFFSET });
        break;
    }
  }, [placement]);

  const show = useCallback(() => {
    if (isDisabled) return;
    if (showTimer.current) window.clearTimeout(showTimer.current);
    const run = () => {
      computeCoords();
      setOpen(true);
    };
    if (delay > 0) {
      showTimer.current = window.setTimeout(run, delay);
    } else {
      run();
    }
  }, [computeCoords, delay, isDisabled]);

  const hide = useCallback(() => {
    if (showTimer.current) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setOpen(false);
  }, []);

  // Force-close if disabled flips while open, and clean up the timer.
  useEffect(() => {
    if (isDisabled) hide();
  }, [isDisabled, hide]);
  useEffect(() => () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
  }, []);

  // While open, keep the tooltip pinned to the trigger as the page
  // scrolls / resizes, and close on Escape.
  useEffect(() => {
    if (!open) return;
    const reposition = () => computeCoords();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, computeCoords, hide]);

  const setWrapper = (node: HTMLDivElement | null) => {
    wrapperRef.current = node;
    if (typeof triggerRef === 'function') triggerRef(node);
    else if (triggerRef && 'current' in triggerRef) {
      (triggerRef as { current: HTMLElement | null }).current = node;
    }
  };

  const transform =
    placement === 'top'
      ? 'translate(-50%, -100%)'
      : placement === 'bottom'
        ? 'translate(-50%, 0)'
        : placement === 'left'
          ? 'translate(-100%, -50%)'
          : 'translate(0, -50%)';

  return (
    <>
      <div
        ref={setWrapper}
        className={triggerClassName}
        onPointerEnter={show}
        onPointerLeave={hide}
        onPointerDown={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? labelId : undefined}
      >
        {children}
      </div>
      {open && !isDisabled && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={labelId}
              role="tooltip"
              className={`bliss-tooltip-pop pointer-events-none fixed z-[10000] ${SURFACE} ${contentClassName ?? ''}`}
              style={{ top: coords.top, left: coords.left, transform }}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
