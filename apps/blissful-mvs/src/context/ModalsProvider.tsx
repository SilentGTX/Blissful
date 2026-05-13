// Centralised state for AppShell's modal slots. Historically each
// flag (`isLoginOpen`, `isAddAddonOpen`, …) lived as its own
// `useState` inside AppShell, and every consumer that needed to open
// a modal received an `openLogin` / `openAccount` / etc. callback
// threaded through props or the deprecated AppContext facade. That
// pushed AppShell to ~1,200 lines and forced re-renders of every
// consumer whenever any modal opened.
//
// This provider owns the state. Consumers call `useModals()` for the
// piece they care about. Multi-stage modals (Login with forced error
// + prefilled email, Profile prompt with initial name, Add-Addon
// with URL draft) expose their auxiliary state alongside the open
// flag so the open-call can prefill in one shot. The drawer-style
// iOSPlay prompt and the resume / unavailable item slots are
// passed-by-payload (open-with-data) rather than separate flags.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LibraryItem } from '../lib/stremioApi';
import type { WhatToDoPrompt } from '../components/WhatToDoDrawer';

export type ModalsContextValue = {
  // ---- account ----
  isAccountOpen: boolean;
  openAccount: () => void;
  closeAccount: () => void;
  setIsAccountOpen: (open: boolean) => void;

  // ---- login (with optional forced-error + prefilled email) ----
  isLoginOpen: boolean;
  loginForcedError: string | null;
  loginPrefillEmail: string | null;
  openLogin: () => void;
  /** Open the login modal with an injected error message and / or
   * prefilled email — used when an account session expires
   * mid-switch so the user lands on the login form with the right
   * email + a "Your session expired" banner. */
  openLoginWith: (opts: { forcedError?: string | null; prefillEmail?: string | null }) => void;
  closeLogin: () => void;

  // ---- profile prompt (Who's watching? first-time setup) ----
  isProfilePromptOpen: boolean;
  profilePromptInitialName: string;
  openProfilePrompt: (initialName: string) => void;
  closeProfilePrompt: () => void;

  // ---- who's watching (account switcher) ----
  isWhoWatchingOpen: boolean;
  openWhoWatching: () => void;
  closeWhoWatching: () => void;
  setIsWhoWatchingOpen: (open: boolean) => void;

  // ---- add-addon (manifest URL → install) ----
  isAddAddonOpen: boolean;
  addonUrlDraft: string;
  setAddonUrlDraft: (value: string) => void;
  openAddAddon: () => void;
  /** Open the add-addon modal prefilled with a manifest URL (used by
   * the search-submit "looks like a manifest URL" flow). */
  openAddAddonWith: (url: string) => void;
  closeAddAddon: () => void;

  // ---- home-row settings dialog ----
  isHomeSettingsOpen: boolean;
  openHomeSettings: () => void;
  closeHomeSettings: () => void;

  // ---- iOS "what to do?" drawer (open in browser / open in VLC) ----
  iosPlayPrompt: WhatToDoPrompt;
  setIosPlayPrompt: (prompt: WhatToDoPrompt) => void;

  // ---- continue-watching resume/start-over decision ----
  resumeModalItem: LibraryItem | null;
  setResumeModalItem: (item: LibraryItem | null) => void;

  // ---- stream-unavailable fallback prompt ----
  unavailableItem: LibraryItem | null;
  setUnavailableItem: (item: LibraryItem | null) => void;

  // ---- pending-navigation black veil during continue-watching open ----
  pendingContinueItem: LibraryItem | null;
  setPendingContinueItem: (item: LibraryItem | null) => void;
};

export const ModalsContext = createContext<ModalsContextValue | null>(null);

export function useModals(): ModalsContextValue {
  const ctx = useContext(ModalsContext);
  if (!ctx) throw new Error('useModals must be used within a ModalsProvider');
  return ctx;
}

