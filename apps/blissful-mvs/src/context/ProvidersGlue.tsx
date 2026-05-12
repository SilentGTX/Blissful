import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { useUI } from './UIProvider';
import { StorageProvider } from './StorageProvider';
import { AddonsProvider } from './AddonsProvider';
import { useStorage } from './StorageProvider';

// ---------------------------------------------------------------------------
// Inner component that reads StorageProvider to feed AddonsProvider
// ---------------------------------------------------------------------------

function AddonsGlue({ children }: { children: ReactNode }) {
  const { authKey } = useAuth();
  const { storedAddonUrls, persistStorageState } = useStorage();

  return (
    <AddonsProvider
      authKey={authKey}
      storedAddonUrls={storedAddonUrls}
      persistStorageState={persistStorageState}
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
      <AddonsGlue>{children}</AddonsGlue>
    </StorageProvider>
  );
}
