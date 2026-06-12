import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toast } from '@heroui/react';
import { errorQueue, notificationQueue, successQueue } from './lib/toastQueues';
import { AuthProvider } from './context/AuthProvider';
import { UIProvider } from './context/UIProvider';
import { ProvidersGlue } from './context/ProvidersGlue';
import { PlayerSeeder } from './context/MiniPlayerProvider';
import { SplashScreen } from './components/SplashScreen';
import AppShell from './components/AppShell';
import LoadingRow from './components/LoadingRow';
import { SkeletonHomeRow, SkeletonDetailPanel, SkeletonSearchGrid } from './components/Skeleton';
import { ErrorBoundary, ErrorPage } from './components/ErrorBoundary';
import HomePage from './pages/HomePage';
import { isNativeShell } from './lib/desktop';
// Phase 0b spike — temporary. Remove with the PlayerSpikePage component
// once the native Rust shell graduates to loading the real player route.
import PlayerSpikePage from './pages/PlayerSpikePage';
// Desktop: eagerly imported — no Suspense boundary needed. The chunk is
// prefetched from DetailPage anyway, and Suspense's reconnect cycle
// in React 19 caused a visible flash on every player open.
import PlayerPage from './pages/PlayerPage';

// Route-level code splitting: lazy-load all pages except HomePage (landing page)
const AddonsPage = lazy(() => import('./pages/AddonsPage'));
const AccountsPage = lazy(() => import('./pages/AccountsPage'));
const DetailPage = lazy(() => import('./pages/DetailPage'));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const VidkingPlayerPage = lazy(() => import('./pages/VidkingPlayerPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const InvitePage = lazy(() => import('./pages/InvitePage'));
const StremioLinkPopupPage = lazy(() => import('./pages/StremioLinkPopupPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Phase 0b spike — top-level, no AppShell wrapper, no providers,
            no splash. Deliberately bare so the Rust shell can verify
            transparent compositing over libmpv. Desktop-only. */}
        <Route path="/player-spike" element={<PlayerSpikePage />} />

        {/* Everything else — the normal app, wrapped in splash + providers. */}
        <Route
          path="/*"
          element={<SplashScreen>
      <Toast.Provider placement="bottom" queue={notificationQueue} />
      <Toast.Provider placement="bottom start" queue={errorQueue} />
      <Toast.Provider placement="bottom end" queue={successQueue} />
      <AuthProvider>
        <UIProvider>
          <ProvidersGlue>
            <Routes>
              {/* Watch-party invite landing — full-bleed, no AppShell.
                  Looks up the room, shows poster/title/episode/host,
                  Continue button is the user gesture that unlocks
                  autoplay before we hand off to /player. */}
              <Route
                path="invite/:code"
                element={
                  <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
                    <InvitePage />
                  </Suspense>
                }
              />
              {/* Stremio account link popup — full-bleed, no AppShell.
                  Opened via window.open() from SettingsStremioPanel; the
                  page POSTs credentials browser-direct to api.strem.io
                  and only sends the resulting authKey to blissful-storage.
                  Path is /link-stremio (NOT /stremio-link) because both
                  Vite dev proxy and Traefik prod catch /stremio* and
                  route to the Stremio website proxy — a /stremio-*
                  path would get forwarded to www.strem.io and 404. */}
              <Route
                path="link-stremio"
                element={
                  <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
                    <StremioLinkPopupPage />
                  </Suspense>
                }
              />
              <Route path="/" element={<AppShell />}>
                <Route index element={<HomePage />} />
                <Route
                  path="discover"
                  element={
                    <Suspense fallback={<div className="space-y-8 p-4"><SkeletonSearchGrid /></div>}>
                      <DiscoverPage />
                    </Suspense>
                  }
                />
                <Route
                  path="discover/:transportUrl/:type/:catalogId"
                  element={
                    <Suspense fallback={<div className="space-y-8 p-4"><SkeletonSearchGrid /></div>}>
                      <DiscoverPage />
                    </Suspense>
                  }
                />
                <Route
                  path="library"
                  element={
                    <Suspense fallback={<div className="space-y-8 p-4"><SkeletonHomeRow /><SkeletonHomeRow /></div>}>
                      <LibraryPage />
                    </Suspense>
                  }
                />
                <Route
                  path="detail/:type/:id"
                  element={
                    <ErrorBoundary fallback={<ErrorPage action="go-back" />}>
                      <Suspense fallback={<SkeletonDetailPanel />}>
                        <DetailPage />
                      </Suspense>
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="vidking/:type/:tmdbId"
                  element={
                    <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
                      <VidkingPlayerPage />
                    </Suspense>
                  }
                />
                <Route
                  path="vidking/:type/:tmdbId/:seasonId/:episodeId"
                  element={
                    <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
                      <VidkingPlayerPage />
                    </Suspense>
                  }
                />
                <Route
                  path="player"
                  element={
                    <ErrorBoundary fallback={<ErrorPage action="go-back" />}>
                      {/* Desktop: the player mounts directly on the route (mpv
                          renders behind the WebView; there is no mini-player).
                          Web: the player is hoisted to AppShell as a single
                          persistent instance (survives navigation for the
                          mini-player) and this route only seeds the active
                          session from the URL. Unifying these is Phase 2 of
                          docs/MONOREPO-MIGRATION-PLAN.md. */}
                      {isNativeShell() ? <PlayerPage /> : <PlayerSeeder />}
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="search"
                  element={
                    <Suspense fallback={<div className="space-y-8 p-4"><SkeletonSearchGrid /></div>}>
                      <SearchPage />
                    </Suspense>
                  }
                />
                <Route
                  path="addons"
                  element={
                    <Suspense fallback={<LoadingRow />}>
                      <AddonsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="accounts"
                  element={
                    <Suspense fallback={<LoadingRow />}>
                      <AccountsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <Suspense fallback={<LoadingRow />}>
                      <SettingsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="profile/:userId"
                  element={
                    <Suspense fallback={<LoadingRow />}>
                      <ProfilePage />
                    </Suspense>
                  }
                />
              </Route>
            </Routes>
          </ProvidersGlue>
        </UIProvider>
      </AuthProvider>
      </SplashScreen>}
        />
      </Routes>
    </BrowserRouter>
  );
}
