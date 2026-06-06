// Moved to @blissful/core (shared with the RN TV app). Re-exported here so the
// ~17 existing importers (`../lib/blissfulAuthApi`) don't change.
//
// Web override: the storage base is platform-derived (proxy/relative on the
// shells, direct backend in the browser). RN uses the core default (the direct
// production backend). Configured here so it's set whenever any auth/library
// function is first imported.
import { configureCore } from '@blissful/core/adapters';
import { STORAGE_URL } from './storageBaseUrl';

configureCore({ storageBaseUrl: STORAGE_URL });

export * from '@blissful/core/blissfulAuthApi';
