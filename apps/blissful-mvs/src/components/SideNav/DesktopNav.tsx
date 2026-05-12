import { Accordion, Tooltip } from '@heroui/react';
import { useState, useEffect, useMemo } from 'react';
import type { LibraryItem } from '../../lib/stremioApi';
import type { SideNavView, SideNavProps } from './types';
import { ICONS } from './utils';
import { NavItem } from './NavItem';
import { ContinueWatchingDrawer } from './ContinueWatchingDrawer';
import { ContinueWatchingItem } from './ContinueWatchingItem';
import { CollapseIcon } from '../../icons/CollapseIcon';
import { ContinueIcon } from '../../icons/ContinueIcon';
import { desktop, isNativeShell } from '../../lib/desktop';

export type DesktopNavProps = Pick<
  SideNavProps,
  | 'active'
  | 'onChange'
  | 'onOpenLogin'
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
  // App version shown next to the "Blissful" wordmark in the sidebar
  // header. Fetched once on mount via the shell IPC, which surfaces
  // CARGO_PKG_VERSION from blissful-shell's Cargo.toml. Empty string
  // outside the native shell (e.g. browser/dev) so the wordmark
  // renders cleanly.
  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => {
    if (!isNativeShell()) return;
    let cancelled = false;
    desktop
      .getAppVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {
        /* ignore — non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNavChange = (view: SideNavView) => {
    props.onChange(view);
  };

  const continueExpandedKeys = useMemo(() => (continueExpanded ? new Set(['continue']) : new Set<string>()), [continueExpanded]);
  const continuePages = useMemo(() => {
    const out: LibraryItem[][] = [];
    for (let i = 0; i < props.continueWatching.length; i += 3) {
      out.push(props.continueWatching.slice(i, i + 3));
    }
    return out;
  }, [props.continueWatching]);

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

  return (
    <div className={'rounded-[28px] bliss-sidebar relative h-full w-full overflow-visible' + (collapsed ? ' closed' : '')}>
      <div className="solid-surface relative flex h-full w-full flex-col overflow-hidden rounded-[28px] bg-white/6 shadow-xl antialiased">
        <div className="m-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-[calc(5.5rem-2rem)] flex justify-center">
            <button
              type="button"
              className="logo h-10 w-10 flex justify-center items-center text-white/80 hover:text-white transition duration-300"
              aria-label="Home"
              onClick={() => handleNavChange('home')}
            >
              <img src="/blissful-small-logo.png" alt="Blissful" className="h-10 w-10 object-contain" />
            </button>
          </div>

          {!collapsed ? (
            <div className="flex min-w-0 items-baseline gap-1.5 truncate">
              <span className="font-[Fraunces] text-lg font-semibold tracking-tight text-white">
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

        <div className="mx-4 h-px bg-white/10" />

        <nav className="my-4 flex-1">
          <ul className="flex h-full flex-col gap-2">
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
              label="Settings"
              icon={ICONS.settings}
              active={props.active === 'settings'}
              collapsed={collapsed}
              onPress={() => handleNavChange('settings')}
            />
          </ul>
        </nav>

        {!collapsed ? (
          <div className="footer mt-auto flex flex-shrink-0 px-4 pb-4">
            <div className="w-full rounded-2xl bg-white/6 p-3">
              <Accordion
                expandedKeys={continueExpandedKeys}
                onExpandedChange={(keys) => {
                  setContinueExpanded(keys.has('continue'));
                }}
                className="w-full"
              >
                <Accordion.Item id="continue">
                  <Accordion.Heading>
                    <Accordion.Trigger className="px-0 py-0 text-xs font-semibold uppercase tracking-wide text-foreground/50 hover:bg-transparent hover:text-foreground/50 data-[hovered=true]:bg-transparent data-[hovered=true]:text-foreground/50">
                      <div className="mr-auto flex items-center gap-2">
                        <div>Continue Watching</div>
                        {props.continueWatching.length > 0 ? (
                          <div className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-foreground/70">
                            {props.continueWatching.length}
                          </div>
                        ) : null}
                      </div>
                      <Accordion.Indicator className="ml-auto" />
                    </Accordion.Trigger>
                  </Accordion.Heading>
                  <Accordion.Panel>
                    <Accordion.Body className="px-0 pt-3">
                      {props.continueWatching.length === 0 ? (
                        <div className="text-sm text-foreground/70">
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
                        <div className="h-[230px] overflow-auto pr-1 hide-scrollbar snap-y snap-mandatory scroll-smooth">
                          {continuePages.map((page, pageIdx) => (
                            <div
                              key={`page-${pageIdx}`}
                              className="snap-start snap-stop-always flex h-[230px] flex-col justify-start gap-2"
                            >
                              {page.map((item) => (
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
                          ))}
                        </div>
                      )}
                    </Accordion.Body>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </div>
          </div>
        ) : (
          <div className="footer mt-auto flex flex-shrink-0 px-4 pb-4">
            <Tooltip isOpen={isContinueTooltipOpen} delay={0} closeDelay={0}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  className="bliss-sidebar-link cursor-pointer mx-4 flex h-11 w-[calc(100%-2rem)] items-center justify-center rounded-2xl transition duration-300"
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
                  <div className="relative">
                    <ContinueIcon size={20} />
                    {props.continueWatching.length > 0 ? (
                      <div className="absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-white text-[9px] font-semibold text-black border-0">
                        {Math.min(9, props.continueWatching.length)}
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
