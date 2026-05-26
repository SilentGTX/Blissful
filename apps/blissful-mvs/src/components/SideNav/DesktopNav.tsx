import { Tooltip } from '@heroui/react';
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import type { SideNavView, SideNavProps } from './types';
import { ICONS } from './utils';
import { NavItem } from './NavItem';
import { ContinueWatchingDrawer } from './ContinueWatchingDrawer';
import { ContinueWatchingItem } from './ContinueWatchingItem';
import { FriendsDrawer } from './FriendsDrawer';
import { CollapseIcon } from '../../icons/CollapseIcon';
import { ContinueIcon } from '../../icons/ContinueIcon';
import { FriendsIcon } from '../../icons/FriendsIcon';
import { FriendsAccordion } from '../Friends';
import { useFriends } from '../../context/FriendsProvider';
import { useAuth } from '../../context/AuthProvider';
import { desktop, isNativeShell } from '../../lib/desktop';
import { useFooterAccordionHeights } from './useFooterAccordionHeights';

export type DesktopNavProps = Pick<
  SideNavProps,
  | 'active'
  | 'onChange'
  | 'onOpenLogin'
  | 'onOpenJoinParty'
  | 'collapsed'
  | 'onToggleCollapsed'
  | 'continueWatching'
  | 'continueSyncError'
  | 'userLabel'
  | 'onOpenContinueItem'
  | 'onRemoveContinueItem'
>;

