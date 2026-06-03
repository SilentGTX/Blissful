// Single source of truth for the blissful-storage base URL. All
// REST + WebSocket clients (auth, state, friends, watch party, user
// socket) should import from here so the dev/prod target stays in
// sync across files.
//
// In the desktop shell the UI is served from a local origin
// (127.0.0.1). Use a same-origin relative base so the shell can proxy
// to the real storage server without CORS.

import { isElectronDesktopApp, isTauri, isTvMode } from './platform';
import { PROXY_BASE } from './proxyBase';

const DEFAULT_STORAGE_URL = import.meta.env.DEV
  ? 'http://localhost:8787'
  : 'https://blissful.budinoff.com/storage';

// On Android (Tauri) the page origin is http://tauri.localhost, which serves no
// /storage path. Point at the localhost Rust proxy (proxy.rs) instead — it
// forwards to blissful.budinoff.com/storage with the auth headers. In the
// BROWSER TV test (?tv=1, no Tauri) we use the relative '/storage', which the
// Vite dev server proxies to https://blissful.budinoff.com (see vite.config) —
// so login/friends/etc. hit the REAL backend, not a local server.
export const STORAGE_URL = isTauri()
  ? `${PROXY_BASE}/storage`
  : isElectronDesktopApp() || isTvMode()
    ? '/storage'
    : (import.meta.env.VITE_STORAGE_URL ?? DEFAULT_STORAGE_URL);

// WebSocket URL for direct connections (UserSocket, WatchParty).
// The desktop shell's HTTP proxy does not handle WebSocket upgrades,
// so WS connections must go directly to the real storage server
// rather than through the /storage proxy prefix.
// Desktop shell: always connect to production WS (the shell's HTTP
// proxy can't handle WebSocket upgrades). Dev without the shell
// (rare) falls back to localhost:8787.
const WS_STORAGE_URL = isElectronDesktopApp() || isTvMode()
  ? 'wss://blissful.budinoff.com/storage'
  : import.meta.env.DEV
    ? 'ws://localhost:8787'
    : 'wss://blissful.budinoff.com/storage';

export const STORAGE_WS_URL = import.meta.env.VITE_STORAGE_WS_URL ?? WS_STORAGE_URL;