export function ModalsProvider({ children }: { children: ReactNode }) {
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginForcedError, setLoginForcedError] = useState<string | null>(null);
  const [loginPrefillEmail, setLoginPrefillEmail] = useState<string | null>(null);
  const [isProfilePromptOpen, setIsProfilePromptOpen] = useState(false);
  const [profilePromptInitialName, setProfilePromptInitialName] = useState('');
  const [isWhoWatchingOpen, setIsWhoWatchingOpen] = useState(false);
  const [isAddAddonOpen, setIsAddAddonOpen] = useState(false);
  const [addonUrlDraft, setAddonUrlDraft] = useState('');
  const [isHomeSettingsOpen, setIsHomeSettingsOpen] = useState(false);
  const [iosPlayPrompt, setIosPlayPrompt] = useState<WhatToDoPrompt>(null);
  const [resumeModalItem, setResumeModalItem] = useState<LibraryItem | null>(null);
  const [unavailableItem, setUnavailableItem] = useState<LibraryItem | null>(null);
  const [pendingContinueItem, setPendingContinueItem] = useState<LibraryItem | null>(null);

  const openAccount = useCallback(() => setIsAccountOpen(true), []);
  const closeAccount = useCallback(() => setIsAccountOpen(false), []);

  const openLogin = useCallback(() => {
    setLoginForcedError(null);
    setLoginPrefillEmail(null);
    setIsLoginOpen(true);
  }, []);
  const openLoginWith = useCallback<ModalsContextValue['openLoginWith']>((opts) => {
    setLoginForcedError(opts.forcedError ?? null);
    setLoginPrefillEmail(opts.prefillEmail ?? null);
    setIsLoginOpen(true);
  }, []);
  const closeLogin = useCallback(() => {
    setIsLoginOpen(false);
    setLoginForcedError(null);
    setLoginPrefillEmail(null);
  }, []);

  const openProfilePrompt = useCallback((initialName: string) => {
    setProfilePromptInitialName(initialName);
    setIsProfilePromptOpen(true);
  }, []);
  const closeProfilePrompt = useCallback(() => setIsProfilePromptOpen(false), []);

  const openWhoWatching = useCallback(() => {
    // Opening Who's watching from the account modal also closes the
    // account modal — the two render on top of each other otherwise.
    setIsAccountOpen(false);
    setIsWhoWatchingOpen(true);
  }, []);
  const closeWhoWatching = useCallback(() => setIsWhoWatchingOpen(false), []);

  const openAddAddon = useCallback(() => setIsAddAddonOpen(true), []);
  const openAddAddonWith = useCallback((url: string) => {
    setAddonUrlDraft(url);
    setIsAddAddonOpen(true);
  }, []);
  const closeAddAddon = useCallback(() => setIsAddAddonOpen(false), []);

  const openHomeSettings = useCallback(() => setIsHomeSettingsOpen(true), []);
  const closeHomeSettings = useCallback(() => setIsHomeSettingsOpen(false), []);

  const value = useMemo<ModalsContextValue>(
    () => ({
      isAccountOpen,
      openAccount,
      closeAccount,
      setIsAccountOpen,
      isLoginOpen,
      loginForcedError,
      loginPrefillEmail,
      openLogin,
      openLoginWith,
      closeLogin,
      isProfilePromptOpen,
      profilePromptInitialName,
      openProfilePrompt,
      closeProfilePrompt,
      isWhoWatchingOpen,
      openWhoWatching,
      closeWhoWatching,
      setIsWhoWatchingOpen,
      isAddAddonOpen,
      addonUrlDraft,
      setAddonUrlDraft,
      openAddAddon,
      openAddAddonWith,
      closeAddAddon,
      isHomeSettingsOpen,
      openHomeSettings,
      closeHomeSettings,
      iosPlayPrompt,
      setIosPlayPrompt,
      resumeModalItem,
      setResumeModalItem,
      unavailableItem,
      setUnavailableItem,
      pendingContinueItem,
      setPendingContinueItem,
    }),
    [
      isAccountOpen,
      openAccount,
      closeAccount,
      isLoginOpen,
      loginForcedError,
      loginPrefillEmail,
      openLogin,
      openLoginWith,
      closeLogin,
      isProfilePromptOpen,
      profilePromptInitialName,
      openProfilePrompt,
      closeProfilePrompt,
      isWhoWatchingOpen,
      openWhoWatching,
      closeWhoWatching,
      isAddAddonOpen,
      addonUrlDraft,
      openAddAddon,
      openAddAddonWith,
      closeAddAddon,
      isHomeSettingsOpen,
      openHomeSettings,
      closeHomeSettings,
      iosPlayPrompt,
      resumeModalItem,
      unavailableItem,
      pendingContinueItem,
    ],
  );

  return <ModalsContext.Provider value={value}>{children}</ModalsContext.Provider>;
}
