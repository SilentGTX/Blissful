import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDesktopUpdater } from '../hooks/useDesktopUpdater';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import SideNav from './SideNav';
import WhatToDoDrawer from './WhatToDoDrawer';
import { useAuth } from '../context/AuthProvider';
import { useUI } from '../context/UIProvider';
import { useStorage } from '../context/StorageProvider';
import { useAddons } from '../context/AddonsProvider';
import { useModals } from '../context/ModalsProvider';
import { useHomeCatalogContext } from '../context/HomeCatalogProvider';
import { useContinueWatchingContext } from '../context/ContinueWatchingProvider';
import { desktop, isNativeShell } from '../lib/desktop';
import type { StremioApiUser } from '../lib/stremioApi';
import { resolveHomeRowOrder } from '../lib/homeRows';
import {
  fetchHomeState,
  fetchStoredState,
  type StoredProfile,
} from '../lib/storageApi';
import {
  applyStreamingServerCacheSize,
  type PlayerSettings,
} from '../lib/playerSettings';
import { TopNav } from '../layout/top-nav/TopNav';
import { NetflixTopBar } from '../layout/netflix/NetflixTopBar';
import { AccountModal } from '../layout/app-shell/components/AccountModal';
import { AddAddonModal } from '../layout/app-shell/components/AddAddonModal';
import { HomeSettingsDialog } from '../layout/app-shell/components/HomeSettingsDialog';
import { LoginModal } from '../layout/app-shell/components/LoginModal';
import { ProfilePromptModal } from '../layout/app-shell/components/ProfilePromptModal';
import { WhoWatchingModal } from '../layout/app-shell/components/WhoWatchingModal';
import {
  HOME_PREFS_KEY,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
} from '../layout/app-shell/constants';
import { ResumeOrStartOverModal } from './ResumeOrStartOverModal';
import { StreamUnavailableModal } from './StreamUnavailableModal';
import { parseEpisodeLabel } from './SideNav/utils';
import { normalizeStremioImage } from '../lib/stremioApi';
import { useSearchMenu } from '../layout/app-shell/hooks/useSearchMenu';
import {
  extractImdbId,
  getResumeSeconds,
  isLikelyManifestUrl,
  isPlayableUrl,
  normalizePossibleUrl,
  openInVlc,
} from '../layout/app-shell/utils';
import { useGradientBackdrop } from '../layout/app-shell/hooks/useGradientBackdrop';
import { useTorrentioCloneSync } from '../layout/app-shell/hooks/useTorrentioCloneSync';
import { useErrorToast } from '../lib/useErrorToast';
import { notifySuccess } from '../lib/toastQueues';
import {
  getSavedAccounts,
  upsertSavedAccount,
} from '../lib/savedAccounts';

