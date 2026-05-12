import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDesktopUpdater } from '../hooks/useDesktopUpdater';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import SideNav from './SideNav';
import WhatToDoDrawer from './WhatToDoDrawer';
import type { WhatToDoPrompt } from './WhatToDoDrawer';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthProvider';
import { useUI } from '../context/UIProvider';
import { useStorage } from '../context/StorageProvider';
import { useAddons } from '../context/AddonsProvider';
import { fetchAddonManifest, fetchCatalog } from '../lib/stremioAddon';
import type { StremioAddonManifest } from '../lib/stremioAddon';
import { desktop, isNativeShell } from '../lib/desktop';
import {
  addonCollectionGet,
  addonCollectionSet,
  datastorePutCollection,
  type StremioApiUser,
} from '../lib/stremioApi';
import type { MediaItem } from '../types/media';
import {
  getHomeRowOptions,
  resolveHomeRowOrder,
  type HomeRowPrefs,
} from '../lib/homeRows';
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
  NETFLIX_BG,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
} from '../layout/app-shell/constants';
import { useContinueWatching } from '../layout/app-shell/hooks/useContinueWatching';
import { useContinueWatchingActions } from '../layout/app-shell/hooks/useContinueWatchingActions';
import { ResumeOrStartOverModal } from './ResumeOrStartOverModal';
import { StreamUnavailableModal } from './StreamUnavailableModal';
import { getResumeSeconds } from '../layout/app-shell/utils';
import { parseEpisodeLabel } from './SideNav/utils';
import { normalizeStremioImage } from '../lib/stremioApi';
import type { LibraryItem } from '../lib/stremioApi';
import { useSearchMenu } from '../layout/app-shell/hooks/useSearchMenu';
import {
  applyGradient,
  extractImdbId,
  isLikelyManifestUrl,
  isPlayableUrl,
  metaToItem,
  normalizePossibleUrl,
  openInVlc,
} from '../layout/app-shell/utils';
import { useErrorToast } from '../lib/useErrorToast';
import { notifySuccess } from '../lib/toastQueues';
import {
  getSavedAccounts,
  updateSavedAccountProfile,
  upsertSavedAccount,
} from '../lib/savedAccounts';

