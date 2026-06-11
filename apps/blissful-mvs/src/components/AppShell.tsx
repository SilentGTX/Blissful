import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDesktopUpdater } from '../hooks/useDesktopUpdater';
import { subscribeHeroTransition, getHeroTransition } from '../lib/heroTransition';
import { proxiedImage } from '../lib/imageProxy';

function HeroTransitionOverlay() {
  const [src, setSrc] = useState<string | null>(getHeroTransition());
  const [fading, setFading] = useState(false);
  useEffect(() => {
    return subscribeHeroTransition((newSrc) => {
      if (newSrc) {
        setSrc(newSrc);
        setFading(false);
      } else {
        setFading(true);
        setTimeout(() => setSrc(null), 400);
      }
    });
  }, []);
  if (!src) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <img src={proxiedImage(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  );
}
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { RouteTransition } from './RouteTransition';
import { PlayerBufferingScreen } from './PlayerBufferingScreen';
import SideNav from './SideNav';
import { useAuth } from '../context/AuthProvider';
import { useUI } from '../context/UIProvider';
import { useStorage } from '../context/StorageProvider';
import { useAddons } from '../context/AddonsProvider';
import { useModals } from '../context/ModalsProvider';
import { useHomeCatalogContext } from '../context/HomeCatalogProvider';
import { useContinueWatchingContext } from '../context/ContinueWatchingProvider';
import { usePlayerReady } from '../context/PlayerReadyProvider';
import { PersistentPlayerHost } from './PersistentPlayerHost';
import { desktop, isNativeShell } from '../lib/desktop';
import { resolveHomeRowOrder } from '../lib/homeRows';
import { fetchHomeState } from '../lib/storageApi';
import { applyStreamingServerCacheSize } from '../lib/playerSettings';
import { TopNav } from '../layout/top-nav/TopNav';
import { NetflixTopBar } from '../layout/netflix/NetflixTopBar';
import { AccountModal } from '../layout/app-shell/components/AccountModal';
import { AddAddonModal } from '../layout/app-shell/components/AddAddonModal';
import { LoginModal } from '../layout/app-shell/components/LoginModal';
import { ProfilePromptModal } from '../layout/app-shell/components/ProfilePromptModal';
import { WhoWatchingModal } from '../layout/app-shell/components/WhoWatchingModal';
import { WatchPartyJoinModal } from './WatchParty';
import { HomeSettingsDialog } from '../layout/app-shell/components/HomeSettingsDialog';
import {
  HOME_PREFS_KEY,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
} from '../layout/app-shell/constants';
import { ResumeOrStartOverModal } from './ResumeOrStartOverModal';
import { StreamUnavailableModal } from './StreamUnavailableModal';
import { parseEpisodeLabel } from './SideNav/utils';
import { normalizeStremioImage } from '../lib/mediaTypes';
import { useSearchMenu } from '../layout/app-shell/hooks/useSearchMenu';
import {
  extractImdbId,
  getResumeSeconds,
  isLikelyManifestUrl,
  isPlayableUrl,
  normalizePossibleUrl,
} from '../layout/app-shell/utils';
import { useGradientBackdrop } from '../layout/app-shell/hooks/useGradientBackdrop';
import { useTorrentioCloneSync } from '../layout/app-shell/hooks/useTorrentioCloneSync';
import { useErrorToast } from '../lib/useErrorToast';
import { notifySuccess } from '../lib/toastQueues';
import { usePresenceHeartbeat } from '../lib/usePresenceHeartbeat';
import { PartyInviteListener } from './PartyInviteListener';

const MIGRATION_KEY = 'bliss:migrated:tagOldItemsWeb';

export default function AppShell() {
  // Heartbeat every ~30s while signed in so friends can see online +
  // currently-watching status. Player code calls `setCurrentActivity`
  // to populate the activity payload.
  usePresenceHeartbeat();
  // Desktop auto-updater (inert outside the native shell).
  const { updateReady, isInstalling, installNow, dismissUpdate } = useDesktopUpdater();
  // ---------- read from providers ------------------------------------------
  const { authKey, user, savedAccounts, logout } = useAuth();

  // One-time migration: tag all untagged library items as 'web' so
  // desktop's Continue Watching re-picks a torrent for them instead of
  // trying to replay a non-replayable stream URL.
  useEffect(() => {
    if (!authKey) return;
    if (localStorage.getItem(MIGRATION_KEY)) return;
    void (async () => {
      try {
        const { fetchBlissfulLibrary, putBlissfulLibraryItem } = await import('../lib/blissfulAuthApi');
        const items = await fetchBlissfulLibrary<Record<string, unknown> & { _id: string }>(authKey);
        const untagged = items.filter((it) => !it._blissProgressSource && it.state);
        for (const item of untagged) {
          await putBlissfulLibraryItem(authKey, item._id, { ...item, _blissProgressSource: 'web' });
        }
        localStorage.setItem(MIGRATION_KEY, '1');
      } catch { /* ignore — will retry next launch */ }
    })();
  }, [authKey]);

  const {
    uiStyle, isDark,
    darkGradientKey, lightGradientKey,
    homeEditMode, setHomeEditMode, query, setQuery,
  } = useUI();

  const {
    storageState, storageHydrated,
    homeRowPrefs, setHomeRowPrefs,
    playerSettings,
    persistStorageState, userProfile,
    updateUserProfile,
  } = useStorage();

  const { addons, addonsLoading, addonsError, setAddonsError, installAddon } = useAddons();

  // Catalog feed + home-row settings live in HomeCatalogProvider now;
  // AppShell reads `error` for the toast queue and `homeRowOptions`
  // for the home-settings key signature.
  const { error: catalogError, homeRowOptions } = useHomeCatalogContext();

  // Modal state and continue-watching flow are sourced from their own
  // providers so AppShell stops being a god-object that owns 50+
  // useState calls — the JSX modal mount points further down read
  // directly from these hooks.
  const modals = useModals();
  const {
    continueWatching,
    continueSyncError,
    onOpenContinueItem,
    onRemoveContinueItem,
    runResume,
    runStartOver,
  } = useContinueWatchingContext();

  // BlissfulPlayer flips this to true on mount and false on unmount; we
  // hide the buffering screen as soon as the real player takes over,
  // independent of CSS z-index / stacking-context guessing.
  const { ready: playerReady } = usePlayerReady();

  // On app boot, apply the persisted cache size to the streaming server.
  // The shell-spawned runtime starts with whatever's in server-settings.
  // json on disk (100 GB default); this pushes the user's preference on
  // top of that. Runs once after first hydration.
  const cacheSizeApplied = useRef(false);
  useEffect(() => {
    if (cacheSizeApplied.current) return;
    if (!storageHydrated) return;
    cacheSizeApplied.current = true;
    void applyStreamingServerCacheSize(playerSettings.streamingServerCacheSizeBytes);
  }, [storageHydrated, playerSettings.streamingServerCacheSizeBytes]);

  // Prefetch the lazy web-player chunk as soon as AppShell mounts so the
  // module is already in the browser cache before the user clicks Play —
  // whether they come from /detail or directly from Continue Watching on
  // /home. Without this, the Suspense fallback (transparent) renders for
  // however long the chunk download takes, which reads as a blank "empty
  // page" between the click and the player's `bliss-player-enter`
  // scale-from-center animation. Desktop doesn't need it: its PlayerPage
  // (NativeMpvPlayer) is eagerly bundled on the /player route.
  useEffect(() => {
    if (!isNativeShell()) void import('../pages/PlayerPageWeb');
  }, []);

  // ---------- AppShell-local state (truly layout-scoped only) --------------
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsProfilePromptCheck, setNeedsProfilePromptCheck] = useState(false);

  const closeAccount = modals.closeAccount;
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      closeAccount();
    };
    document.addEventListener('fullscreenchange', onFsChange);

    // Native desktop shell: listen for fullscreen events from the shell —
    // they're authoritative when present, in addition to the browser
    // document.fullscreenElement state.
    const unsubFs = desktop.onFullscreenChanged((fs) => {
      setIsFullscreen(fs);
      closeAccount();
    });
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      unsubFs();
    };
  }, [closeAccount]);

  const handleToggleFullscreen = useCallback(() => {
    if (isNativeShell()) {
      desktop.toggleFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  const location = useLocation();
  const navigate = useNavigate();
  const isFullscreenRoute = location.pathname.startsWith('/detail') || location.pathname.startsWith('/player');
  const isNetflix = uiStyle === 'netflix';
  const isModern = uiStyle === 'modern';

  // Default to expanded sidebar
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    } catch {
      // ignore
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.style.setProperty('--bliss-sidebar-left', '1.25rem');
    document.documentElement.style.setProperty(
      '--bliss-sidebar-width',
      sidebarCollapsed ? '5.5rem' : '20rem'
    );
  }, [sidebarCollapsed]);

  // (The "closeAccount when whoWatching opens" coupling is now handled
  //  inside ModalsProvider's `openWhoWatching` — single call that
  //  closes account + opens who-watching in one shot.)

  const {
    searchMenuRef,
    isSearchMenuOpen,
    setIsSearchMenuOpen,
    isNetflixSearchOpen,
    setIsNetflixSearchOpen,
    searchHistory,
    addToSearchHistory,
    clearSearchHistory,
    searchSuggestions,
    searchResults,
  } = useSearchMenu({ query, setQuery, isNetflix, pathname: location.pathname });

  const handleSelectSearchResult = useCallback((result: { type: string; id: string }) => {
    setIsSearchMenuOpen(false);
    navigate(`/detail/${result.type}/${encodeURIComponent(result.id)}`);
  }, [navigate, setIsSearchMenuOpen]);

  // Track the most recent "safe back" route — anything that isn't a
  // /player or /detail page. DetailPage reads `bliss:safe-back` from
  // sessionStorage when its Back button is pressed, so back from detail
  // never lands on the player (or another detail entry) regardless of
  // how the user reached the page (card click, sidebar continue, auto-
  // fallback chain, etc.). Default to "/" so a fresh app open still has
  // a sensible target.
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/player')) return;
    if (path.startsWith('/detail')) return;
    sessionStorage.setItem('bliss:safe-back', path + location.search);
  }, [location.pathname, location.search]);

  // (Previously fetched /storage/settings here on every /settings page
  // mount to "refresh" the player settings. Removed: useStoredStateSync
  // already loads the canonical state from /storage/state on auth, and
  // that state INCLUDES playerSettings. The dedicated /storage/settings
  // endpoint is a separate read that can race the state load — if it
  // resolves AFTER useStoredStateSync's setPlayerSettings and returns
  // defaults or sparse data, it overwrites the user's actual settings
  // with empties. That's what made the Settings page appear "reset"
  // after every restart.)

  useEffect(() => {
    if (!authKey) return;
    if (location.pathname !== '/') return;

    let cancelled = false;
    fetchHomeState(authKey).then((homeState) => {
      if (cancelled || !homeState) return;
      if (homeState.homeRowPrefs) {
        setHomeRowPrefs(homeState.homeRowPrefs);
        localStorage.setItem(HOME_PREFS_KEY, JSON.stringify(homeState.homeRowPrefs));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authKey, location.pathname, setHomeRowPrefs]);

  useTorrentioCloneSync(authKey, addons, addonsLoading, savedAccounts);

  // ---------- error toasts -------------------------------------------------
  useErrorToast(catalogError, 'Catalog error');
  useErrorToast(addonsError, 'Addons error');
  useErrorToast(continueSyncError, 'Continue sync error');

  // ---------- addon install modal handler ----------------------------------
  const handleInstallAddon = useCallback(async () => {
    if (!authKey) return;
    try {
      const url = new URL(modals.addonUrlDraft.trim());
      await installAddon(url.toString());
      modals.closeAddAddon();
    } catch {
      setAddonsError('Invalid addon URL');
    }
  }, [authKey, installAddon, modals, setAddonsError]);

  // ---------- search submit ------------------------------------------------
  const handleSearchSubmit = useCallback(() => {
    const raw = query.trim();
    if (!raw) return;

    setIsSearchMenuOpen(false);

    if (raw.startsWith('magnet:')) {
      navigate(`/player?url=${encodeURIComponent(raw)}&title=${encodeURIComponent('Magnet link')}`);
      return;
    }

    const imdbId = extractImdbId(raw);
    if (imdbId) {
      navigate(`/detail/movie/${encodeURIComponent(imdbId)}`);
      return;
    }

    const url = normalizePossibleUrl(raw);
    if (url) {
      if (isLikelyManifestUrl(url)) {
        modals.openAddAddonWith(url);
        return;
      }
      if (isPlayableUrl(url)) {
        navigate(`/player?url=${encodeURIComponent(url)}&title=${encodeURIComponent(url)}`);
        return;
      }
    }

    addToSearchHistory(raw);
    navigate(`/search?search=${encodeURIComponent(raw)}`);
  }, [addToSearchHistory, modals, navigate, query, setIsSearchMenuOpen]);

  // ---------- logout handler (delegates to provider) -----------------------
  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  // ---------- display name -------------------------------------------------
  const displayName =
    userProfile.displayName?.trim() ||
    user?.displayName?.trim() ||
    user?.username ||
    user?.email?.split('@')[0] ||
    user?.email ||
    'Guest';

  const accountAvatar = userProfile.avatar || user?.avatar || undefined;

  // ---------- profile prompt check -----------------------------------------
  // Only open the "Who's watching?" prompt when the user has no saved
  // display name AND no saved avatar in remote storage. If either is
  // present we skip the prompt entirely.
  useEffect(() => {
    if (!needsProfilePromptCheck) return;
    if (!authKey || !user) return;
    if (!storageHydrated) return;

    const remoteName = storageState?.profile?.displayName?.trim() ?? '';
    const remoteAvatar = storageState?.profile?.avatar?.trim() ?? '';

    if (remoteName || remoteAvatar) {
      setNeedsProfilePromptCheck(false);
      return;
    }

    modals.openProfilePrompt(user.username || user.email?.split('@')[0] || '');
    setNeedsProfilePromptCheck(false);
  }, [
    authKey,
    modals,
    needsProfilePromptCheck,
    storageHydrated,
    storageState?.profile?.displayName,
    storageState?.profile?.avatar,
    user,
  ]);

  // ---------- uiStyle persistence ------------------------------------------
  useEffect(() => {
    persistStorageState({ uiStyle });
  }, [persistStorageState, uiStyle]);

  // ---------- active nav ---------------------------------------------------
  const activeNav = useMemo(() => {
    if (location.pathname.startsWith('/discover')) return 'discover';
    if (location.pathname.startsWith('/library')) return 'library';
    if (location.pathname.startsWith('/addons')) return 'addons';
    if (location.pathname.startsWith('/settings')) return 'settings';
    return 'home';
  }, [location.pathname]);

  useGradientBackdrop(uiStyle, isDark, darkGradientKey, lightGradientKey);

  const homeSettingsKey = useMemo(
    () => JSON.stringify(resolveHomeRowOrder(homeRowOptions, homeRowPrefs)),
    [homeRowOptions, homeRowPrefs]
  );

  const navSizeStyle = {
    '--horizontal-nav-bar-size': '72px',
    '--vertical-nav-bar-size': sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH,
  } as React.CSSProperties;

  const netflixNavItems = useMemo(
    () => [
      { key: 'home', label: 'Home', onClick: () => navigate('/') },
      {
        key: 'shows',
        label: 'Shows',
        onClick: () =>
          navigate(
            '/discover/' + encodeURIComponent('https://v3-cinemeta.strem.io') + '/series/top'
          ),
      },
      {
        key: 'movies',
        label: 'Movies',
        onClick: () =>
          navigate(
            '/discover/' + encodeURIComponent('https://v3-cinemeta.strem.io') + '/movie/top'
          ),
      },
      {
        key: 'anime',
        label: 'Anime',
        onClick: () =>
          navigate(
            '/discover/' +
            encodeURIComponent('https://v3-cinemeta.strem.io') +
            '/series/top?genre=Anime'
          ),
      },
      { key: 'my', label: 'My Kecflix', onClick: () => navigate('/library') },
    ],
    [navigate]
  );

  return (
    <>
      <div
        className={`min-h-dvh ${isNetflix ? 'netflix-root' : ''}`}
        style={{ background: 'var(--dynamic-bg)' }}
      >
        {!isFullscreenRoute && !isNetflix && !isModern ? (
          <>
            <div className="min-h-dvh w-full">
              <div className="min-w-0 bliss-shell" style={navSizeStyle}>
                {/* Desktop Sidebar - hidden on mobile. Also hidden
                    when viewport height drops below 370px (no room
                    for sidebar content at all) — the mobile bottom-
                    nav below takes over via its own matching media
                    query. */}
                <aside className="bliss-vertical-nav hidden md:block [@media(max-height:370px)]:!hidden">
                  <div className="h-full">
                    <SideNav
                      active={activeNav}
                      onChange={(next) => navigate(next === 'home' ? '/' : `/${next}`)}
                      onOpenLogin={modals.openLogin}
                      onOpenJoinParty={modals.openJoinParty}
                      onLogout={handleLogout}
                      userLabel={displayName}
                      continueWatching={continueWatching}
                      continueSyncError={continueSyncError}
                      collapsed={sidebarCollapsed}
                      onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
                      onOpenContinueItem={onOpenContinueItem}
                      onRemoveContinueItem={onRemoveContinueItem}
                      isMobile={false}
                    />
                  </div>
                </aside>

                <TopNav
                  userHandle={user?.username ?? user?.email ?? null}
                  isLoggedIn={Boolean(user)}
                  query={query}
                  isSearchMenuOpen={isSearchMenuOpen}
                  searchHistory={searchHistory}
                  searchSuggestions={searchSuggestions}
                  searchResults={searchResults}
                  onSelectResult={handleSelectSearchResult}
                  searchMenuRef={searchMenuRef}
                  onQueryChange={(value) => {
                    setQuery(value);
                    setIsSearchMenuOpen(true);
                  }}
                  onSubmit={handleSearchSubmit}
                  onClearQuery={() => {
                    setQuery('');
                    setIsSearchMenuOpen(true);
                    navigate('/search');
                  }}
                  onSelectQuery={(value) => {
                    addToSearchHistory(value);
                    setQuery(value);
                    setIsSearchMenuOpen(false);
                    navigate(`/search?search=${encodeURIComponent(value)}`);
                  }}
                  onClearHistory={clearSearchHistory}
                  onToggleHomeEdit={() => setHomeEditMode(!homeEditMode)}
                  isHomeRoute={location.pathname === '/'}
                  onOpenProfiles={modals.openWhoWatching}
                  onLogin={modals.openLogin}
                  onLogout={handleLogout}
                  onNavigateSettings={() => navigate('/settings')}
                  onOpenHomeSettings={modals.openHomeSettings}
                  onToggleFullscreen={handleToggleFullscreen}
                  onNavigateHome={() => navigate('/')}
                  setSearchMenuOpen={setIsSearchMenuOpen}
                  accountAvatar={accountAvatar}
                  accountDisplayName={displayName}
                  isWhoWatchingOpen={modals.isWhoWatchingOpen}
                />

                {isSearchMenuOpen ? (
                  <div
                    className="fixed inset-0 z-30 bg-black/40 backdrop-blur"
                    onClick={() => setIsSearchMenuOpen(false)}
                    aria-hidden="true"
                  />
                ) : null}

                <div className="bliss-content">
                  {/* `pb-24` on the mobile path (and re-applied at
                      short viewport heights via the !important
                      override) clears the fixed bottom-nav so the
                      last row of content isn't hidden underneath. */}
                  <div className="px-4 pb-24 md:px-5 md:pb-0 [@media(max-height:370px)]:!pb-24">
                    <RouteTransition>
                      <Outlet />
                    </RouteTransition>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Bottom Navigation */}
            <SideNav
              active={activeNav}
              onChange={(next) => navigate(next === 'home' ? '/' : `/${next}`)}
              onOpenLogin={modals.openLogin}
              onOpenJoinParty={modals.openJoinParty}
              onLogout={handleLogout}
              userLabel={displayName}
              continueWatching={continueWatching}
              continueSyncError={continueSyncError}
              collapsed={true}
              onToggleCollapsed={() => { }}
               onOpenContinueItem={onOpenContinueItem}
               onRemoveContinueItem={onRemoveContinueItem}
              isMobile={true}
            />
          </>
        ) : null}

        {!isFullscreenRoute && isNetflix ? (
          <NetflixTopBar
            query={query}
            isSearchMenuOpen={isSearchMenuOpen}
            isNetflixSearchOpen={isNetflixSearchOpen}
            searchHistory={searchHistory}
            searchSuggestions={searchSuggestions}
            searchResults={searchResults}
            onSelectResult={handleSelectSearchResult}
            activeNav={activeNav}
            navItems={netflixNavItems}
            searchMenuRef={searchMenuRef}
            onQueryChange={(value) => {
              setQuery(value);
              setIsSearchMenuOpen(true);
            }}
            onSubmit={handleSearchSubmit}
            onToggleSearch={() => {
              const next = !isNetflixSearchOpen;
              setIsNetflixSearchOpen(next);
              setIsSearchMenuOpen(next);
            }}
            onSelectQuery={(value) => {
              addToSearchHistory(value);
              setQuery(value);
              setIsSearchMenuOpen(false);
              navigate(`/search?search=${encodeURIComponent(value)}`);
            }}
            onClearHistory={clearSearchHistory}
            onOpenAccount={modals.openAccount}
          />
        ) : null}

        {!isFullscreenRoute && isNetflix && isSearchMenuOpen ? (
          <div
            className="fixed inset-0 z-20 bg-black/40"
            onClick={() => setIsSearchMenuOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        {isFullscreenRoute ? (
          <div className="min-h-screen w-full">
            {/* Both /detail and /player live in the fullscreen branch, so
                this RouteTransition coordinates the transition between
                them via AnimatePresence (player → detail back-nav, and
                detail → player on Play). Without it the route just swaps
                instantly with no fade. */}
            <RouteTransition>
              <Outlet />
            </RouteTransition>
          </div>
        ) : isNetflix ? (
          <div className="min-h-screen w-full px-4 pb-24 pt-6 md:px-8 md:pt-8 md:pb-10">
            <RouteTransition>
              <Outlet />
            </RouteTransition>
          </div>
        ) : isModern ? (
          <div className="h-screen w-full flex overflow-hidden" style={{ background: 'rgb(18 24 30)' }}>
            <nav className="hidden md:flex flex-col w-52 shrink-0 border-r border-white/15 px-6 pt-8 pb-8">
              <button
                className="text-left text-base text-white font-medium mb-10 hover:text-white/60 transition"
                onClick={() => navigate('/search')}
              >
                Search
              </button>
              {[
                { label: 'Home', path: '/' },
                { label: 'Discover', path: '/discover' },
                { label: 'Library', path: '/library' },
                { label: 'Settings', path: '/settings' },
              ].map(({ label, path }) => (
                <button
                  key={label}
                  className="text-left text-[15px] text-white font-normal py-2.5 hover:text-white/60 transition"
                  onClick={() => navigate(path)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="flex-1 min-w-0 h-screen overflow-hidden">
              <RouteTransition>
                <Outlet />
              </RouteTransition>
            </div>
          </div>
        ) : null}

        {/* Persistent buffering screen for /player — rendered at the
            AppShell level so it stays mounted across (a) the lazy
            chunk download, (b) the Suspense fallback → PlayerPage
            handoff, and (c) the TMDB lookup. Hidden as soon as
            BlissfulPlayer mounts via `playerReady` from the context —
            this avoids relying on CSS z-index winning across
            Framer Motion's stacking contexts. */}
        {location.pathname.startsWith('/player') && !playerReady ? <PlayerBufferingScreen /> : null}

        <HeroTransitionOverlay />

        {/* Persistent player — hoisted out of the /player route so it keeps
            playing across navigation. Full-screen on /player; a real
            Document-PiP OS window (or in-page floating window as fallback)
            everywhere else. Owns the stable mount node so the <video> never
            remounts across the transitions.
            WEB ONLY: on desktop the /player route mounts NativeMpvPlayer
            directly (mpv renders behind the WebView; no mini-player).
            Unifying the two is Phase 2 of docs/MONOREPO-MIGRATION-PLAN.md. */}
        {!isNativeShell() ? <PersistentPlayerHost /> : null}

        {!modals.isWhoWatchingOpen ? (
          <AccountModal
            isOpen={modals.isAccountOpen}
            onOpenChange={modals.setIsAccountOpen}
            user={user}
            displayName={displayName}
            avatar={accountAvatar}
            isFullscreen={isFullscreen}
            onLogout={handleLogout}
            onLogin={modals.openLogin}
            onNavigateSettings={() => navigate('/settings')}
            onOpenHomeSettings={modals.openHomeSettings}
            onOpenProfiles={modals.openWhoWatching}
            onToggleFullscreen={handleToggleFullscreen}
          />
        ) : null}

        <LoginModal />
        <PartyInviteListener />

        <AddAddonModal
          isOpen={modals.isAddAddonOpen}
          onOpenChange={(open) => (open ? modals.openAddAddon() : modals.closeAddAddon())}
          addonUrlDraft={modals.addonUrlDraft}
          onAddonUrlDraftChange={modals.setAddonUrlDraft}
          addonsError={addonsError}
          addonsLoading={addonsLoading}
          onInstall={handleInstallAddon}
        />

        <HomeSettingsDialog
          isOpen={modals.isHomeSettingsOpen}
          onOpenChange={(open) => (open ? modals.openHomeSettings() : modals.closeHomeSettings())}
          settingsKey={homeSettingsKey}
        />

        <WatchPartyJoinModal
          isOpen={modals.isJoinPartyOpen}
          onOpenChange={(open) => (open ? modals.openJoinParty() : modals.closeJoinParty())}
        />

        <ProfilePromptModal
          isOpen={modals.isProfilePromptOpen}
          initialName={modals.profilePromptInitialName}
          onSave={async (profile) => {
            // Close the modal optimistically — close first so a slow
            // or failing storage-server save doesn't leave the modal
            // open after the click.
            modals.closeProfilePrompt();
            try {
              await updateUserProfile(profile);
              notifySuccess('Profile updated', `Welcome, ${profile.displayName}.`);
            } catch (err) {
              console.error('[profile] update failed', err);
            }
          }}
          onCancel={() => modals.closeProfilePrompt()}
        />

        <WhoWatchingModal
          isOpen={modals.isWhoWatchingOpen}
          onOpenChange={(open) => (open ? modals.openWhoWatching() : modals.closeWhoWatching())}
          profileDisplayName={userProfile.displayName ?? null}
          profileAvatar={userProfile.avatar ?? null}
          onEditProfile={() => modals.openProfilePrompt(userProfile.displayName ?? user?.displayName ?? '')}
          onSignOut={() => {
            logout();
          }}
        />


        <StreamUnavailableModal
          isOpen={modals.unavailableItem !== null}
          title={modals.unavailableItem?.name ?? ''}
          episodeLabel={
            modals.unavailableItem?.type === 'series'
              ? parseEpisodeLabel(
                  (modals.unavailableItem.state as { video_id?: string | null } | undefined)
                    ?.video_id ??
                    modals.unavailableItem.behaviorHints?.defaultVideoId ??
                    null,
                )
              : null
          }
          poster={modals.unavailableItem ? normalizeStremioImage(modals.unavailableItem.poster) ?? null : null}
          onPickAnother={() => {
            const item = modals.unavailableItem;
            if (!item) return;
            const videoId =
              (item.state as { video_id?: string | null } | undefined)?.video_id ??
              item.behaviorHints?.defaultVideoId ??
              null;
            const base = `/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item._id)}`;
            navigate(
              item.type === 'series' && typeof videoId === 'string'
                ? `${base}?videoId=${encodeURIComponent(videoId)}`
                : base,
            );
          }}
          onClose={() => modals.setUnavailableItem(null)}
        />

        <ResumeOrStartOverModal
          isOpen={modals.resumeModalItem !== null}
          title={modals.resumeModalItem?.name ?? ''}
          episodeLabel={
            modals.resumeModalItem?.type === 'series'
              ? parseEpisodeLabel(
                  (modals.resumeModalItem.state as { video_id?: string | null } | undefined)?.video_id ??
                    modals.resumeModalItem.behaviorHints?.defaultVideoId ??
                    null,
                )
              : null
          }
          poster={modals.resumeModalItem ? normalizeStremioImage(modals.resumeModalItem.poster) ?? null : null}
          resumeSeconds={modals.resumeModalItem ? (getResumeSeconds(modals.resumeModalItem) ?? 0) : 0}
          onResume={() => {
            if (modals.resumeModalItem) runResume(modals.resumeModalItem);
          }}
          onStartOver={() => {
            if (modals.resumeModalItem) runStartOver(modals.resumeModalItem);
          }}
          onClose={() => modals.setResumeModalItem(null)}
        />

        {/* Continue-watching loading veil — identical to DetailPage's
            autoplay short-circuit return: full-screen solid black, the
            movie's pulsing logo (or poster fallback) centered, NO
            backdrop image. Identical look means when the navigation
            chain ends on /detail?autoplay=1 or /player's buffering
            screen, the visual is one continuous loading state with no
            flash between routes. */}
        {modals.pendingContinueItem ? (
          // Plain black cover. No spinner / pill — the click-to-route
          // delay is short enough that any indicator just flashes
          // briefly and looks worse than nothing. The overlay's only
          // job is to hide the previous page so it doesn't peek
          // through during navigation; the route we're heading to
          // (player's buffering veil, or /detail's autoplay overlay)
          // renders its own loading state once mounted.
          <div className="fixed inset-0 z-[9998] bg-black" />
        ) : null}
      </div>

      {/* Desktop auto-update toast */}
      {updateReady && !isInstalling && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/15 px-5 py-3 shadow-2xl">
          <span className="text-sm text-white/90">New update ready. Restart now?</span>
          <button
            onClick={installNow}
            className="rounded-xl bg-[#19f7d2] px-4 py-1.5 text-sm font-semibold text-black hover:bg-[#19f7d2]/80 transition-colors"
          >
            Update & Restart
          </button>
          <button
            onClick={dismissUpdate}
            className="rounded-xl bg-white/10 px-4 py-1.5 text-sm text-white/70 hover:bg-white/20 transition-colors"
          >
            Later
          </button>
        </div>
      )}

      {/* Installing-update full-screen overlay. Shown after the user
          clicks "Update & Restart" and held for the brief moment
          before the shell quits + the installer takes over. Without
          this, the click looks like "app suddenly closed for no
          reason". */}
      {isInstalling && (
        <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/85 backdrop-blur-xl">
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/15 bg-white/5 px-10 py-8 shadow-2xl">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-[#19f7d2]" />
            <div className="text-center">
              <div className="text-base font-semibold text-white">Installing update</div>
              <div className="mt-1 text-sm text-white/60">
                Blissful will relaunch when it's done.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
