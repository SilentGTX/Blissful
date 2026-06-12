// Drawer-mode Friends panel — surfaced from the collapsed desktop
// sidebar (and the mobile bottom navbar) so the friends UI is still
// reachable when there's no room for the inline accordion. Visually
// mirrors ContinueWatchingDrawer: portal'd backdrop + solid-surface
// bottom-anchored sheet. The body is just the existing
// FriendsAccordion — single source of truth for friends UX.

import { createPortal } from 'react-dom';
import { FriendsAccordion } from '../Friends';

export type FriendsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  /** True iff the user has an active auth token. AppShell's
   *  `userLabel` always falls back to 'Guest' so it's not a reliable
   *  logged-out signal — the parent computes this from `useAuth()`. */
  isSignedIn: boolean;
  onOpenLogin: () => void;
};

export function FriendsDrawer({ isOpen, onClose, isSignedIn, onOpenLogin }: FriendsDrawerProps) {
  if (!isOpen) return null;
  return createPortal(
    <>
      <div className="bliss-continue-backdrop" aria-hidden="true" onClick={onClose} />
      <div className="bliss-continue-drawer bliss-bottom-drawer solid-surface">
        {/* No "Friends" title here — FriendsAccordion renders its own
            accordion header below. When signed out we show our own
            "Friends" label next to the login button. */}
        {isSignedIn ? (
          <div className="flex max-h-[70vh] min-h-[260px] flex-col overflow-auto pr-1 hide-scrollbar">
            <FriendsAccordion />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
              Friends
            </div>
            <button
              type="button"
              className="cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
              onClick={onOpenLogin}
            >
              Login
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