export default function AppShell() {
  const { updateReady, installNow, dismissUpdate } = useDesktopUpdater();
  const isTorrentioAddonUrl = (url: string): boolean => /torrentio\.strem\.fun/i.test(url);

  // ---------- read from providers ------------------------------------------
  const {
    authKey, user, savedAccounts, login, logout,
    switchAccount: providerSwitchAccount, removeAccount: providerRemoveAccount,
    setSavedAccounts,
  } = useAuth();

  const {
    uiStyle, setUiStyle, isDark, setIsDark,
    darkGradientKey, setDarkGradientKey, lightGradientKey, setLightGradientKey,
    homeEditMode, setHomeEditMode, query, setQuery,
  } = useUI();

  const {
    storageState, storageHydrated,
    homeRowPrefs, setHomeRowPrefs,
    playerSettings, savePlayerSettings: rawSavePlayerSettings,
    persistStorageState, userProfile, updateUserProfile,
  } = useStorage();

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

  const {
    addons, addonsLoading, addonsError, setAddonsError,
    installAddon, uninstallAddon,
  } = useAddons();

  // ---------- AppShell-local state (modals, catalog, search, etc.) ---------
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      setIsAccountOpen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);

    // Native desktop shell (Rust or legacy Electron): listen for fullscreen
    // events from the shell — they're authoritative when present, in
    // addition to the browser document.fullscreenElement state.
    const unsubFs = desktop.onFullscreenChanged((fs) => {
      setIsFullscreen(fs);
      setIsAccountOpen(false);
    });
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      unsubFs();
    };
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (isNativeShell()) {
      desktop.toggleFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginForcedError, setLoginForcedError] = useState<string | null>(null);
  const [loginPrefillEmail, setLoginPrefillEmail] = useState<string | null>(null);
  const [isProfilePromptOpen, setIsProfilePromptOpen] = useState(false);
  const [profilePromptInitialName, setProfilePromptInitialName] = useState('');
  const [isWhoWatchingOpen, setIsWhoWatchingOpen] = useState(false);
  const [isAddAddonOpen, setIsAddAddonOpen] = useState(false);
  const [addonUrlDraft, setAddonUrlDraft] = useState('');
  const [continueSyncError, setContinueSyncError] = useState<string | null>(null);
  const [addonsQuery, setAddonsQuery] = useState('');
  const [manifest, setManifest] = useState<StremioAddonManifest | null>(null);
  const [movieItems, setMovieItems] = useState<MediaItem[]>([]);
  const [seriesItems, setSeriesItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isHomeSettingsOpen, setIsHomeSettingsOpen] = useState(false);
  const [iosPlayPrompt, setIosPlayPrompt] = useState<WhatToDoPrompt>(null);
  const [needsProfilePromptCheck, setNeedsProfilePromptCheck] = useState(false);
  const torrentioCloneSyncDoneRef = useRef<Set<string>>(new Set());

  const openWhoWatching = useCallback(() => {
    setIsAccountOpen(false);
    setIsWhoWatchingOpen(true);
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

  useEffect(() => {
    if (!isWhoWatchingOpen) return;
    setIsAccountOpen(false);
  }, [isWhoWatchingOpen]);

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

  // ---------- torrentio clone sync -----------------------------------------
  const TORRENTIO_URLS_KEY = 'blissfulTorrentioUrls';

  const torrentioAddonUrls = useMemo(
    () =>
      Array.from(
        new Set(
          addons
            .map((addon) => addon.transportUrl)
            .filter((transportUrl): transportUrl is string => typeof transportUrl === 'string' && isTorrentioAddonUrl(transportUrl))
        )
      ),
    [addons]
  );

  // Persist Torrentio URLs so guests (no auth) can use them.
  useEffect(() => {
    if (torrentioAddonUrls.length > 0) {
      localStorage.setItem(TORRENTIO_URLS_KEY, JSON.stringify(torrentioAddonUrls));
    }
  }, [torrentioAddonUrls]);

  useEffect(() => {
    if (!authKey) return;
    if (addonsLoading) return;
    if (torrentioAddonUrls.length === 0) return;
    if (savedAccounts.length === 0) return;

    const targetAuthKeys = Array.from(new Set(savedAccounts.map((account) => account.authKey).filter(Boolean)));
    for (const targetAuthKey of targetAuthKeys) {
      const signature = `${targetAuthKey}|${torrentioAddonUrls.join('|')}`;
      if (torrentioCloneSyncDoneRef.current.has(signature)) continue;
      torrentioCloneSyncDoneRef.current.add(signature);

      void (async () => {
        try {
          const existing = await addonCollectionGet({ authKey: targetAuthKey });
          const existingUrls = new Set(existing.map((addon) => addon.transportUrl));
          const missingTorrentio = torrentioAddonUrls.filter((url) => !existingUrls.has(url));
          if (missingTorrentio.length === 0) return;
          const next = [...existing, ...missingTorrentio.map((transportUrl) => ({ transportUrl }))];
          await addonCollectionSet({ authKey: targetAuthKey, addons: next });
        } catch {
          // Ignore per-account sync failures
        }
      })();
    }
  }, [addonsLoading, authKey, savedAccounts, torrentioAddonUrls]);

  // ---------- error toasts -------------------------------------------------
  useErrorToast(error, 'Catalog error');
  useErrorToast(addonsError, 'Addons error');
  useErrorToast(continueSyncError, 'Continue sync error');

  // ---------- continue watching --------------------------------------------
  const { continueWatching, setContinueWatching } = useContinueWatching(authKey);
  const [unavailableItem, setUnavailableItem] = useState<LibraryItem | null>(null);
  const { onOpenContinueItem: navigateContinueItem, onRemoveContinueItem } =
    useContinueWatchingActions({
      authKey,
      navigate,
      setContinueWatching,
      setContinueSyncError,
      setIosPlayPrompt,
      onStreamUnavailable: (item) => setUnavailableItem(item),
    });

  // Modal-gated continue-watching open. Every sidebar click goes through
  // the shared ResumeOrStartOverModal — user picks "Resume hh:mm:ss" or
  // "Start over". Items with no saved progress bypass the modal and open
  // straight to start-over so we don't pop a useless dialog.
  const [resumeModalItem, setResumeModalItem] = useState<LibraryItem | null>(null);
  // Tracks the item whose async load is in flight (HEAD probe + meta
  // fetch). Set when we kick off `navigateContinueItem`, cleared the
  // moment that promise settles. The overlay below renders against it.
  const [pendingContinueItem, setPendingContinueItem] = useState<LibraryItem | null>(null);
  const runContinue = useCallback(
    async (item: LibraryItem, options?: { source?: 'mobile' | 'desktop'; mode?: 'resume' | 'start-over' }) => {
      setPendingContinueItem(item);
      try {
        await navigateContinueItem(item, options);
      } catch {
        // Navigation never throws today, but if it did we'd want the
        // overlay to clear via the safety timeout below rather than
        // here — the route-change effect handles the happy path.
      }
      // Safety net: if for any reason the route doesn't change within
      // 10 s (e.g., the user is already on the target detail page and
      // we re-navigated to the same URL), the route-change effect
      // won't fire and the overlay would get stuck. This clamps it.
      window.setTimeout(() => setPendingContinueItem(null), 10000);
    },
    [navigateContinueItem],
  );

  // Clear the loading veil once the route actually changes — NOT in the
  // navigateContinueItem finally — because that fires the moment
  // `navigate()` returns (synchronous), before React has committed the
  // new route. Clearing too early gives a flash where the old page
  // becomes visible for one paint before the new one mounts. Tying it
  // to pathname change ensures the new route is committed first, then
  // its own overlay (autoplay veil / mpv buffering) takes over before
  // we drop ours.
  const continueOverlayPathRef = useRef(location.pathname);
  useEffect(() => {
    if (continueOverlayPathRef.current !== location.pathname) {
      continueOverlayPathRef.current = location.pathname;
      setPendingContinueItem(null);
    }
  }, [location.pathname]);
  const onOpenContinueItem = useCallback(
    (item: LibraryItem, options?: { source?: 'mobile' | 'desktop' }) => {
      const seconds = getResumeSeconds(item);
      if (!seconds || seconds <= 0) {
        void runContinue(item, { ...options, mode: 'start-over' });
        return;
      }
      setResumeModalItem(item);
    },
    [runContinue],
  );

  // ---------- addon install modal handler ----------------------------------
  const handleInstallAddon = useCallback(async () => {
    if (!authKey) return;
    try {
      const url = new URL(addonUrlDraft.trim());
      await installAddon(url.toString());
      setIsAddAddonOpen(false);
    } catch {
      setAddonsError('Invalid addon URL');
    }
  }, [addonUrlDraft, authKey, installAddon, setAddonsError]);

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
        setAddonUrlDraft(url);
        setIsAddAddonOpen(true);
        return;
      }
      if (isPlayableUrl(url)) {
        navigate(`/player?url=${encodeURIComponent(url)}&title=${encodeURIComponent(url)}`);
        return;
      }
    }

    addToSearchHistory(raw);
    navigate(`/search?search=${encodeURIComponent(raw)}`);
  }, [addToSearchHistory, navigate, query, setIsSearchMenuOpen]);

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
        setSavedAccounts(getSavedAccounts());
      }
      await updateUserProfile(profile);
    },
    [authKey, updateUserProfile, setSavedAccounts]
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
    [setSavedAccounts]
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
      setLoginForcedError('Session expired for this account. Please enter your credentials again.');
      setLoginPrefillEmail(next.email.includes('@') ? next.email : null);
      setIsLoginOpen(true);
    }
  }, [authKey, savedAccounts, providerSwitchAccount, syncSavedAccountProfileFromStorage]);

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

    setProfilePromptInitialName(user.email?.split('@')[0] || '');
    setIsProfilePromptOpen(true);
    setNeedsProfilePromptCheck(false);
  }, [
    authKey,
    handleUpdateUserProfile,
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

  // ---------- catalog fetch ------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchAddonManifest(),
      fetchCatalog({ type: 'movie', id: 'top' }),
      fetchCatalog({ type: 'series', id: 'top' }),
    ])
      .then(([manifest, movies, series]) => {
        if (cancelled) return;
        setManifest(manifest);
        setMovieItems(movies.metas.map((meta) => metaToItem({ ...meta, type: 'movie' })));
        setSeriesItems(series.metas.map((meta) => metaToItem({ ...meta, type: 'series' })));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load catalog';
        setError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- gradient effects ---------------------------------------------
  useEffect(() => {
    if (uiStyle === 'netflix') {
      document.documentElement.style.setProperty('--dynamic-bg', NETFLIX_BG);
      return;
    }
    const key = isDark ? darkGradientKey : lightGradientKey;
    applyGradient(key, isDark);
  }, [darkGradientKey, lightGradientKey, isDark, uiStyle]);

  useEffect(() => {
    if (!document.documentElement.style.getPropertyValue('--dynamic-bg')) {
      if (uiStyle === 'netflix') {
        document.documentElement.style.setProperty('--dynamic-bg', NETFLIX_BG);
        return;
      }
      const key = isDark ? darkGradientKey : lightGradientKey;
      applyGradient(key, isDark);
    }
  }, [darkGradientKey, lightGradientKey, isDark, uiStyle]);

  // ---------- AppContext facade value (deprecated) --------------------------
  const ctxValue = useMemo(
    () => ({
      uiStyle,
      setUiStyle,
      isDark,
      setIsDark,
      darkGradientKey,
      setDarkGradientKey,
      lightGradientKey,
      setLightGradientKey,
      query,
      setQuery,
      movieItems,
      seriesItems,
      loading,
      error,
      manifest,
      authKey,
      user,
      userProfile,
      updateUserProfile: handleUpdateUserProfile,
      continueWatching,
      addons,
      addonsQuery,
      setAddonsQuery,
      addonsLoading,
      addonsError,
      homeRowOptions: getHomeRowOptions(addons),
      homeRowPrefs,
      setHomeRowPrefs,
      saveHomeRowPrefs: async (prefs: HomeRowPrefs) => {
        setHomeRowPrefs(prefs);
        localStorage.setItem(HOME_PREFS_KEY, JSON.stringify(prefs));
        persistStorageState({ homeRowPrefs: prefs });
        if (!authKey) return;
        try {
          await datastorePutCollection<HomeRowPrefs>({
            authKey,
            collection: 'blissful_home',
            items: [{ _id: 'home', data: prefs }],
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : '';
          if (message.toLowerCase().includes('sync disabled')) return;
          throw err;
        }
      },
      homeEditMode,
      setHomeEditMode,
      playerSettings,
      savePlayerSettings: providerSavePlayerSettings,
      openLogin: () => setIsLoginOpen(true),
      openAccount: () => setIsAccountOpen(true),
      openAddAddon: () => setIsAddAddonOpen(true),
      installAddon: async (url: string) => {
        await installAddon(url);
      },
      uninstallAddon: async (url: string) => {
        await uninstallAddon(url);
      },
      savedAccounts,
      switchAccount: handleSwitchAccount,
      removeAccount: providerRemoveAccount,
      updateSavedAccountProfile: (authKeyToUpdate: string, profile: StoredProfile) => {
        updateSavedAccountProfile(authKeyToUpdate, profile);
        setSavedAccounts(getSavedAccounts());
      },
    }),
    [
      uiStyle,
      setUiStyle,
      isDark,
      setIsDark,
      darkGradientKey,
      setDarkGradientKey,
      lightGradientKey,
      setLightGradientKey,
      query,
      movieItems,
      seriesItems,
      loading,
      error,
      manifest,
      authKey,
      user,
      userProfile,
      handleUpdateUserProfile,
      continueWatching,
      addons,
      addonsQuery,
      addonsLoading,
      addonsError,
      persistStorageState,
      installAddon,
      uninstallAddon,
      homeRowPrefs,
      setHomeRowPrefs,
      homeEditMode,
      playerSettings,
      providerSavePlayerSettings,
      savedAccounts,
      handleSwitchAccount,
      providerRemoveAccount,
      setSavedAccounts,
    ]
  );

  const homeSettingsKey = useMemo(
    () => JSON.stringify(resolveHomeRowOrder(getHomeRowOptions(addons), homeRowPrefs)),
    [addons, homeRowPrefs]
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
    <AppContext.Provider value={ctxValue}>
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
                      onOpenLogin={() => setIsLoginOpen(true)}
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
                  onOpenProfiles={openWhoWatching}
                  onLogin={() => setIsLoginOpen(true)}
                  onLogout={handleLogout}
                  onNavigateSettings={() => navigate('/settings')}
                  onOpenHomeSettings={() => setIsHomeSettingsOpen(true)}
                  onNavigateAddons={() => navigate('/addons')}
                  onNavigateAccounts={() => navigate('/accounts')}
                  onToggleFullscreen={handleToggleFullscreen}
                  onNavigateHome={() => navigate('/')}
                  setSearchMenuOpen={setIsSearchMenuOpen}
                  accountAvatar={userProfile.avatar}
                  accountDisplayName={displayName}
                  isWhoWatchingOpen={isWhoWatchingOpen}
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
              onOpenLogin={() => setIsLoginOpen(true)}
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
            onOpenAccount={() => setIsAccountOpen(true)}
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

        {!isWhoWatchingOpen ? (
          <AccountModal
            isOpen={isAccountOpen}
            onOpenChange={setIsAccountOpen}
            user={user}
            displayName={displayName}
            avatar={userProfile.avatar}
            isFullscreen={isFullscreen}
            onLogout={handleLogout}
            onLogin={() => setIsLoginOpen(true)}
            onNavigateSettings={() => navigate('/settings')}
            onOpenHomeSettings={() => setIsHomeSettingsOpen(true)}
            onNavigateAddons={() => navigate('/addons')}
            onNavigateAccounts={() => navigate('/accounts')}
            onOpenProfiles={openWhoWatching}
            onToggleFullscreen={handleToggleFullscreen}
          />
        ) : null}

        <AddAddonModal
          isOpen={isAddAddonOpen}
          onOpenChange={setIsAddAddonOpen}
          addonUrlDraft={addonUrlDraft}
          onAddonUrlDraftChange={setAddonUrlDraft}
          addonsError={addonsError}
          addonsLoading={addonsLoading}
          onInstall={handleInstallAddon}
        />

        <HomeSettingsDialog
          isOpen={isHomeSettingsOpen}
          onOpenChange={setIsHomeSettingsOpen}
          settingsKey={homeSettingsKey}
        />

        <LoginModal
          // We DON'T gate on `!authKey` here — "Add account" flows open
          // the login modal while another session is active, and that
          // gate would prevent the modal from rendering at all.
          // Closing on auth success is handled by:
          //   - explicit `setIsLoginOpen(false)` in onAuthSuccess
          //   - `onOpenChange(false)` after notifySuccess
          //   - LoginModal's own `if (!isOpen) return null` early-return
          isOpen={isLoginOpen}
          onOpenChange={(open) => {
            setIsLoginOpen(open);
            if (!open) {
              setLoginForcedError(null);
              setLoginPrefillEmail(null);
            }
          }}
          forcedErrorMessage={loginForcedError}
          forcedEmail={loginPrefillEmail}
          onAuthSuccess={(nextKey, nextUser) => {
            login(nextKey, nextUser);
            setLoginForcedError(null);
            setLoginPrefillEmail(null);
            // Close the login modal itself — the profile prompt that
            // opens next (via `needsProfilePromptCheck`) was rendering
            // on top of a still-open login modal, so dismissing the
            // profile prompt revealed the login form again.
            setIsLoginOpen(false);
            setNeedsProfilePromptCheck(true);
          }}
        />

        <ProfilePromptModal
          isOpen={isProfilePromptOpen}
          initialName={profilePromptInitialName}
          onSave={async (profile) => {
            // Close the modal optimistically — close first so a slow
            // or failing storage-server save doesn't leave the modal
            // open after the click. Previously `setIsProfilePromptOpen
            // (false)` ran AFTER the await; if `saveStoredState`
            // threw (storage server unreachable), the close line was
            // skipped entirely and Continue appeared to do nothing.
            setIsProfilePromptOpen(false);
            try {
              await handleUpdateUserProfile(profile);
              notifySuccess('Profile updated', `Welcome, ${profile.displayName}.`);
            } catch (err) {
              console.error('[profile] update failed', err);
            }
          }}
        />

        <WhoWatchingModal
          isOpen={isWhoWatchingOpen}
          onOpenChange={setIsWhoWatchingOpen}
          accounts={savedAccounts}
          currentAuthKey={authKey}
          onSwitchAccount={handleSwitchAccount}
          onAddProfile={() => setIsLoginOpen(true)}
          onManageAccounts={() => navigate('/accounts')}
        />

        <WhatToDoDrawer
          isOpen={Boolean(iosPlayPrompt)}
          prompt={iosPlayPrompt}
          onClose={() => setIosPlayPrompt(null)}
          onPlayVlc={(url) => {
            openInVlc(url);
            setIosPlayPrompt(null);
          }}
          onPlayWeb={(playerLink) => {
            navigate(playerLink);
            setIosPlayPrompt(null);
          }}
        />

        <StreamUnavailableModal
          isOpen={unavailableItem !== null}
          title={unavailableItem?.name ?? ''}
          episodeLabel={
            unavailableItem?.type === 'series'
              ? parseEpisodeLabel(
                  (unavailableItem.state as { video_id?: string | null } | undefined)
                    ?.video_id ??
                    unavailableItem.behaviorHints?.defaultVideoId ??
                    null,
                )
              : null
          }
          poster={unavailableItem ? normalizeStremioImage(unavailableItem.poster) ?? null : null}
          onPickAnother={() => {
            if (!unavailableItem) return;
            const videoId =
              (unavailableItem.state as { video_id?: string | null } | undefined)?.video_id ??
              unavailableItem.behaviorHints?.defaultVideoId ??
              null;
            const base = `/detail/${encodeURIComponent(unavailableItem.type)}/${encodeURIComponent(unavailableItem._id)}`;
            navigate(
              unavailableItem.type === 'series' && typeof videoId === 'string'
                ? `${base}?videoId=${encodeURIComponent(videoId)}`
                : base,
            );
          }}
          onClose={() => setUnavailableItem(null)}
        />

        <ResumeOrStartOverModal
          isOpen={resumeModalItem !== null}
          title={resumeModalItem?.name ?? ''}
          episodeLabel={
            resumeModalItem?.type === 'series'
              ? parseEpisodeLabel(
                  (resumeModalItem.state as { video_id?: string | null } | undefined)?.video_id ??
                    resumeModalItem.behaviorHints?.defaultVideoId ??
                    null,
                )
              : null
          }
          poster={resumeModalItem ? normalizeStremioImage(resumeModalItem.poster) ?? null : null}
          resumeSeconds={resumeModalItem ? (getResumeSeconds(resumeModalItem) ?? 0) : 0}
          onResume={() => {
            if (resumeModalItem) {
              const item = resumeModalItem;
              setResumeModalItem(null);
              void runContinue(item, { mode: 'resume' });
            }
          }}
          onStartOver={() => {
            if (resumeModalItem) {
              const item = resumeModalItem;
              setResumeModalItem(null);
              void runContinue(item, { mode: 'start-over' });
            }
          }}
          onClose={() => setResumeModalItem(null)}
        />

        {/* Continue-watching loading veil — identical to DetailPage's
            autoplay short-circuit return: full-screen solid black, the
            movie's pulsing logo (or poster fallback) centered, NO
            backdrop image. Identical look means when the navigation
            chain ends on /detail?autoplay=1 or /player's mpv-buffering
            screen, the visual is one continuous loading state with no
            flash between routes. */}
        {pendingContinueItem ? (
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
      {updateReady && (
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
    </AppContext.Provider>
  );
}
