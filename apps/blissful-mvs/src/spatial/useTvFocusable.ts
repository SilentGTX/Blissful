import { useEffect, useRef } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { isTvMode, isAndroidTv } from '../lib/platform';
import { recordFocusKey } from './focusRecovery';

type Options = {
  /** Fired on D-pad OK/Enter when focused (mirror of the element's onClick). */
  onPress?: () => void;
  /** Fired when OK/Enter is HELD past `longPressMs` (e.g. open a card menu).
   *  When set, onPress fires on RELEASE (tap) instead of keydown, so a hold
   *  doesn't also trigger the tap. Inert when undefined (legacy keydown press). */
  onLongPress?: () => void;
  /** Hold threshold in ms before onLongPress fires (default 450). */
  longPressMs?: number;
  /** Set false to keep the element non-focusable on TV (e.g. a disabled control). */
  focusable?: boolean;
  /** Claim focus on mount — use for the route-entry element on a screen. */
  autoFocus?: boolean;
  focusKey?: string;
  /** Called when this element gains/loses D-pad focus (in addition to the
   *  built-in scroll-into-view). Used e.g. to expand the nav rail on focus. */
  onFocus?: () => void;
  onBlur?: () => void;
  /** Intercept a D-pad direction. Return false to PREVENT Norigin's default
   *  geometric move (e.g. to force UP from the top rail onto the hero). */
  onArrowPress?: (direction: string) => boolean;
};

/**
 * Shared TV focus primitive. Wraps Norigin's `useFocusable`, gated on
 * `isTvMode()` so it is fully inert on desktop/browser-non-TV (the element's
 * existing mouse handlers stay in charge). On focus it scrolls the node into
 * view (so D-pad focus drives container scroll). With `autoFocus` it claims
 * focus on mount after a tick, so the node is registered before we focus it —
 * the reliable route-entry pattern.
 *
 * Note: Norigin's `useFocusable` sets `data-focused="true"` on the ref node (it
 * does NOT call native focus()), so focus styling keys off `[data-focused]`
 * (see the html[data-tv] rules in index.css).
 */
export function useTvFocusable({ onPress, onLongPress, longPressMs = 450, focusable = true, autoFocus = false, focusKey, onFocus, onBlur, onArrowPress }: Options = {}) {
  const tv = isTvMode();
  // Long-press (hold OK) detection. Norigin fires onEnterPress on keydown +
  // onEnterRelease on keyup and passes a pressedKeys.enter auto-repeat count
  // (1 on the first keydown, >1 while held). With onLongPress we arm a timer on
  // the first keydown; if it elapses while still held we fire onLongPress and
  // swallow the tap, else the keyup fires onPress (tap). Without onLongPress we
  // keep the legacy behavior (onPress on keydown) so no other call-site changes.
  const longTimerRef = useRef<number | null>(null);
  const longFiredRef = useRef(false);
  const clearLongTimer = () => {
    if (longTimerRef.current !== null) {
      window.clearTimeout(longTimerRef.current);
      longTimerRef.current = null;
    }
  };
  useEffect(() => clearLongTimer, []);
  const { ref, focused, focusSelf, focusKey: key } = useFocusable({
    focusable: tv && focusable,
    focusKey,
    onEnterPress: (_props?: unknown, details?: { pressedKeys?: Record<string, number> }) => {
      if (!onLongPress) {
        onPress?.();
        return;
      }
      // OS key-repeat: only the first keydown arms the hold timer.
      if ((details?.pressedKeys?.enter ?? 1) > 1) return;
      longFiredRef.current = false;
      clearLongTimer();
      longTimerRef.current = window.setTimeout(() => {
        longTimerRef.current = null;
        longFiredRef.current = true;
        onLongPress();
      }, longPressMs);
    },
    onEnterRelease: onLongPress
      ? () => {
          clearLongTimer();
          if (!longFiredRef.current) onPress?.();
          longFiredRef.current = false;
        }
      : undefined,
    onArrowPress: onArrowPress ? (direction: string) => onArrowPress(direction) : undefined,
    onFocus: () => {
      const node = ref.current as HTMLElement | null;
      // Record this as the last-good focus key + stamp the node so the global
      // focus-recovery watchdog can map a key back to a live DOM node and
      // re-seed focus if the focused node later unmounts (TV only).
      if (tv) {
        recordFocusKey(key);
        if (node) node.setAttribute('data-focus-key', key);
      }
      // Center the focused element vertically (so a focused row sits mid-screen
      // and never clips at the top/bottom edge); keep horizontal at 'nearest' so
      // rails stay left-aligned and only scroll when the card would be off-edge.
      // On a real low-end TV use 'instant': a SMOOTH scroll animates over many
      // frames, and the Mali-class software compositor repaints each one — that
      // animation (not the focus logic, which is ~200ms) is the multi-second nav
      // lag. Browser ?tv=1 testing keeps the nicer smooth scroll.
      node?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: isAndroidTv() ? 'instant' : 'smooth',
      });
      onFocus?.();
    },
    onBlur: () => onBlur?.(),
  });

  // Keep data-focus-key on the node for the lifetime of the mount (TV only) so
  // the focus-recovery watchdog can resolve this key to a live node, and remove
  // it on unmount so recovery never targets a node that's gone.
  useEffect(() => {
    if (!tv) return;
    const node = ref.current as HTMLElement | null;
    if (node) node.setAttribute('data-focus-key', key);
    return () => {
      node?.removeAttribute('data-focus-key');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv, key]);

  useEffect(() => {
    if (!tv || !autoFocus || !focusable) return;
    // Route-entry focus. We CANNOT gate on `!getCurrentFocusKey()`: the nav rail
    // is persistent across route changes, so after navigating to a new screen
    // Norigin's focus is still a (valid) nav-rail item — the guard would decline
    // and nothing in the new content gets focus, leaving the screen un-arrowable.
    // Instead: claim unless D-pad focus is ALREADY on this page's content
    // (`.bliss-content`). On entry the old content node is gone and focus sits on
    // chrome (rail/top bar) or a stale key, so we claim. One autoFocus element
    // per screen, so no race. Deferred a tick so the node registers.
    const id = window.setTimeout(() => {
      // Don't steal focus while the user is typing in a field (e.g. the search
      // pill / a TvTextInput) — that field is natively focused.
      if (document.activeElement instanceof HTMLInputElement) return;
      // Don't claim while an overlay/modal/menu is open — it owns focus.
      if (document.querySelector('[role="dialog"],[aria-modal="true"],[role="menu"]')) return;
      const focused = document.querySelector('[data-focused="true"]');
      if (!focused || !focused.closest('.bliss-content')) focusSelf();
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, focused, focusKey: key, tv };
}
