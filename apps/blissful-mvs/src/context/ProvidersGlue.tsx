import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { useUI } from './UIProvider';
import { StorageProvider } from './StorageProvider';
import { AddonsProvider } from './AddonsProvider';
import { useStorage } from './StorageProvider';
import { HomeCatalogProvider } from './HomeCatalogProvider';
import { ModalsProvider } from './ModalsProvider';
import { ContinueWatchingProvider } from './ContinueWatchingProvider';
import { FriendsProvider } from './FriendsProvider';
import { UserSocketProvider } from './UserSocketProvider';
import { ActivePartiesProvider } from './ActivePartiesProvider';
import { PlayerReadyProvider } from './PlayerReadyProvider';

// ---------------------------------------------------------------------------
// Inner component that reads StorageProvider to feed AddonsProvider
// ---------------------------------------------------------------------------

function AddonsGlue({ children }: { children: ReactNode }) {
  const { authKey } = useAuth();
  const { storedAddonUrls, persistStorageState, playerSettings } = useStorage();

  return (
    <AddonsProvider
      authKey={authKey}
      storedAddonUrls={storedAddonUrls}
      persistStorageState={persistStorageState}
      realDebridApiKey={playerSettings.realDebridApiKey || undefined}
    >
      {children}
    </AddonsProvider>
  );
}

// ---------------------------------------------------------------------------
// ProvidersGlue – bridges Auth + UI into Storage + Addons
// ---------------------------------------------------------------------------

export function ProvidersGlue({ children }: { children: ReactNode }) {
  const { authKey, savedAccounts } = useAuth();
  const { isDark, setIsDark, setUiStyle, setDarkGradientKey, setLightGradientKey } = useUI();

  return (
    <StorageProvider
      authKey={authKey}
      savedAccounts={savedAccounts}
      isDark={isDark}
      setIsDark={setIsDark}
      setUiStyle={setUiStyle}
      setDarkGradientKey={setDarkGradientKey}
      setLightGradientKey={setLightGradientKey}
    >
      <AddonsGlue>
        <ModalsProvider>
          <HomeCatalogProvider>
            <ContinueWatchingProvider>
              <UserSocketProvider>
                <ActivePartiesProvider>
                  <FriendsProvider>
                    <PlayerReadyProvider>{children}</PlayerReadyProvider>
                  </FriendsProvider>
                </ActivePartiesProvider>
              </UserSocketProvider>
            </ContinueWatchingProvider>
          </HomeCatalogProvider>
        </ModalsProvider>
      </AddonsGlue>
    </StorageProvider>
  );
}
