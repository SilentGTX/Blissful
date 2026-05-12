import { Avatar, Button, Dropdown, Input, Label, Separator, Tooltip } from '@heroui/react';
import { PenIcon } from '../../icons/PenIcon';
import { CloseIcon } from '../../icons/CloseIcon';
import { SearchIcon } from '../../icons/SearchIcon';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { renderProfileAvatar } from '../../lib/profileAvatars';
import type { StremioMetaPreview } from '../../lib/stremioAddon';
import { desktop, isNativeShell } from '../../lib/desktop';

type TopNavProps = {
  userEmail?: string | null;
  isLoggedIn: boolean;
  query: string;
  isSearchMenuOpen: boolean;
  searchHistory: string[];
  searchSuggestions: string[];
  searchResults?: StremioMetaPreview[];
  onSelectResult?: (result: StremioMetaPreview) => void;
  searchMenuRef: RefObject<HTMLDivElement | null>;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onClearQuery: () => void;
  onSelectQuery: (value: string) => void;
  onNavigateHome: () => void;
  onClearHistory: () => void;
  onToggleHomeEdit: () => void;
  isHomeRoute: boolean;
  onOpenProfiles: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onNavigateSettings: () => void;
  onOpenHomeSettings: () => void;
  onNavigateAddons: () => void;
  onNavigateAccounts: () => void;
  onToggleFullscreen: () => void;
  setSearchMenuOpen: (open: boolean) => void;
  accountAvatar?: string;
  accountDisplayName: string;
  isWhoWatchingOpen?: boolean;
};

