import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toast } from '@heroui/react';
import { errorQueue, notificationQueue, successQueue } from './lib/toastQueues';
import { AuthProvider } from './context/AuthProvider';
import { UIProvider } from './context/UIProvider';
import { ProvidersGlue } from './context/ProvidersGlue';
import { SplashScreen } from './components/SplashScreen';
import AppShell from './components/AppShell';
import LoadingRow from './components/LoadingRow';
import { SkeletonHomeRow, SkeletonDetailPanel, SkeletonSearchGrid } from './components/Skeleton';
import { ErrorBoundary, ErrorPage } from './components/ErrorBoundary';
import HomePage from './pages/HomePage';
// Phase 0b spike — temporary. Remove with the PlayerSpikePage component
// once the native Rust shell graduates to loading the real player route.
import PlayerSpikePage from './pages/PlayerSpikePage';

// Route-level code splitting: lazy-load all pages except HomePage (landing page)
const AddonsPage = lazy(() => import('./pages/AddonsPage'));
const AccountsPage = lazy(() => import('./pages/AccountsPage'));
const DetailPage = lazy(() => import('./pages/DetailPage'));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Phase 0b spike — top-level, no AppShell wrapper, no providers,
            no splash. Deliberately bare so the Rust shell can verify
            transparent compositing over libmpv. Remove with the
            PlayerSpikePage component once Phase 1 is underway. */}
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
                  path="player"
                  element={
                    <ErrorBoundary fallback={<ErrorPage action="go-back" />}>
                      {/* Plain black cover instead of <LoadingRow /> —
                          which used to flash a HeroUI Spinner on the
                          first navigation to /player while the lazy
                          chunk loaded. Solid black matches the
                          autoplay overlay coming from DetailPage, so
                          the transition between them is invisible. */}
                      <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
                        <PlayerPage />
                      </Suspense>
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
