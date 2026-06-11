// Installed catalog addons (e.g. Anime Kitsu) → one home row each. Ported from the
// web's features/home/hooks/useAddonRows.ts. For each installed addon we hydrate its
// manifest (5-min cached in core), take its FIRST catalog with a type+id, fetch
// /catalog/{type}/{id}.json and map the metas to home tiles.
//
// Two RN differences from the web:
//   - addon hosts are fetched DIRECTLY (no /addon-proxy — there's no CORS on native;
//     core's resolveAddonFetchUrl default is identity).
//   - Cinemeta is excluded: its `top` catalogs already ARE the Popular Movies/Series
//     rows, so including it would render a duplicate "Cinemeta - Popular" row.
//
// LATENCY: a cold mount is three serial network hops (/state addon list → addon
// /manifest.json → addon /catalog/...), and the public Kitsu addon alone can take
// seconds. So the hook is STALE-WHILE-REVALIDATE: the last good addons+rows
// snapshot is kept in MMKV and painted synchronously on mount (kv reads are sync),
// then the network pass refreshes row-by-row underneath. A down addon keeps its
// cached row; an offline pass never wipes a good cache.
import { useEffect, useState } from 'react';
import { fetchAddonManifest, fetchCatalog, type AddonDescriptor, type MediaType } from '@blissful/core';
import { kv } from '../../lib/storage';
import { loadInstalledAddonUrls } from '../../lib/addons';
import { buildAddonRowId } from '../../lib/homeRows';
import { metaToHomeItem, type HomeItem } from './homeData';

const CINEMETA_RE = /v3-cinemeta\.strem\.io/i;
const MAX_ROW_ITEMS = 24; // matches the Popular rows' cap

// A fetched addon row. `type`/`catalogId`/`transportUrl` are carried for parity with
// the web (it uses them for "See all" → Discover); kept here so a future Discover
// deep-link can reuse them.
export type AddonRowData = {
  title: string;
  items: HomeItem[];
  type: MediaType;
  catalogId: string;
  transportUrl: string;
};

/** transport URL → base (no trailing /manifest.json). */
function toBaseUrl(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
}

// ── Stale-while-revalidate snapshot ──────────────────────────────────────────

const ROWS_CACHE_KEY = 'blissAddonRows:v1';

type RowsCache = { addons: AddonDescriptor[]; rows: Record<string, AddonRowData> };

function readRowsCache(): RowsCache | null {
  try {
    const raw = kv.get(ROWS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RowsCache;
    if (!Array.isArray(parsed?.addons) || !parsed?.rows || typeof parsed.rows !== 'object') return null;
    return parsed;
  } catch {
    return null; // corrupt cache — fall back to the cold path
  }
}

export function useAddonRows(token: string | null): { addons: AddonDescriptor[]; addonRows: Record<string, AddonRowData> } {
  // Seed from the cache so the rows render on the FIRST frame. Rows whose addon
  // was uninstalled since the snapshot are harmless: HomeScreen only renders row
  // ids present in homeRowOptions, which is derived from the live `addons`.
  const [addons, setAddons] = useState<AddonDescriptor[]>(() => readRowsCache()?.addons ?? []);
  const [addonRows, setAddonRows] = useState<Record<string, AddonRowData>>(() => readRowsCache()?.rows ?? {});

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      let urls: string[] = [];
      try {
        urls = await loadInstalledAddonUrls(token);
      } catch {
        urls = [];
      }
      urls = urls.filter((u) => !CINEMETA_RE.test(u));
      if (cancelled) return;

      const cached = readRowsCache();
      const cachedByUrl = new Map((cached?.addons ?? []).map((a) => [a.transportUrl, a]));

      // Hydrate each manifest (with catalogs) into a core AddonDescriptor. An
      // unreachable addon falls back to its cached descriptor (temporarily down
      // ≠ uninstalled) so its row survives the blip; never-seen + unreachable
      // is skipped (no row, like the web).
      const descriptors: AddonDescriptor[] = [];
      await Promise.all(
        urls.map(async (url) => {
          try {
            const manifest = await fetchAddonManifest(toBaseUrl(url), controller.signal);
            descriptors.push({
              transportUrl: url,
              manifest: { id: manifest.id, name: manifest.name, catalogs: manifest.catalogs },
            });
          } catch {
            const prev = cachedByUrl.get(url);
            if (prev) descriptors.push(prev);
          }
        }),
      );
      if (cancelled) return;
      // Promise.all resolves out of order — restore the installed order so rows are
      // stable and match getHomeRowOptions' ordering.
      descriptors.sort((a, b) => urls.indexOf(a.transportUrl) - urls.indexOf(b.transportUrl));
      setAddons(descriptors);

      // Fetch the first valid catalog of each addon → a row. PROGRESSIVE: every
      // row lands as soon as ITS addon responds (one slow addon — usually Kitsu —
      // no longer holds back the others). A failed fetch keeps the cached row
      // that's already painted instead of clearing it.
      const freshRows: Record<string, AddonRowData> = {};
      await Promise.all(
        descriptors.map(async (addon) => {
          const catalog = addon.manifest?.catalogs?.find((c) => c.id && c.type);
          if (!catalog) return;
          try {
            const res = await fetchCatalog({
              type: catalog.type,
              id: catalog.id,
              baseUrl: toBaseUrl(addon.transportUrl),
              signal: controller.signal,
            });
            if (cancelled || !res.metas?.length) return;
            const id = buildAddonRowId(addon.transportUrl, catalog.type, catalog.id);
            const row: AddonRowData = {
              title: `${addon.manifest?.name ?? 'Addon'} - ${catalog.name ?? catalog.id}`,
              items: res.metas.slice(0, MAX_ROW_ITEMS).map(metaToHomeItem),
              type: catalog.type,
              catalogId: catalog.id,
              transportUrl: addon.transportUrl,
            };
            freshRows[id] = row;
            setAddonRows((prev) => ({ ...prev, [id]: row }));
          } catch {
            // catalog unreachable — the cached row (if any) stays on screen
          }
        }),
      );
      if (cancelled) return;

      // Persist the new snapshot: fresh rows + still-installed cached rows whose
      // addon errored this pass. Skip the write when the pass produced nothing
      // (offline) so a network blip can't wipe a good cache.
      const keptRows = Object.fromEntries(
        Object.entries(cached?.rows ?? {}).filter(([id, r]) => !(id in freshRows) && urls.includes(r.transportUrl)),
      );
      const rows = { ...keptRows, ...freshRows };
      if (Object.keys(freshRows).length > 0 && descriptors.length > 0) {
        try {
          kv.set(ROWS_CACHE_KEY, JSON.stringify({ addons: descriptors, rows }));
        } catch {
          /* best-effort cache write */
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [token]);

  return { addons, addonRows };
}
