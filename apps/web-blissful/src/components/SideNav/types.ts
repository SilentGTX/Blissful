import type { LibraryItem } from '../../lib/mediaTypes';

// 'addons' is desktop-only (the dedicated AddonsPage); web manages addons
// via the in-shell modal flow. 'downloads' is web-only — the desktop shell
// plays local files through mpv and has no browser storage budget to manage.
export type SideNavView = 'home' | 'discover' | 'library' | 'addons' | 'downloads' | 'settings';

export type SideNavProps = {
  active: SideNavView;
  onChange: (next: SideNavView) => void;
  onOpenLogin: () => void;
  onOpenJoinParty: () => void;
  onLogout: () => void;
  userLabel: string | null;
  continueWatching: LibraryItem[];
  continueSyncError?: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenContinueItem: (item: LibraryItem, options?: { source?: 'mobile' | 'desktop' }) => void;
  onRemoveContinueItem: (item: LibraryItem) => void;
  isMobile?: boolean;
  /** No connection: everything except Downloads/Settings is unreachable, so
   *  those entries render dimmed and inert instead of bouncing through a
   *  redirect. */
  offline?: boolean;
};
