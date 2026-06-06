// Moved to @blissful/core (shared with the RN TV app). Re-exported here so the
// ~21 existing importers (`../lib/stremioAddon`) don't change.
//
// Web override: addon fetches must go through the same-origin `/addon-proxy`
// backend to dodge browser CORS (RN fetches addon hosts directly, hence the
// core default is identity). Configured here so it's set whenever any
// stremioAddon function is first imported.
import { configureCore } from '@blissful/core/adapters';
import { proxyUrl } from './proxyBase';

configureCore({
  resolveAddonFetchUrl: (targetUrl: string) =>
    proxyUrl(`/addon-proxy?url=${encodeURIComponent(targetUrl)}`),
});

export * from '@blissful/core/stremioAddon';
