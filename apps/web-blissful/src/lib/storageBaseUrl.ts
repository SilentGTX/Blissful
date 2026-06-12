// Single source of truth for the blissful-storage base URL. All
// REST + WebSocket clients (auth, state, friends, watch party, user
// socket) should import from here so the dev/prod target stays in
// sync across files.
//
// In the desktop shell the UI is served from a local origin
// (127.0.0.1). Use a same-origin relative base so the shell can proxy
// to the real storage server without CORS.

import { isElectronDesktopApp } from './platform';

// Opt-in dev flag (apps/web-blissful/.env.local: VITE_BACKEND_PROD=1): route the
// dev web tab's storage through the same-origin Vite proxy → prod (see
// vite.config.ts). Lets a local UI join a REAL prod watch-party room — the same
// storage the desktop shell always uses — so dev + desktop share a room. Prod
// storage CORS-blocks localhost, hence the same-origin proxy rather than a
// direct absolute URL.
const BACKEND_PROD =
  import.meta.env.VITE_BACKEND_PROD === '1' || import.meta.env.VITE_BACKEND_PROD === 'true';

// Same-origin WS base for the proxy path: ws://localhost:<port>/storage, which
// the dev proxy upgrades to wss://blissful.budinoff.com/storage/*.
function sameOriginStorageWs(): string {
  if (typeof window === 'undefined') return 'wss://blissful.budinoff.com/storage';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/storage`;
}

const DEFAULT_STORAGE_URL = import.meta.env.DEV
  ? 'http://localhost:8787'
  : 'https://blissful.budinoff.com/storage';

export const STORAGE_URL =
  isElectronDesktopApp() || BACKEND_PROD
    ? '/storage'
    : (import.meta.env.VITE_STORAGE_URL ?? DEFAULT_STORAGE_URL);

// WebSocket URL for direct connections (UserSocket, WatchParty).
// The desktop shell's HTTP proxy does not handle WebSocket upgrades,
// so WS connections must go directly to the real storage server
// rather than through the /storage proxy prefix.
// Desktop shell: always connect to production WS (the shell's HTTP
// proxy can't handle WebSocket upgrades). Dev without the shell
// (rare) falls back to localhost:8787.
const WS_STORAGE_URL = isElectronDesktopApp()
  ? 'wss://blissful.budinoff.com/storage'
  : BACKEND_PROD
    ? sameOriginStorageWs()
    : import.meta.env.DEV
      ? 'ws://localhost:8787'
      : 'wss://blissful.budinoff.com/storage';

export const STORAGE_WS_URL = import.meta.env.VITE_STORAGE_WS_URL ?? WS_STORAGE_URL;
