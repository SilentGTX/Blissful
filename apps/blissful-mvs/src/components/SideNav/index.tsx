import type { SideNavProps } from './types';
import { MobileNav } from './MobileNav';
import { DesktopNav } from './DesktopNav';

export { type SideNavView, type SideNavProps } from './types';

export default function SideNav(props: SideNavProps) {
  if (props.isMobile) {
    return (
      <MobileNav
        active={props.active}
        onChange={props.onChange}
        onOpenLogin={props.onOpenLogin}
        continueWatching={props.continueWatching}
        continueSyncError={props.continueSyncError}
        userLabel={props.userLabel}
        onOpenContinueItem={props.onOpenContinueItem}
        onRemoveContinueItem={props.onRemoveContinueItem}
      />
    );
  }

  return (
    <DesktopNav
      active={props.active}
      onChange={props.onChange}
      onOpenLogin={props.onOpenLogin}
      collapsed={props.collapsed}
      onToggleCollapsed={props.onToggleCollapsed}
      continueWatching={props.continueWatching}
      continueSyncError={props.continueSyncError}
      userLabel={props.userLabel}
      onOpenContinueItem={props.onOpenContinueItem}
      onRemoveContinueItem={props.onRemoveContinueItem}
    />
  );
}
