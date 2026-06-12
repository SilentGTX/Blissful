// Single source of truth for the blissful-storage base URL. All
// REST + WebSocket clients (auth, state, friends, watch party, user
// socket) should import from here so the dev/prod target stays in
// sync across files.
//
// In the desktop shell the UI is served from a local origin
// (127.0.0.1). Use a same-origin relative base so the shell can proxy
// to the real storage server without CORS.

import { isElectronDesktopApp } from './platform';

// Dev defaults to the PROD backend so a fresh clone gets a working watch party
// from `npm run dev` with zero setup: the dev web tab talks to storage through
// the same-origin Vite proxy → prod (see vite.config.ts), the SAME storage the
// desktop shell always uses, so dev + desktop share a room. Prod storage
// CORS-blocks localhost, hence same-origin rather than a direct absolute URL.
// To run against a LOCAL storage server instead, set VITE_STORAGE_URL /
// VITE_STORAGE_WS_URL (e.g. http://localhost:8787 / ws://localhost:8787).

// Same-origin WS base for the proxy path: ws://localhost:<port>/storage, which
// the dev proxy upgrades to wss://blissful.budinoff.com/storage/*.
function sameOriginStorageWs(): string {
  if (typeof window === 'undefined') return 'wss://blissful.budinoff.com/storage';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/storage`;
}

export const STORAGE_URL =
  import.meta.env.VITE_STORAGE_URL
  ?? (isElectronDesktopApp() || import.meta.env.DEV
    ? '/storage'
    : 'https://blissful.budinoff.com/storage');

// WebSocket URL for direct connections (UserSocket, WatchParty).
// Desktop shell: connect straight to prod (its HTTP proxy can't handle WS
// upgrades). Dev web: same-origin → the Vite proxy upgrades it to prod (matches
// STORAGE_URL above). Prod build: prod. Override with VITE_STORAGE_WS_URL (e.g.
// ws://localhost:8787) to point at a local storage server.
const WS_STORAGE_URL = isElectronDesktopApp()
  ? 'wss://blissful.budinoff.com/storage'
  : import.meta.env.DEV
    ? sameOriginStorageWs()
    : 'wss://blissful.budinoff.com/storage';

export const STORAGE_WS_URL = import.meta.env.VITE_STORAGE_WS_URL ?? WS_STORAGE_URL;
