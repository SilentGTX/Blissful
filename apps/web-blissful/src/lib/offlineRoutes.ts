// Which routes work with no connection.
//
// Everything else in the app is a view onto something remote — catalogs, addon
// streams, the library, friends, search — so offline it can only render dead
// spinners. The app therefore collapses to this allowlist while offline (see
// AppShell) instead of trying to make every screen degrade gracefully.

/** Downloads list + the player (which plays from IndexedDB) + the device probe.
 *  Settings is included because it's entirely local state and it's where a
 *  stranded user would look to change subtitle size or clear space. */
const OFFLINE_SAFE_PREFIXES = ['/downloads', '/player', '/offline-check', '/settings'];

export function isOfflineSafeRoute(pathname: string): boolean {
  return OFFLINE_SAFE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** Nav destinations that need the network — dimmed and inert while offline so a
 *  tap doesn't bounce the user through a redirect. */
export function isOnlineOnlyNav(view: string): boolean {
  return view !== 'downloads' && view !== 'settings';
}
