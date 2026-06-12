import { useSyncExternalStore } from 'react';

// Whether the global Login / Create-account modal is open. A single <LoginModal>
// rendered at the app root (App.tsx) listens to this; every "Login" entry point
// (the home avatar, the TopBar avatar, the NavRail friends prompt, the Library
// empty state) just calls openLogin() instead of navigating to a separate page.
// Modelled on railStore — a tiny external store so any component can trigger it
// without threading a callback through the navigator.
let loginOpen = false;
const listeners = new Set<() => void>();

export function openLogin(): void {
  if (loginOpen) return;
  loginOpen = true;
  listeners.forEach((l) => l());
}

export function closeLogin(): void {
  if (!loginOpen) return;
  loginOpen = false;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): boolean {
  return loginOpen;
}

export function useLoginOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
