import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
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
import { BlissTooltip } from '../base/BlissTooltip';
import { useFriends } from '../../context/FriendsProvider';
import { useAuth } from '../../context/AuthProvider';
import { desktop, isNativeShell } from '../../lib/desktop';
import { useFooterAccordionHeights } from './useFooterAccordionHeights';
import { useViewportShorterThan } from './useViewportHeight';

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
  // Both bottom accordions are controlled here so the surrounding
  // `<div>` for each box can flip between `flex-1 min-h-0` (when
  // expanded) and `shrink-0` (collapsed) — that's what lets the two
  // share remaining vertical space dynamically.
  const [continueExpanded, setContinueExpanded] = useState<boolean>(true);
  const [friendsExpanded, setFriendsExpanded] = useState<boolean>(true);
  // Friends drawer (collapsed sidebar) — mirrors the Continue Watching
  // drawer pattern: tooltip on hover, drawer on click. The badge shows
  // pending incoming friend requests because those are the actionable
  // items; total-friends count would just be visual noise.
  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const location = useLocation();
  const { friends, incoming: friendsIncoming } = useFriends();
  // `userLabel` always falls through to 'Guest' upstream, so it's
  // never null. Use the raw auth token to detect logged-out state.
  const { authKey } = useAuth();
  const isSignedIn = Boolean(authKey);

  // Desktop shell version badge next to the brand label.
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

  // Short-viewport compact mode: when the screen is too short for
  // even one accordion to render a useful list, force-collapse both
  // and route header clicks to the same drawer overlay the
  // collapsed-sidebar mode uses. Keeps the footer headers visible
  // (with the small "FRIENDS · 1" / "CW · 38" labels) so the user
  // can still see counts at a glance and tap into a modal for the
  // full lists.
  const isShortViewport = useViewportShorterThan(540);
  const effectiveFriendsExpanded = isShortViewport ? false : friendsExpanded;
  const effectiveContinueExpanded = isShortViewport ? false : continueExpanded;

  // Integer-snap heights for the two footer accordions. Refs below
  // are attached to: the footer wrapper, the Friends chrome (header
  // button + search row), one rendered friend row, the CW header
  // button, and one rendered CW row. The hook ResizeObserves the
  // footer and recomputes whenever any of those change size.
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
    friendsExpanded: isSignedIn && effectiveFriendsExpanded,
    cwExpanded: effectiveContinueExpanded && props.continueWatching.length > 0,
    friendsItemCount: friends.length,
    cwItemCount: props.continueWatching.length,
  });

  // Same top-lock as the Friends list (see FriendsAccordion): the CW list can
  // re-sort once library/progress data settles, and the browser would
  // scroll-anchor away from the top, hiding the most-recent items. Hold it at
  // the top through the load + settle window; release on the first user scroll.
  const cwLockedRef = useRef(true);
  useEffect(() => {
    const el = cwListRef.current;
    if (!el) return;
    cwLockedRef.current = true;
    const release = () => { cwLockedRef.current = false; };
    const onScroll = () => { if (cwLockedRef.current && el.scrollTop !== 0) el.scrollTop = 0; };
    el.addEventListener('wheel', release, { passive: true });
    el.addEventListener('touchstart', release, { passive: true });
    el.addEventListener('keydown', release);
    el.addEventListener('scroll', onScroll, { passive: true });
    const t = window.setTimeout(release, 4000);
    return () => {
      el.removeEventListener('wheel', release);
      el.removeEventListener('touchstart', release);
      el.removeEventListener('keydown', release);
      el.removeEventListener('scroll', onScroll);
      window.clearTimeout(t);
    };
  }, [isSignedIn]);

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

  // Mirror the body-scroll-lock + Esc-to-close behavior for the
  // Friends drawer so the two collapsed-sidebar drawers feel identical.
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

  // Close the overlay drawers whenever the route changes — e.g. the
  // "View profile" action navigates to /profile/:id from inside the
  // Friends drawer; without this the portal'd sheet would stay open on
  // top of the new page.
  useEffect(() => {
    setIsFriendsOpen(false);
    setIsContinueOpen(false);
  }, [location.pathname]);

  return (
    <div className={'rounded-[28px] bliss-sidebar relative h-full w-full overflow-visible' + (collapsed ? ' closed' : '')}>
      <div className="solid-surface relative flex h-full w-full flex-col overflow-hidden rounded-[28px] bg-white/6 shadow-xl antialiased">
        {/* Logo bar — margin clamps with viewport so the header
            shrinks on shorter screens. The logo itself stays a fixed
            size so the brand mark doesn't get tiny. */}
        <div className="mx-4 my-[clamp(0.5rem,1.2vh,1rem)] flex shrink-0 items-center">
          {/* Logo container uses the same `nav-icon-slot` width as
              the NavItem rows below, so when the sidebar is
              collapsed the logo sits at the same x-center as the
              nav icons. The slot also flips to width:100% in the
              `.closed` state so it tracks the button width exactly,
              keeping the logo centered with no sub-pixel drift. */}
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

        {/* Nav caps at 33dvh so it sits equal to each of the two
            footer accordions when all three are fully populated.
            Natural smaller-than-cap content stays at its natural
            height; nothing here ever needs to scroll in practice
            since there are only 5 items. */}
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
              label="Join Party"
              icon={ICONS.watchParty}
              active={false}
              collapsed={collapsed}
              onPress={() => props.onOpenJoinParty()}
            />
            {/* Desktop-only: the dedicated AddonsPage. Web manages addons
                via the in-shell modal flow. */}
            {isNativeShell() ? (
              <NavItem
                label="Addons"
                icon={ICONS.addons}
                active={props.active === 'addons'}
                collapsed={collapsed}
                onPress={() => handleNavChange('addons')}
              />
            ) : null}
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
          // Footer claims all remaining vertical space and uses
          // `justify-end` so both accordions hug the bottom edge of
          // the sidebar — including when they're collapsed to just
          // headers, in which case the empty space lives above them.
          //
          // Each box is content-sized (`flex-shrink min-h-0`, no
          // `flex-1`) so an expanded accordion with only one friend
          // doesn't blow up to fill 50% of the footer — its height
          // matches its content. When total content exceeds the
          // footer height the shrink kicks in proportionally and the
          // inner lists scroll.
          <div
            ref={footerRef}
            className="footer flex min-h-0 flex-1 flex-col justify-end gap-1.5 px-3 pb-3"
          >
            {/* Two bottom-anchored accordions with a small gap so
                they read as separate cards (was glued, user asked for
                breathing room). The integer-snap hook above computes
                each list's maxHeight so neither shows a half-clipped
                row at the bottom. */}
            <div className="flex w-full min-h-0 shrink flex-col overflow-hidden rounded-2xl bg-white/6 p-2.5">
              {/* FriendsAccordion ships its own "FRIENDS" header, so
                  we don't render another one here. The fallback
                  signed-out block uses its own label + Login pill. */}
              {isSignedIn ? (
                <FriendsAccordion
                  expanded={effectiveFriendsExpanded}
                  onExpandedChange={(next) => {
                    // Short viewport: header tap opens the drawer
                    // overlay (same UX as the collapsed-sidebar
                    // mode). Drawer state owns the open/close; the
                    // inline accordion stays force-collapsed.
                    if (isShortViewport) {
                      setIsFriendsOpen(true);
                      return;
                    }
                    setFriendsExpanded(next);
                  }}
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
                onClick={() => {
                  // Short viewport: header tap opens the drawer
                  // overlay (same UX as the collapsed-sidebar mode)
                  // instead of trying to expand a list there's no
                  // room for.
                  if (isShortViewport) {
                    setIsContinueOpen(true);
                    return;
                  }
                  setContinueExpanded((v) => !v);
                }}
                className="flex w-full shrink-0 cursor-pointer items-center justify-between gap-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/50 hover:text-foreground/70"
                aria-expanded={effectiveContinueExpanded}
              >
                <div className="flex items-center gap-2">
                  <span>Continue Watching</span>
                  {props.continueWatching.length > 0 ? (
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-foreground/70">
                      {props.continueWatching.length}
                    </span>
                  ) : null}
                </div>
                {/* Base icon points UP (^). rotate-180 when expanded → down. */}
                <svg
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${effectiveContinueExpanded ? 'rotate-180' : ''}`}
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
              {/* Wrapper motion.div animates height with an EXPLICIT
                  numeric target = snap value + mt-2 spacing. Using
                  'auto' caused Framer Motion to measure the list's
                  natural (uncapped) height first; animating the list
                  itself as flex-col + shrink let children collapse to
                  height: 0 mid-animation. The wrapper pattern keeps
                  the inner list as a stable container with its real
                  maxHeight, and the snap hook reads accurate per-row
                  offsetHeights regardless of wrapper state. */}
              <motion.div
                initial={false}
                animate={{
                  height:
                    effectiveContinueExpanded && props.continueWatching.length > 0 && cwListMaxHeight != null
                      ? cwListMaxHeight + 8 // 8 = mt-2 on inner list
                      : effectiveContinueExpanded && props.continueWatching.length === 0
                        ? 'auto'
                        : 0,
                  opacity: effectiveContinueExpanded ? 1 : 0,
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
                    className="mt-2 flex flex-col gap-[clamp(0.375rem,0.8vh,0.625rem)] snap-y snap-proximity [overflow-anchor:none] overflow-auto pr-1 hide-scrollbar"
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
            <BlissTooltip content="Friends" placement="right" contentClassName="whitespace-nowrap">
              <button
                type="button"
                className="bliss-sidebar-link cursor-pointer mx-4 flex h-[clamp(2rem,max(3vh,1.6vw),3.25rem)] w-[calc(100%-2rem)] items-center rounded-2xl transition duration-300"
                aria-label="Friends"
                onClick={() => {
                  if (!isSignedIn) {
                    props.onOpenLogin();
                    return;
                  }
                  setIsFriendsOpen((prev) => !prev);
                }}
              >
                {/* Same icon-slot pattern as NavItem so the icon
                    sits at the same x-center as the nav rows.
                    Icon size clamps with viewport to match the
                    nav icons (20→32px from laptop to 4K). */}
                <div className="nav-icon-slot relative flex h-full shrink-0 items-center justify-center">
                  <FriendsIcon className="h-[clamp(1.25rem,1.1vw,2rem)] w-[clamp(1.25rem,1.1vw,2rem)]" />
                  {friendsIncoming.length > 0 ? (
                    <div className="absolute right-1 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[9px] font-semibold text-black border-0">
                      {friendsIncoming.length > 99 ? '99+' : friendsIncoming.length}
                    </div>
                  ) : null}
                </div>
              </button>
            </BlissTooltip>

            <BlissTooltip content="Continue watching" placement="right" contentClassName="whitespace-nowrap">
              <button
                type="button"
                className="bliss-sidebar-link cursor-pointer mx-4 flex h-[clamp(2rem,max(3vh,1.6vw),3.25rem)] w-[calc(100%-2rem)] items-center rounded-2xl transition duration-300"
                aria-label="Continue watching"
                onClick={() => {
                  if (!props.userLabel) {
                    props.onOpenLogin();
                    return;
                  }
                  setIsContinueOpen((prev) => !prev);
                }}
              >
                {/* Same icon-slot pattern as NavItem so the icon
                    sits at the same x-center as the nav rows.
                    Icon size clamps with viewport to match the
                    nav icons (20→32px from laptop to 4K). */}
                <div className="nav-icon-slot relative flex h-full shrink-0 items-center justify-center">
                  <ContinueIcon className="h-[clamp(1.25rem,1.1vw,2rem)] w-[clamp(1.25rem,1.1vw,2rem)]" />
                  {props.continueWatching.length > 0 ? (
                    <div className="absolute right-1 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[9px] font-semibold text-black border-0">
                      {props.continueWatching.length > 99 ? '99+' : props.continueWatching.length}
                    </div>
                  ) : null}
                </div>
              </button>
            </BlissTooltip>

          </div>
        )}

        {/* Drawer overlays rendered at the sidebar root so they're
            available in BOTH the collapsed branch (icon-only nav
            tap → drawer) and the expanded branch (compact-mode
            accordion-header tap → drawer). State lives on
            isFriendsOpen / isContinueOpen and is invariant across
            collapse / compact mode toggles. */}
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
