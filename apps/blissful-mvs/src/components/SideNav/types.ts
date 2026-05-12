import type { LibraryItem } from '../../lib/stremioApi';

export type SideNavView = 'home' | 'discover' | 'library' | 'addons' | 'settings';

export type SideNavProps = {
  active: SideNavView;
  onChange: (next: SideNavView) => void;
  onOpenLogin: () => void;
  onLogout: () => void;
  userLabel: string | null;
  continueWatching: LibraryItem[];
  continueSyncError?: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenContinueItem: (item: LibraryItem, options?: { source?: 'mobile' | 'desktop' }) => void;
  onRemoveContinueItem: (item: LibraryItem) => void;
  isMobile?: boolean;
};