export default function AppShell() {
  const { updateReady, isInstalling, installNow, dismissUpdate } = useDesktopUpdater();

  // ---------- read from providers ------------------------------------------
  const {
    authKey, user, savedAccounts, login, logout,
    switchAccount: providerSwitchAccount,
    setSavedAccounts, updateSavedAccountProfile,
  } = useAuth();

  const {
    uiStyle, isDark,
    darkGradientKey, lightGradientKey,
    homeEditMode, setHomeEditMode, query, setQuery,
  } = useUI();

  const {
    storageState, storageHydrated,
    homeRowPrefs, setHomeRowPrefs,
    playerSettings, savePlayerSettings: rawSavePlayerSettings,
    persistStorageState, userProfile, updateUserProfile,
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

  // Wrap savePlayerSettings so changes to the streaming-server cache
  // ceiling are forwarded to the running streaming server via its
  // /settings POST endpoint. Without this the new value is only used on
  // next app launch.
  const providerSavePlayerSettings = useCallback(
    async (next: PlayerSettings) => {
      if (
        next.streamingServerCacheSizeBytes !==
        playerSettings.streamingServerCacheSizeBytes
      ) {
        void applyStreamingServerCacheSize(next.streamingServerCacheSizeBytes);
      }
      return rawSavePlayerSettings(next);
    },
    [playerSettings.streamingServerCacheSizeBytes, rawSavePlayerSettings],
  );

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

    // Native desktop shell (Rust or legacy Electron): listen for fullscreen
    // events from the shell — they're authoritative when present, in
    // addition to the browser document.fullscreenElement state.
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

  // ---------- account sync effects -----------------------------------------
  useEffect(() => {
    if (!authKey || !user) return;
    upsertSavedAccount(authKey, user);
    setSavedAccounts(getSavedAccounts());
    void syncSavedAccountProfileFromStorage(authKey, user);
  }, [authKey, user]);

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
    user?.email?.split('@')[0] ||
    user?.email ||
    user?._id ||
    'Guest';

  // ---------- profile update (wraps provider + syncs saved accounts) -------
  const handleUpdateUserProfile = useCallback(
    async (profile: StoredProfile) => {
      // Save to localStorage savedAccounts FIRST — synchronous, can't
      // fail meaningfully. If the backend storage save below throws
      // (network blip, server 500), we still have the profile locally
      // so the next login picks it up via savedAccounts and skips the
      // "Who's watching?" prompt. Previously the order was reversed,
      // so a backend failure silently dropped the profile entirely.
      if (authKey) {
        updateSavedAccountProfile(authKey, {
          displayName: profile.displayName,
          avatar: profile.avatar,
        });
      }
      await updateUserProfile(profile);
    },
    [authKey, updateUserProfile, updateSavedAccountProfile]
  );

  const syncSavedAccountProfileFromStorage = useCallback(
    async (authKeyToSync: string, fallbackUser: StremioApiUser) => {
      try {
        const remoteState = await fetchStoredState(authKeyToSync);
        const remoteProfile = remoteState?.profile;
        // Only apply remote profile when the local saved account has no
        // displayName yet. This prevents overwriting locally-customised
        // profiles (especially when multiple profiles share the same
        // Stremio userId and therefore the same server-side storage).
        const local = getSavedAccounts().find((a) => a.authKey === authKeyToSync);
        if (!local?.displayName && remoteProfile?.displayName) {
          updateSavedAccountProfile(authKeyToSync, {
            displayName: remoteProfile.displayName,
            avatar: remoteProfile.avatar,
          });
        }
        upsertSavedAccount(authKeyToSync, fallbackUser, {
          displayName: local?.displayName ?? remoteProfile?.displayName,
          avatar: local?.avatar ?? remoteProfile?.avatar,
        });
        setSavedAccounts(getSavedAccounts());
      } catch {
        // ignore sync errors
      }
    },
    [setSavedAccounts, updateSavedAccountProfile]
  );

  // ---------- switch account (wraps provider + handles login modal) --------
  const handleSwitchAccount = useCallback(async (authKeyToUse: string) => {
    const next = savedAccounts.find((item) => item.authKey === authKeyToUse);
    if (!next) return;
    // Short-circuit when the picked account is the one already active —
    // no API round-trip, no provider switch (which would still hit
    // /getUser), just a friendly "welcome back" toast.
    if (authKeyToUse === authKey) {
      const greeting = next.displayName || next.email || 'there';
      notifySuccess('Welcome back', `You're already signed in as ${greeting}.`);
      return;
    }
    try {
      await providerSwitchAccount(authKeyToUse);
      void syncSavedAccountProfileFromStorage(authKeyToUse, { _id: next.userId, email: next.email } as StremioApiUser);
    } catch {
      modals.openLoginWith({
        forcedError: 'Session expired for this account. Please enter your credentials again.',
        prefillEmail: next.email.includes('@') ? next.email : null,
      });
    }
  }, [authKey, savedAccounts, providerSwitchAccount, syncSavedAccountProfileFromStorage, modals]);

  // ---------- profile prompt check -----------------------------------------
  // Only open the "Who's watching?" prompt when the user has NEITHER a
  // saved display name NOR a saved avatar. Either-or-both is enough to
  // skip the prompt — if they have only one of the two, we silently
  // hydrate the missing slot rather than blocking them with a modal.
  useEffect(() => {
    if (!needsProfilePromptCheck) return;
    if (!authKey || !user) return;
    if (!storageHydrated) return;

    const localProfile =
      savedAccounts.find((item) => item.authKey === authKey || item.userId === user._id) ?? null;
    const remoteName = storageState?.profile?.displayName?.trim() ?? '';
    const remoteAvatar = storageState?.profile?.avatar?.trim() ?? '';
    const localName = localProfile?.displayName?.trim() ?? '';
    const localAvatar = localProfile?.avatar?.trim() ?? '';

    const haveAnyName = Boolean(remoteName || localName);
    const haveAnyAvatar = Boolean(remoteAvatar || localAvatar);

    if (haveAnyName || haveAnyAvatar) {
      // Hydrate the best-known profile into the backend if anything
      // local exists that the remote doesn't (so reloads pick it up).
      const mergedName = remoteName || localName || undefined;
      const mergedAvatar = remoteAvatar || localAvatar || undefined;
      if (
        mergedName !== (storageState?.profile?.displayName ?? undefined) ||
        mergedAvatar !== (storageState?.profile?.avatar ?? undefined)
      ) {
        void handleUpdateUserProfile({
          displayName: mergedName,
          avatar: mergedAvatar,
        });
      }
      setNeedsProfilePromptCheck(false);
      return;
    }

    modals.openProfilePrompt(user.email?.split('@')[0] || '');
    setNeedsProfilePromptCheck(false);
  }, [
    authKey,
    handleUpdateUserProfile,
    modals,
    needsProfilePromptCheck,
    savedAccounts,
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
        className={`min-h-screen ${isNetflix ? 'netflix-root' : ''}`}
        style={{ background: 'var(--dynamic-bg)' }}
      >
        {!isFullscreenRoute && !isNetflix ? (
          <>
            <div className="min-h-screen w-full">
              <div className="min-w-0 bliss-shell" style={navSizeStyle}>
                {/* Desktop Sidebar - hidden on mobile */}
                <aside className="bliss-vertical-nav hidden md:block">
                  <div className="h-full">
                    <SideNav
                      active={activeNav}
                      onChange={(next) => navigate(next === 'home' ? '/' : `/${next}`)}
                      onOpenLogin={modals.openLogin}
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
                  userEmail={user?.email ?? null}
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
                  onNavigateAddons={() => navigate('/addons')}
                  onNavigateAccounts={() => navigate('/accounts')}
                  onToggleFullscreen={handleToggleFullscreen}
                  onNavigateHome={() => navigate('/')}
                  setSearchMenuOpen={setIsSearchMenuOpen}
                  accountAvatar={userProfile.avatar}
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
                  <div className="px-4 pb-24 md:px-5 md:pb-0">
                    <Outlet />
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Bottom Navigation */}
            <SideNav
              active={activeNav}
              onChange={(next) => navigate(next === 'home' ? '/' : `/${next}`)}
              onOpenLogin={modals.openLogin}
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
            <Outlet />
          </div>
        ) : isNetflix ? (
          <div className="min-h-screen w-full px-4 pb-24 pt-6 md:px-8 md:pt-8 md:pb-10">
            <Outlet />
          </div>
        ) : null}

        {!modals.isWhoWatchingOpen ? (
          <AccountModal
            isOpen={modals.isAccountOpen}
            onOpenChange={modals.setIsAccountOpen}
            user={user}
            displayName={displayName}
            avatar={userProfile.avatar}
            isFullscreen={isFullscreen}
            onLogout={handleLogout}
            onLogin={modals.openLogin}
            onNavigateSettings={() => navigate('/settings')}
            onOpenHomeSettings={modals.openHomeSettings}
            onNavigateAddons={() => navigate('/addons')}
            onNavigateAccounts={() => navigate('/accounts')}
            onOpenProfiles={modals.openWhoWatching}
            onToggleFullscreen={handleToggleFullscreen}
          />
        ) : null}

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

        <LoginModal
          // We DON'T gate on `!authKey` here — "Add account" flows open
          // the login modal while another session is active, and that
          // gate would prevent the modal from rendering at all.
          // Closing is wired through ModalsProvider.closeLogin which
          // also clears the forced-error/prefill state in one shot.
          isOpen={modals.isLoginOpen}
          onOpenChange={(open) => {
            if (!open) modals.closeLogin();
          }}
          forcedErrorMessage={modals.loginForcedError}
          forcedEmail={modals.loginPrefillEmail}
          onAuthSuccess={(nextKey, nextUser) => {
            login(nextKey, nextUser);
            // Close the login modal itself — the profile prompt that
            // opens next (via `needsProfilePromptCheck`) was rendering
            // on top of a still-open login modal, so dismissing the
            // profile prompt revealed the login form again.
            modals.closeLogin();
            setNeedsProfilePromptCheck(true);
          }}
        />

        <ProfilePromptModal
          isOpen={modals.isProfilePromptOpen}
          initialName={modals.profilePromptInitialName}
          onSave={async (profile) => {
            // Close the modal optimistically — close first so a slow
            // or failing storage-server save doesn't leave the modal
            // open after the click. Previously the close line ran
            // AFTER the await, so a `saveStoredState` failure left
            // the prompt hanging open with no feedback.
            modals.closeProfilePrompt();
            try {
              await handleUpdateUserProfile(profile);
              notifySuccess('Profile updated', `Welcome, ${profile.displayName}.`);
            } catch (err) {
              console.error('[profile] update failed', err);
            }
          }}
        />

        <WhoWatchingModal
          isOpen={modals.isWhoWatchingOpen}
          onOpenChange={modals.setIsWhoWatchingOpen}
          accounts={savedAccounts}
          currentAuthKey={authKey}
          onSwitchAccount={handleSwitchAccount}
          onAddProfile={modals.openLogin}
          onManageAccounts={() => navigate('/accounts')}
        />

        <WhatToDoDrawer
          isOpen={Boolean(modals.iosPlayPrompt)}
          prompt={modals.iosPlayPrompt}
          onClose={() => modals.setIosPlayPrompt(null)}
          onPlayVlc={(url) => {
            openInVlc(url);
            modals.setIosPlayPrompt(null);
          }}
          onPlayWeb={(playerLink) => {
            navigate(playerLink);
            modals.setIosPlayPrompt(null);
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
            chain ends on /detail?autoplay=1 or /player's mpv-buffering
            screen, the visual is one continuous loading state with no
            flash between routes. */}
        {modals.pendingContinueItem ? (
          // Plain black cover. No spinner / pill — the click-to-route
          // delay is short enough that any indicator just flashes
          // briefly and looks worse than nothing. The overlay's only
          // job is to hide the previous page so it doesn't peek
          // through during navigation; the route we're heading to
          // (player's mpv-buffering veil, or /detail's autoplay
          // overlay) renders its own loading state once mounted.
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
