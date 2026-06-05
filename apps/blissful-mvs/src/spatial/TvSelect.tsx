// Custom select used everywhere in the app. We do NOT use HeroUI's <Select>:
// its <Select.Trigger> does not reliably apply our layout className to the
// button, so the value + indicator overflowed a clipped pill on desktop (the
// recurring "bugged dropdown" bug). Instead we render a plain <button> trigger
// (a clean flex row: value left, chevron right) on BOTH platforms, and open a
// menu we fully control:
//   - Desktop: a portaled dropdown fixed-positioned under the trigger (so it
//     never clips inside scrolling settings panels), close on outside-click /
//     Esc / scroll.
//   - TV: the centered overlay (pause Norigin → native-focus the selected
//     option → Up/Down/Enter/Esc → resume), the same pattern as the profile /
//     friend-action menus.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import { useTvFocusable } from './useTvFocusable';
import { isTvMode, isAndroidTv } from '../lib/platform';

export type TvSelectOption = { key: string; label: string };

type TvSelectProps = {
  value: string | null | undefined;
  options: TvSelectOption[];
  onChange: (key: string) => void;
  ariaLabel?: string;
  /** Wrapper class (width etc.). */
  className?: string;
  /** Trigger button class — color/shape only; the flex row layout is always
   *  applied by this component so the value + chevron never overflow. */
  triggerClassName?: string;
  placeholder?: string;
  /** Optional leading icon shown before the value in the trigger. */
  leftIcon?: ReactNode;
  /** Stable Norigin focusKey so other elements can route focus here (e.g. the
   *  episode cards' UP targets the range/season selector). */
  focusKey?: string;
};

// TV: centered, D-pad-driven overlay (Norigin paused while open).
function TvSelectOverlay({
  options,
  value,
  onPick,
  onClose,
}: {
  options: TvSelectOption[];
  value: string | null | undefined;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    pause();
    const t = window.setTimeout(() => {
      const node =
        ref.current?.querySelector<HTMLButtonElement>('[data-selected="true"]') ??
        ref.current?.querySelector<HTMLButtonElement>('button');
      node?.focus();
      node?.scrollIntoView({ block: 'nearest' });
    }, 0);
    // This menu is portaled to document.body — OUTSIDE the React root (#root) —
    // so a React onKeyDown prop never fires (its native events bubble to body,
    // never reaching React's #root delegated listener). Drive it with a native
    // capture-phase document listener instead; scope it to this menu's buttons.
    const handler = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
      if (buttons.length === 0) return;
      const active = document.activeElement as HTMLButtonElement | null;
      // Stay out of the way if focus is on some other element/overlay entirely.
      if (active && !root.contains(active) && active !== document.body) return;
      const idx = active ? buttons.indexOf(active) : -1;
      const focusAt = (i: number) => {
        const n = buttons[(i + buttons.length) % buttons.length];
        n?.focus();
        n?.scrollIntoView({ block: 'nearest' });
      };
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        focusAt(idx + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        focusAt(idx - 1);
      } else if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      } else if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Select' || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66) && isAndroidTv()) {
        // Android WebView doesn't synthesize a click for a programmatically-focused
        // button, so OK wouldn't pick the option. Click the focused option explicitly.
        if (active && root.contains(active)) {
          e.preventDefault();
          e.stopPropagation();
          active.click();
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', handler, true);
      resume();
    };
  }, []);

  return createPortal(
    <div className="tv-select-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="tv-select-menu"
        role="listbox"
        onClick={(e) => e.stopPropagation()}
      >
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            data-selected={o.key === value ? 'true' : undefined}
            className={'tv-select-item' + (o.key === value ? ' is-selected' : '')}
            onClick={() => onPick(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}

// Desktop: a dropdown portaled to <body> and fixed-positioned under the
// trigger, so it floats above (and never clips inside) the scrolling settings
// panels. Closes on outside-click, Esc, or any scroll/resize.
function DesktopSelectMenu({
  anchor,
  options,
  value,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  options: TvSelectOption[];
  value: string | null | undefined;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 4), left: Math.round(r.left), width: Math.round(r.width) });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onReflow = () => onClose();
    // Defer the outside-click listener a tick so the opening click doesn't
    // immediately close the menu.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      role="listbox"
      className="bliss-select-menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          data-selected={o.key === value ? 'true' : undefined}
          className={'bliss-select-item' + (o.key === value ? ' is-selected' : '')}
          onClick={() => onPick(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

export function TvSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  triggerClassName,
  placeholder,
  leftIcon,
  focusKey,
}: TvSelectProps) {
  const [open, setOpen] = useState(false);
  const tv = isTvMode();
  // The trigger is the focusable node on TV; its DOM ref also anchors the
  // desktop dropdown.
  const { ref } = useTvFocusable({ onPress: () => setOpen(true), focusKey });
  const anchorRef = ref as RefObject<HTMLElement | null>;

  const current = options.find((o) => o.key === value);
  const chevron: ReactNode = (
    <svg
      className="h-4 w-4 shrink-0 opacity-60"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  return (
    <div className={'relative ' + (className ?? '')}>
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        // Layout (flex row, value left + chevron right) is ALWAYS applied here
        // so the value can never overflow; the caller's triggerClassName only
        // adds color/shape (falls back to the default glassy pill).
        className={
          'tv-select-trigger flex h-9 w-full items-center justify-between gap-2 px-4 text-sm text-white ' +
          (triggerClassName ?? 'rounded-full border border-white/10 bg-white/10')
        }
        onClick={() => setOpen((o) => !o)}
      >
        {leftIcon ? <span className="grid h-5 w-5 shrink-0 place-items-center opacity-70">{leftIcon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-left">
          {current?.label ?? placeholder ?? 'Select'}
        </span>
        {chevron}
      </button>
      {open && tv ? (
        <TvSelectOverlay
          options={options}
          value={value}
          onPick={(k) => {
            onChange(k);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {open && !tv ? (
        <DesktopSelectMenu
          anchor={anchorRef}
          options={options}
          value={value}
          onPick={(k) => {
            onChange(k);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
