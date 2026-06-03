// Network base for the same-origin-style backends on Android TV.
//
// On Windows the React UI is served from the shell's own origin
// (http://127.0.0.1:5175), so it fetches RELATIVE paths (`/addon-proxy`,
// `/storage/*`, `/stremio/*`, `/resolve-url`, `/tmdb-season-info`) and the
// shell's ui_server.rs serves them same-origin — no CORS.
//
// On Android the UI runs at http://tauri.localhost, which serves no such
// paths. The Tauri Rust side runs a faithful port of ui_server.rs on a fixed
// loopback port (src-tauri/src/proxy.rs, PROXY_PORT = 11471). So on Android we
// must turn those relative paths into ABSOLUTE URLs pointing at that proxy.
//
// Both origins are cleartext http (the Tauri Android WebView is pinned to the
// http scheme — see the manifest patch), so http://tauri.localhost →
// http://127.0.0.1:11471 is NOT mixed content. The proxy returns permissive
// CORS for these requests.
//
// Usage (Phase 1 wiring — see SPEC.md): prefix the existing relative paths,
// e.g. in stremioAddon.ts `resolveAddonFetchUrl`, storageBaseUrl.ts, and
// deepLinks.ts:
//     fetch(proxyUrl(`/addon-proxy?url=${encodeURIComponent(u)}`))
// On Windows/browser PROXY_BASE === '' so these stay relative and unchanged.

import { isTauri } from './platform';

/** Keep in sync with `PROXY_PORT` in src-tauri/src/proxy.rs. */
export const PROXY_PORT = 11471;

/** '' on desktop/browser (relative paths), the loopback proxy origin on Tauri. */
export const PROXY_BASE = isTauri() ? `http://127.0.0.1:${PROXY_PORT}` : '';

/** Prefix a server-relative path with the proxy origin when on Android. */
export function proxyUrl(path: string): string {
  return `${PROXY_BASE}${path}`;
}