export function TopNav({
  userEmail,
  isLoggedIn,
  query,
  isSearchMenuOpen,
  searchHistory,
  searchSuggestions,
  searchResults,
  onSelectResult,
  searchMenuRef,
  onQueryChange,
  onSubmit,
  onClearQuery,
  onSelectQuery,
  onNavigateHome,
  onClearHistory,
  onToggleHomeEdit,
  isHomeRoute,
  onOpenProfiles,
  onLogin,
  onLogout,
  onNavigateSettings,
  onOpenHomeSettings,
  onNavigateAddons,
  onNavigateAccounts,
  onToggleFullscreen,
  setSearchMenuOpen,
  accountAvatar,
  accountDisplayName,
  isWhoWatchingOpen = false,
}: TopNavProps) {
  const [isDesktopAccountMenuOpen, setIsDesktopAccountMenuOpen] = useState(false);
  const [isMobileAccountMenuOpen, setIsMobileAccountMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => {
    // Inside the native shell, defer to the shell's reported state (which
    // the useEffect below seeds). In the browser, take the current
    // document.fullscreenElement state.
    return isNativeShell() ? false : Boolean(document.fullscreenElement);
  });
  const fsLockedRef = useRef(false);
  const accountMenuDisabled = isWhoWatchingOpen;

  const safeDisplayName = (accountDisplayName || 'Guest').trim() || 'Guest';
  const accountAvatarView = isLoggedIn
    ? renderProfileAvatar(accountAvatar, safeDisplayName.slice(0, 1).toUpperCase())
    : renderProfileAvatar(undefined, safeDisplayName.slice(0, 1).toUpperCase());
  const guestInitial = safeDisplayName.slice(0, 1).toUpperCase() || 'G';

  const closeAccountMenus = () => {
    setIsDesktopAccountMenuOpen(false);
    setIsMobileAccountMenuOpen(false);
  };

  const handleAccountAction = (key: string | number) => {
    closeAccountMenus();

    const action = String(key);
    if (action === 'profiles') {
      requestAnimationFrame(() => onOpenProfiles());
      return;
    }
    if (action === 'auth') {
      if (isLoggedIn) onLogout();
      else onLogin();
    }
    if (action === 'settings') onNavigateSettings();
    if (action === 'home') onOpenHomeSettings();
    if (action === 'addons') onNavigateAddons();
    if (action === 'accounts') onNavigateAccounts();
    if (action === 'fullscreen') {
      fsLockedRef.current = true;
      setIsDesktopAccountMenuOpen(false);
      setIsMobileAccountMenuOpen(false);
      // Blur to escape HeroUI's focus trap that keeps the popover alive
      (document.activeElement as HTMLElement)?.blur();
      // Force-remove the popover from DOM
      document.querySelectorAll('[data-trigger="MenuTrigger"][role="dialog"]').forEach(el => {
        (el as HTMLElement).style.display = 'none';
      });
      // Wait for dropdown to fully close before resizing window
      setTimeout(() => {
        onToggleFullscreen();
        setTimeout(() => { fsLockedRef.current = false; }, 100);
      }, 100);
      return;
    }
  };

  useEffect(() => {
    if (!isWhoWatchingOpen) return;
    setIsDesktopAccountMenuOpen(false);
    setIsMobileAccountMenuOpen(false);
  }, [isWhoWatchingOpen]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setIsDesktopAccountMenuOpen(false);
      setIsMobileAccountMenuOpen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);

    // Native shell (Rust or legacy Electron): seed current fullscreen
    // state + subscribe to changes pushed by the shell.
    let unsubFs: (() => void) | undefined;
    if (isNativeShell()) {
      desktop.isFullscreen().then(setIsFullscreen).catch(() => {});
      unsubFs = desktop.onFullscreenChanged((fs) => {
        setIsFullscreen(fs);
        setIsDesktopAccountMenuOpen(false);
        setIsMobileAccountMenuOpen(false);
      });
    }
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      unsubFs?.();
    };
  }, []);

  const accountTrigger = (
    <div
      className="h-10 w-10 cursor-pointer overflow-hidden bg-transparent p-0"
      aria-label="Account"
    >
      <Avatar key={isLoggedIn ? `user-${safeDisplayName}` : 'guest'} className="h-10 w-10 bg-transparent rounded-none">
          {accountAvatarView.kind === 'image' ? (
            <Avatar.Image alt={safeDisplayName} src={accountAvatarView.value} className="object-contain" />
          ) : null}
          <Avatar.Fallback className="border-none bg-transparent text-lg leading-none text-white">
            {accountAvatarView.kind === 'image'
              ? guestInitial
              : accountAvatarView.value || guestInitial}
          </Avatar.Fallback>
        </Avatar>
    </div>
  );

  return (
    <div className="bliss-top-nav">
      <div className="bliss-top-nav-inner px-3 md:px-5">
        <div className="bliss-nav-bar flex h-[64px] md:h-[72px] w-full items-center gap-3 md:gap-4 rounded-[20px] md:rounded-[24px] px-3 md:px-4">
          <button
            type="button"
            className="flex-shrink-0 md:hidden w-10 h-10 flex justify-center items-center text-white/80 hover:text-white transition duration-300"
            aria-label="Home"
            onClick={onNavigateHome}
          >
            <img src="/blissful-small-logo.png" alt="Blissful" className="h-10 w-auto object-contain" />
          </button>

          <div
            ref={searchMenuRef}
            className="relative flex-1 md:w-[360px] md:max-w-[60vw] md:justify-self-center md:mx-auto"
          >
            <div className="relative flex items-center">
              <Input
                value={query}
                onChange={(e) => {
                  onQueryChange(e.target.value);
                  setSearchMenuOpen(true);
                }}
                placeholder="Search everything"
                className="bliss-nav-input w-full rounded-full h-11 px-4 pr-12"
                onFocus={() => setSearchMenuOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                {query.trim().length > 0 ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-foreground/70 hover:bg-white/15"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClearQuery();
                      setSearchMenuOpen(true);
                    }}
                  >
                    <CloseIcon size={16} />
                  </button>
                ) : (
                  <div className="grid h-8 w-8 place-items-center text-foreground/50">
                    <SearchIcon size={16} />
                  </div>
                )}
              </div>
            </div>

            {isSearchMenuOpen && (searchHistory.length > 0 || searchSuggestions.length > 0 || (searchResults && searchResults.length > 0)) ? (
              <div className="solid-surface absolute left-0 top-full z-50 mt-3 w-full rounded-[20px] border border-white/10 bg-white/10 p-4">
                {searchHistory.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
                        Search history
                      </div>
                      <button
                        type="button"
                        className="text-xs text-foreground/60 hover:text-foreground/80"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onClearHistory();
                        }}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="space-y-1">
                      {searchHistory.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground/85 hover:bg-white/10"
                          onClick={() => onSelectQuery(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {searchSuggestions.length > 0 ? (
                  <div className={searchHistory.length > 0 ? 'mt-4 space-y-2' : 'space-y-2'}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
                      Search suggestions
                    </div>
                    <div className="space-y-1">
                      {searchSuggestions.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="w-full rounded-xl px-3 py-2 text-left text-sm text-foreground/85 hover:bg-white/10"
                          onClick={() => onSelectQuery(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {searchResults && searchResults.length > 0 ? (
                  <div className={(searchHistory.length > 0 || searchSuggestions.length > 0) ? 'mt-4 space-y-2' : 'space-y-2'}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
                      Results
                    </div>
                    <div className="space-y-1">
                      {searchResults.map((result) => (
                        <button
                          key={`${result.type}:${result.id}`}
                          type="button"
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/10"
                          onClick={() => onSelectResult?.(result)}
                        >
                          {result.poster ? (
                            <img
                              src={result.poster.startsWith('//') ? `https:${result.poster}` : result.poster}
                              alt=""
                              className="h-12 w-8 flex-shrink-0 rounded-md object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="grid h-12 w-8 flex-shrink-0 place-items-center rounded-md bg-white/10 text-xs text-foreground/40">
                              ?
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground/90">{result.name}</div>
                            <div className="text-xs text-foreground/50">
                              {result.type}{result.year ? ` · ${result.year}` : ''}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="hidden md:flex items-center justify-self-end gap-3 flex-shrink-0">
            {isHomeRoute ? (
              <Tooltip>
                <Tooltip.Trigger>
                  <Button
                    isIconOnly
                    variant="ghost"
                    className="h-10 w-10 rounded-full bg-white/10"
                    aria-label="Toggle home edit"
                    onPress={onToggleHomeEdit}
                  >
                    <PenIcon />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content className="bg-white/10 text-white px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md">
                  Show/Hide Addons
                </Tooltip.Content>
              </Tooltip>
            ) : null}
            {accountMenuDisabled ? (
              accountTrigger
            ) : (
              <Dropdown isOpen={isDesktopAccountMenuOpen} onOpenChange={(open) => { if (!fsLockedRef.current) setIsDesktopAccountMenuOpen(open); }}>
                <Dropdown.Trigger className="rounded-full">{accountTrigger}</Dropdown.Trigger>
                <Dropdown.Popover className="mt-3 min-w-[260px] -translate-x-[10px] translate-y-[3px] rounded-2xl bg-[#2a2a2a] p-2 text-white backdrop-blur-xl">
                  <Dropdown.Menu onAction={handleAccountAction}>
                    <Dropdown.Item id="profiles" textValue="Profiles" className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8 bg-transparent rounded-none">
                          {accountAvatarView.kind === 'image' ? (
                            <Avatar.Image alt={safeDisplayName} src={accountAvatarView.value} className="object-contain" />
                          ) : null}
                          <Avatar.Fallback className="border-none bg-transparent text-sm text-white">
                            {guestInitial}
                          </Avatar.Fallback>
                        </Avatar>
                        <div className="min-w-0 text-left">
                          <div className="truncate text-sm font-semibold">{safeDisplayName}</div>
                          <div className="truncate text-xs text-white/60">{userEmail ?? 'Guest'}</div>
                        </div>
                      </div>
                    </Dropdown.Item>
                    <Dropdown.Item id="fullscreen" textValue="Fullscreen" className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                      <Label className="text-[#19f7d2]">{isFullscreen ? 'Exit full screen mode' : 'Enter full screen mode'}</Label>
                    </Dropdown.Item>
                    <Dropdown.Item id="settings" textValue="Settings" className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                      <Label>Settings</Label>
                    </Dropdown.Item>
                    <Dropdown.Item id="home" textValue="Customize Home" className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                      <Label>Customize Home</Label>
                    </Dropdown.Item>
                    <Dropdown.Item id="addons" textValue="Addons" className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                      <Label>Addons</Label>
                    </Dropdown.Item>
                    <Dropdown.Item id="accounts" textValue="Manage accounts" className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                      <Label>Manage accounts</Label>
                    </Dropdown.Item>
                    <Separator className="my-1 bg-white/10" />
                    <Dropdown.Item id="auth" textValue={isLoggedIn ? 'Logout' : 'Login'} className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                      <Label className={isLoggedIn ? 'text-red-400' : 'text-sky-400'}>
                        {isLoggedIn ? 'Logout' : 'Sign in'}
                      </Label>
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            )}
          </div>

          {accountMenuDisabled ? (
            <div className="md:hidden flex-shrink-0">{accountTrigger}</div>
          ) : (
            <Dropdown isOpen={isMobileAccountMenuOpen} onOpenChange={(open) => { if (!fsLockedRef.current) setIsMobileAccountMenuOpen(open); }}>
              <Dropdown.Trigger className="rounded-full">
                <div className="md:hidden flex-shrink-0">{accountTrigger}</div>
              </Dropdown.Trigger>
              <Dropdown.Popover className="mt-3 min-w-[240px] rounded-2xl bg-[#2a2a2a] p-2 text-white backdrop-blur-xl">
                <Dropdown.Menu onAction={handleAccountAction}>
                  <Dropdown.Item id="profiles" textValue="Profiles" className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8 bg-transparent rounded-none">
                        {accountAvatarView.kind === 'image' ? (
                          <Avatar.Image alt={safeDisplayName} src={accountAvatarView.value} className="object-contain" />
                        ) : null}
                        <Avatar.Fallback className="border-none bg-transparent text-sm text-white">
                          {guestInitial}
                        </Avatar.Fallback>
                      </Avatar>
                      <div className="min-w-0 text-left">
                        <div className="truncate text-sm font-semibold">{safeDisplayName}</div>
                        <div className="truncate text-xs text-white/60">{userEmail ?? 'Guest'}</div>
                      </div>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item id="settings" textValue="Settings" className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                    <Label>Settings</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="accounts" textValue="Manage accounts" className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                    <Label>Manage accounts</Label>
                  </Dropdown.Item>
                  <Separator className="my-1 bg-white/10" />
                  <Dropdown.Item id="auth" textValue={isLoggedIn ? 'Logout' : 'Login'} className="rounded-xl hover:bg-white/15 data-[hovered=true]:bg-white/15">
                    <Label className={isLoggedIn ? 'text-red-400' : 'text-sky-400'}>
                      {isLoggedIn ? 'Logout' : 'Sign in'}
                    </Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          )}
        </div>
      </div>
    </div>
  );
}
