// TV-ONLY global focus-recovery watchdog.
//
// Norigin is initialised with shouldFocusDOMNode:false (see main.tsx), so D-pad
// focus exists only as an in-engine focusKey mirrored to data-focused="true" on
// the focused node. When that node unmounts (a card scrolls out / a rail
// re-renders / a route swaps content / a duplicate-key glitch), the engine's
// stored focusKey goes stale, NO element carries data-focused, and Norigin's
// global keydown handler has no "from" node — every arrow press becomes a
// silent no-op and the remote is dead until focus is re-seeded.
//
// installFocusRecovery() adds a CAPTURE-phase window keydown listener (TV only)
// that runs BEFORE Norigin's own handler. On a D-pad key, if focus has been
// lost (no [data-focused]) and nothing else legitimately owns it (no input /
// overlay), it re-seeds focus to the best live target — so the SAME keypress
// both recovers focus and then performs its move.
//
// Fully inert on desktop: installFocusRecovery() is only ever called inside the
// isTvMode() block in main.tsx, so the listener is never attached otherwise.

import { setFocus } from '@noriginmedia/norigin-spatial-navigation';

// The persistent, always-mounted-on-non-fullscreen-TV nav target. Must match
// HOME_NAV_KEY in components/SideNav/DesktopNav.tsx (the Home rail item).
const HOME_NAV_KEY = 'tv-nav-home';

// D-pad keys that should trigger a recovery check. Includes the standard arrows,
// Enter/OK, and the spatial-engine's space alias. (Back/Escape are intentionally
// excluded — they are handled by useTvBack / useTvOverlay and must not re-seed
// focus into content while an overlay is closing.)
const DPAD_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  ' ', // space (OK on some remotes / browsers)
]);

// Last focusKey we saw gain focus. Updated by recordFocusKey() from
// useTvFocusable.onFocus. Used as the FIRST recovery candidate.
let lastFocusKey: string | null = null;

/** Record the most recent good focus key. Called from useTvFocusable.onFocus. */
export function recordFocusKey(key: string): void {
  if (key) lastFocusKey = key;
}

// True when something other than spatial-nav legitimately owns focus and we must
// NOT steal it: the user is typing in a field, or an overlay/menu/dialog is open
// (those pause() the engine and native-focus their own controls).
function focusIsLegitimatelyElsewhere(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
  if (active instanceof HTMLElement && active.isContentEditable) return true;
  // role=menu/dialog cover the profile menu, modals and useTvOverlay; role=listbox
  // covers the TvSelect TV overlay (which pause()s the engine and native-focuses
  // its own options) so the watchdog never re-seeds focus underneath an open select.
  if (document.querySelector('[role="dialog"],[aria-modal="true"],[role="menu"],[role="listbox"]')) return true;
  return false;
}

// Is the node visible (laid out and not display:none)? offsetParent is null for
// display:none or detached nodes; position:fixed elements report null too, so
// also accept a non-zero client rect as a fallback.
function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent !== null) return true;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

// Resolve the best live focus target and focus it. Returns true if it set focus.
function recover(): boolean {
  // (a) Last good key, if its node is still live in the DOM.
  if (lastFocusKey) {
    const node = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(lastFocusKey)}"]`);
    if (node && isVisible(node)) {
      setFocus(lastFocusKey);
      return true;
    }
  }

  // (b) First VISIBLE focusable inside the active screen's content.
  const content = document.querySelector('.bliss-content');
  if (content) {
    const candidates = content.querySelectorAll<HTMLElement>('[data-focus-key]');
    for (const node of candidates) {
      const key = node.getAttribute('data-focus-key');
      if (key && isVisible(node)) {
        setFocus(key);
        return true;
      }
    }
  }

  // (c) Persistent nav/home fallback (present on non-fullscreen TV screens).
  const home = document.querySelector<HTMLElement>(`[data-focus-key="${HOME_NAV_KEY}"]`);
  if (home && isVisible(home)) {
    setFocus(HOME_NAV_KEY);
    return true;
  }

  // (d) Last resort: ANY visible focusable anywhere (covers fullscreen routes
  // whose entry element hasn't stamped yet, or content rendered outside
  // .bliss-content).
  const any = document.querySelectorAll<HTMLElement>('[data-focus-key]');
  for (const node of any) {
    const key = node.getAttribute('data-focus-key');
    if (key && isVisible(node)) {
      setFocus(key);
      return true;
    }
  }

  return false;
}

let installed = false;

/**
 * Install the global focus-recovery watchdog. Idempotent. MUST be called only
 * under isTvMode() (main.tsx already guards this) so desktop never attaches the
 * listener. Call once, AFTER initSpatialNavigation().
 */
export function installFocusRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (!DPAD_KEYS.has(e.key)) return;

      // Focus already alive in the engine AND mirrored to the DOM → nothing to do;
      // let Norigin handle the key normally.
      if (document.querySelector('[data-focused="true"]')) return;

      // Don't fight inputs / overlays / menus that own focus on purpose.
      if (focusIsLegitimatelyElsewhere()) return;

      // If we reach here a D-pad key was pressed but NO node carries data-focused
      // and nothing legitimately owns focus — the dead state. (A focus key whose
      // node is still live would have carried data-focused above and we'd have
      // bailed.) Re-seed focus.
      //
      // Running in CAPTURE phase means this fires before Norigin's
      // own (bubble/target) keydown handler, so once setFocus lands the SAME
      // keypress is then processed by Norigin against the freshly-focused node
      // and the move happens — one press both recovers and moves.
      recover();
      // Do NOT preventDefault/stopPropagation: Norigin must still receive this
      // keydown to perform the directional move from the node we just focused.
    },
    true, // capture
  );
}
