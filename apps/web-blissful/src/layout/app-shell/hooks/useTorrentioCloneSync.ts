// "Torrentio clone" sync. The user installs the Torrentio addon on one
// account; this hook walks every other saved account and silently
// installs the same Torrentio URLs on each of them, so quick-switching
// between profiles doesn't lose the most common streaming addon.
//
// The list is also written to localStorage under
// `blissfulTorrentioUrls` so guest sessions (no auth) still have it.
//
// Lived as a 40-line block inside AppShell with a module-local
// `done-ref` to dedupe per-account work. Extracting it lets AppShell
// stop carrying the ref + the memo + the loop.

import { useEffect, useMemo, useRef } from 'react';
import {
  addonCollectionGet,
  addonCollectionSet,
  type AddonDescriptor,
} from '../../../lib/stremioApi';
import type { SavedAccount } from '../../../lib/savedAccounts';

const TORRENTIO_URLS_KEY = 'blissfulTorrentioUrls';
const TORRENTIO_RE = /torrentio\.strem\.fun/i;

export function useTorrentioCloneSync(
  authKey: string | null,
  addons: AddonDescriptor[],
  addonsLoading: boolean,
  savedAccounts: SavedAccount[],
) {
  const torrentioAddonUrls = useMemo(
    () =>
      Array.from(
        new Set(
          addons
            .map((addon) => addon.transportUrl)
            .filter(
              (transportUrl): transportUrl is string =>
                typeof transportUrl === 'string' && TORRENTIO_RE.test(transportUrl),
            ),
        ),
      ),
    [addons],
  );

  useEffect(() => {
    if (torrentioAddonUrls.length > 0) {
      localStorage.setItem(TORRENTIO_URLS_KEY, JSON.stringify(torrentioAddonUrls));
    }
  }, [torrentioAddonUrls]);

  const doneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!authKey) return;
    if (addonsLoading) return;
    if (torrentioAddonUrls.length === 0) return;
    if (savedAccounts.length === 0) return;

    const targetAuthKeys = Array.from(
      new Set(savedAccounts.map((account) => account.authKey).filter(Boolean)),
    );
    for (const targetAuthKey of targetAuthKeys) {
      const signature = `${targetAuthKey}|${torrentioAddonUrls.join('|')}`;
      if (doneRef.current.has(signature)) continue;
      doneRef.current.add(signature);

      void (async () => {
        try {
          const existing = await addonCollectionGet({ authKey: targetAuthKey });
          const existingUrls = new Set(existing.map((addon) => addon.transportUrl));
          const missing = torrentioAddonUrls.filter((url) => !existingUrls.has(url));
          if (missing.length === 0) return;
          const next = [...existing, ...missing.map((transportUrl) => ({ transportUrl }))];
          await addonCollectionSet({ authKey: targetAuthKey, addons: next });
        } catch {
          // Per-account sync is best-effort; failures are not surfaced
          // because nothing the user can do about a single account
          // silently lagging on its Torrentio install.
        }
      })();
    }
  }, [addonsLoading, authKey, savedAccounts, torrentioAddonUrls]);
}
