// Reusable focus management for a TV modal/overlay. Most HeroUI modals are
// "dead" on TV — Norigin keeps focus on the page UNDER the backdrop and arrows
// move the page behind. Drop this hook into a modal: on open it pauses the
// spatial engine and native-focuses the first control, then drives Up/Down (and
// Left/Right when not in a text field) across the modal's focusable nodes, Enter
// activates the native button, Escape calls onClose; on close it resumes the
// engine. Fully inert off-TV — desktop HeroUI behaviour is intact.
//
// Why a NATIVE document capture-phase listener instead of a React onKeyDown prop:
// overlays that createPortal() to document.body (TvStreamsPopup, etc.) live
// OUTSIDE the React root container (#root), so React's delegated synthetic
// keydown — attached to #root — never fires for their content (the event bubbles
// to document.body, a sibling of #root). That left arrows completely dead inside
// those popups. A capture-phase listener on `document` always fires (document is
// an ancestor of every portal), and it stopPropagation()s the keys it handles so
// nothing double-processes. Scoped to containerRef so only the overlay that owns
// focus reacts.

import { useEffect, useRef, type RefObject } from 'react';
import { pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import { isTvMode, isAndroidTv } from '../lib/platform';

type Options = {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** CSS selector for the element to focus first (defaults to the first
   *  button/input). e.g. a primary CTA. */
  autoFocusSelector?: string;
};

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useTvOverlay({ open, containerRef, onClose, autoFocusSelector }: Options) {
  // Always call the LATEST onClose from the mount-scoped key handler below
  // (consumers commonly pass an inline arrow, which would otherwise go stale).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || !isTvMode()) return;
    pause();

    // Auto-focus the first control, retrying briefly so that if the body is
    // still streaming in (no preferred button yet) focus lands on the first REAL
    // row as soon as it appears — UNLESS the user has already navigated, in which
    // case we leave their focus alone.
    let autoFocused: HTMLElement | null = null;
    const tryAutoFocus = () => {
      const root = containerRef.current;
      if (!root) return;
      const preferred = autoFocusSelector
        ? root.querySelector<HTMLElement>(autoFocusSelector)
        : null;
      const target = preferred ?? root.querySelector<HTMLElement>(FOCUSABLE);
      if (!target) return;
      const active = document.activeElement as HTMLElement | null;
      // Respect the user: once they've moved to something other than our own
      // earlier pick, stop auto-focusing.
      if (active && root.contains(active) && active !== autoFocused) return;
      if (active !== target) {
        target.focus();
        autoFocused = target;
      }
    };
    const timers = [0, 120, 280, 500].map((ms) => window.setTimeout(tryAutoFocus, ms));

    const handler = (e: KeyboardEvent) => {
      const root = containerRef.current;
      if (!root) return;
      const active = document.activeElement as HTMLElement | null;
      const inRoot = !!active && root.contains(active);
      const focusLost = !active || active === document.body;
      // Only the overlay that owns focus reacts; if focus was lost entirely
      // (node unmounted, autofocus missed) we reclaim it. If some OTHER element
      // or overlay legitimately owns focus, stay out of the way.
      if (!inRoot && !focusLost) return;

      // The user is now driving this overlay — cancel any pending auto-focus
      // retries so a late retry can never yank focus after they've started moving.
      timers.forEach((t) => window.clearTimeout(t));

      if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      // OK / Enter: activate the focused control. The Android System WebView does
      // NOT synthesize a click for a programmatically-focused button (desktop
      // Chrome does), so without this, pressing OK inside the overlay is a no-op —
      // e.g. selecting a stream / pressing Resume did nothing. Android-only;
      // browser/?tv=1 keeps the native Enter->click.
      const isOk =
        e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Select' ||
        e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66;
      if (isOk && isAndroidTv()) {
        if (inRoot && active) {
          e.preventDefault();
          e.stopPropagation();
          active.click();
        }
        return;
      }

      const isArrow =
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight';
      if (!isArrow) return;

      const isInput = active?.tagName === 'INPUT';
      // Inside a text field, Left/Right move the caret — let them through.
      if (isInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;

      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusables.length === 0) return;

      e.preventDefault();
      e.stopPropagation();
      const idx = inRoot && active ? focusables.indexOf(active) : -1;
      const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const next = focusables[(idx + delta + focusables.length) % focusables.length];
      next?.focus();
      next?.scrollIntoView({ block: 'nearest' });
    };
    // Capture phase on document: fires before React's (non-firing, for body
    // portals) synthetic handler and before Norigin (which is paused anyway).
    document.addEventListener('keydown', handler, true);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      document.removeEventListener('keydown', handler, true);
      resume();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Back-compat no-op: call sites still spread `onKeyDown={onKeyDown}` on their
  // container. The real handling is the global capture listener above (which,
  // unlike a React synthetic handler, also fires for body-portaled overlays).
  // Kept as a stub so no call site needs editing and nothing double-processes.
  const onKeyDown = (_e: React.KeyboardEvent) => {};

  return { onKeyDown };
}
