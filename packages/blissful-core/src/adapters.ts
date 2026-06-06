// Platform injection seam.
//
// The same shared logic runs in two very different hosts:
//   - the web/desktop build (Vite, browser/Tauri origin) — addon fetches must
//     go through the same-origin `/addon-proxy` backend to dodge browser CORS;
//   - the React Native TV app (Metro, native) — there is NO CORS, so addon
//     hosts are fetched DIRECTLY.
//
// So the addon-fetch URL resolver is INJECTED. The default is identity (the
// native/RN behavior); the web app overrides it once at startup via
// configureCore() to wrap targets in `/addon-proxy?url=...`.

let _resolveAddonFetchUrl: (targetUrl: string) => string = (t) => t;

/** Resolve an addon-protocol URL to the URL we actually fetch (identity on
 *  native, `/addon-proxy`-wrapped on web). */
export function resolveAddonFetchUrl(targetUrl: string): string {
  return _resolveAddonFetchUrl(targetUrl);
}

export type CoreAdapters = {
  resolveAddonFetchUrl?: (targetUrl: string) => string;
};

/** Call once at app startup to inject platform behavior. Idempotent-friendly:
 *  only provided fields are overridden. */
export function configureCore(adapters: CoreAdapters): void {
  if (adapters.resolveAddonFetchUrl) _resolveAddonFetchUrl = adapters.resolveAddonFetchUrl;
}