export function DesktopNav(props: DesktopNavProps) {
  const { collapsed } = props;
  const [isContinueOpen, setIsContinueOpen] = useState(false);
  const [isContinueTooltipOpen, setIsContinueTooltipOpen] = useState(false);
  const [continueExpanded, setContinueExpanded] = useState<boolean>(true);
  const [friendsExpanded, setFriendsExpanded] = useState<boolean>(true);
  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const [isFriendsTooltipOpen, setIsFriendsTooltipOpen] = useState(false);
  const { friends, incoming: friendsIncoming } = useFriends();
  const { authKey } = useAuth();
  const isSignedIn = Boolean(authKey);

  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => {
    if (!isNativeShell()) return;
    let cancelled = false;
    desktop
      .getAppVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Integer-snap heights for the two footer accordions.
  const footerRef = useRef<HTMLDivElement | null>(null);
  const friendsChromeRef = useRef<HTMLDivElement | null>(null);
  const friendsListRef = useRef<HTMLDivElement | null>(null);
  const cwHeaderRef = useRef<HTMLButtonElement | null>(null);
  const cwListRef = useRef<HTMLDivElement | null>(null);
  const { friendsListMaxHeight, cwListMaxHeight } = useFooterAccordionHeights({
    footerRef,
    friendsListRef,
    cwListRef,
    friendsChromeRef,
    cwHeaderRef,
    friendsExpanded: isSignedIn && friendsExpanded,
    cwExpanded: continueExpanded && props.continueWatching.length > 0,
    friendsItemCount: friends.length,
    cwItemCount: props.continueWatching.length,
  });

  const handleNavChange = (view: SideNavView) => {
    props.onChange(view);
  };

  useEffect(() => {
    if (!isContinueOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsContinueOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isContinueOpen]);

  useEffect(() => {
    if (!isFriendsOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFriendsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFriendsOpen]);

  return (
    <div className={'rounded-[28px] bliss-sidebar relative h-full w-full overflow-visible' + (collapsed ? ' closed' : '')}>
      <div className="solid-surface relative flex h-full w-full flex-col overflow-hidden rounded-[28px] bg-white/6 shadow-xl antialiased">
        <div className="mx-4 my-[clamp(0.5rem,1.2vh,1rem)] flex shrink-0 items-center">
          <div className="nav-icon-slot flex shrink-0 items-center justify-center">
            <button
              type="button"
              className="logo flex items-center justify-center text-white/80 hover:text-white transition duration-300 h-[clamp(1.75rem,1.8vw,3.5rem)] w-[clamp(1.75rem,1.8vw,3.5rem)]"
              aria-label="Home"
              onClick={() => handleNavChange('home')}
            >
              <img src="/blissful-small-logo.png" alt="Blissful" className="h-full w-full object-contain" />
            </button>
          </div>

          {!collapsed ? (
            <div className="ml-3 flex min-w-0 items-baseline gap-1.5 truncate">
              <span className="font-[Fraunces] font-semibold tracking-tight text-white text-[clamp(0.875rem,1vw,1.5rem)]">
                Blissful
              </span>
              {appVersion ? (
                <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
                  v{appVersion}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mx-4 h-px shrink-0 bg-white/10" />

        <nav className="my-2 max-h-[33dvh] shrink-0">
          <ul className="flex flex-col gap-0.5">
            <NavItem
              label="Home"
              icon={ICONS.home}
              active={props.active === 'home'}
              collapsed={collapsed}
              onPress={() => handleNavChange('home')}
            />
            <NavItem
              label="Discover"
              icon={ICONS.discover}
              active={props.active === 'discover'}
              collapsed={collapsed}
              onPress={() => handleNavChange('discover')}
            />
            <NavItem
              label="Library"
              icon={ICONS.library}
              active={props.active === 'library'}
              collapsed={collapsed}
              onPress={() => handleNavChange('library')}
            />
            <NavItem
              label="Addons"
              icon={ICONS.addons}
              active={props.active === 'addons'}
              collapsed={collapsed}
              onPress={() => handleNavChange('addons')}
            />
            <NavItem
              label="Join Party"
              icon={ICONS.watchParty}
              active={false}
              collapsed={collapsed}
              onPress={() => props.onOpenJoinParty()}
            />
            <NavItem
              label="Settings"
              icon={ICONS.settings}
              active={props.active === 'settings'}
              collapsed={collapsed}
              onPress={() => handleNavChange('settings')}
            />
          </ul>
        </nav>

        {!collapsed ? (
          <div
            ref={footerRef}
            className="footer flex min-h-0 flex-1 flex-col justify-end gap-1.5 px-3 pb-3"
          >
            <div className="flex w-full min-h-0 shrink flex-col overflow-hidden rounded-2xl bg-white/6 p-2.5">
              {isSignedIn ? (
                <FriendsAccordion
                  expanded={friendsExpanded}
                  onExpandedChange={setFriendsExpanded}
                  chromeRef={friendsChromeRef}
                  listRef={friendsListRef}
                  listMaxHeight={friendsListMaxHeight}
                />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
                    Friends
                  </div>
                  <button
                    type="button"
                    className="cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
                    onClick={() => props.onOpenLogin()}
                  >
                    Login
                  </button>
                </div>
              )}
            </div>
            <div className="flex w-full min-h-0 shrink flex-col overflow-hidden rounded-2xl bg-white/6 p-2.5">
              <button
                ref={cwHeaderRef}
                type="button"
                onClick={() => setContinueExpanded((v) => !v)}
                className="flex w-full shrink-0 cursor-pointer items-center justify-between gap-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/50 hover:text-foreground/70"
                aria-expanded={continueExpanded}
              >
                <div className="flex items-center gap-2">
                  <span>Continue Watching</span>
                  {props.continueWatching.length > 0 ? (
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-foreground/70">
                      {props.continueWatching.length}
                    </span>
                  ) : null}
                </div>
                <svg
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${continueExpanded ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 15 12 9 18 15" />
                </svg>
              </button>
              <motion.div
                initial={false}
                animate={{
                  height:
                    continueExpanded && props.continueWatching.length > 0 && cwListMaxHeight != null
                      ? cwListMaxHeight + 8
                      : continueExpanded && props.continueWatching.length === 0
                        ? 'auto'
                        : 0,
                  opacity: continueExpanded ? 1 : 0,
                }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                style={{ overflow: 'hidden' }}
              >
                {props.continueWatching.length === 0 ? (
                  <div className="pt-2 text-sm text-foreground/70">
                    {props.userLabel ? (
                      'Nothing in progress yet.'
                    ) : (
                      <button
                        type="button"
                        className="cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
                        onClick={() => props.onOpenLogin()}
                      >
                        Login to sync progress
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    ref={cwListRef}
                    className="mt-2 flex flex-col gap-[clamp(0.375rem,0.8vh,0.625rem)] snap-y snap-mandatory overflow-auto pr-1 hide-scrollbar"
                    style={cwListMaxHeight != null ? { maxHeight: cwListMaxHeight } : undefined}
                  >
                    {props.continueWatching.map((item) => (
                      <ContinueWatchingItem
                        key={item._id}
                        item={item}
                        compact
                        onOpen={() => props.onOpenContinueItem(item)}
                        onRemove={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          props.onRemoveContinueItem(item);
                        }}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            </div>
          </div>
        ) : (
          <div className="footer mt-auto flex flex-col flex-shrink-0 gap-0.5 pb-3">
            <Tooltip isOpen={isFriendsTooltipOpen} delay={0} closeDelay={0}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  className="bliss-sidebar-link cursor-pointer mx-4 flex h-[clamp(2rem,max(3vh,1.6vw),3.25rem)] w-[calc(100%-2rem)] items-center rounded-2xl transition duration-300"
                  aria-label="Friends"
                  onMouseEnter={() => setIsFriendsTooltipOpen(true)}
                  onMouseLeave={() => setIsFriendsTooltipOpen(false)}
                  onFocus={() => setIsFriendsTooltipOpen(true)}
                  onBlur={() => setIsFriendsTooltipOpen(false)}
                  onClick={() => {
                    if (!isSignedIn) {
                      props.onOpenLogin();
                      return;
                    }
                    setIsFriendsOpen((prev) => !prev);
                  }}
                >
                  <div className="nav-icon-slot relative flex h-full shrink-0 items-center justify-center">
                    <FriendsIcon className="h-[clamp(1.25rem,1.1vw,2rem)] w-[clamp(1.25rem,1.1vw,2rem)]" />
                    {friendsIncoming.length > 0 ? (
                      <div className="absolute right-1 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[9px] font-semibold text-black border-0">
                        {friendsIncoming.length > 99 ? '99+' : friendsIncoming.length}
                      </div>
                    ) : null}
                  </div>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content
                placement="right"
                offset={22}
                UNSTABLE_portalContainer={document.body}
                className="bg-white/10 text-white px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md whitespace-nowrap"
              >
                Friends
              </Tooltip.Content>
            </Tooltip>

            <Tooltip isOpen={isContinueTooltipOpen} delay={0} closeDelay={0}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  className="bliss-sidebar-link cursor-pointer mx-4 flex h-[clamp(2rem,max(3vh,1.6vw),3.25rem)] w-[calc(100%-2rem)] items-center rounded-2xl transition duration-300"
                  aria-label="Continue watching"
                  onMouseEnter={() => setIsContinueTooltipOpen(true)}
                  onMouseLeave={() => setIsContinueTooltipOpen(false)}
                  onFocus={() => setIsContinueTooltipOpen(true)}
                  onBlur={() => setIsContinueTooltipOpen(false)}
                  onClick={() => {
                    if (!props.userLabel) {
                      props.onOpenLogin();
                      return;
                    }
                    setIsContinueOpen((prev) => !prev);
                  }}
                >
                  <div className="nav-icon-slot relative flex h-full shrink-0 items-center justify-center">
                    <ContinueIcon className="h-[clamp(1.25rem,1.1vw,2rem)] w-[clamp(1.25rem,1.1vw,2rem)]" />
                    {props.continueWatching.length > 0 ? (
                      <div className="absolute right-1 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[9px] font-semibold text-black border-0">
                        {props.continueWatching.length > 99 ? '99+' : props.continueWatching.length}
                      </div>
                    ) : null}
                  </div>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content
                placement="right"
                offset={22}
                UNSTABLE_portalContainer={document.body}
                className="bg-white/10 text-white px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md whitespace-nowrap"
              >
                Continue watching
              </Tooltip.Content>
            </Tooltip>

            <FriendsDrawer
              isOpen={isFriendsOpen}
              onClose={() => setIsFriendsOpen(false)}
              isSignedIn={isSignedIn}
              onOpenLogin={props.onOpenLogin}
            />
            <ContinueWatchingDrawer
              isOpen={isContinueOpen}
              onClose={() => setIsContinueOpen(false)}
              items={props.continueWatching}
              userLabel={props.userLabel}
              syncError={props.continueSyncError}
              onOpenItem={props.onOpenContinueItem}
              onRemoveItem={props.onRemoveContinueItem}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        id="sidebar-toggle"
        className="toggle transition duration-500 flex w-8 h-8 items-center justify-center absolute rounded-full top-7 -right-3 z-10 cursor-pointer solid-surface shadow"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={props.onToggleCollapsed}
      >
        <CollapseIcon collapsed={collapsed} className="h-[18px] w-[18px] cursor-pointer" />
      </button>
    </div>
  );
}
