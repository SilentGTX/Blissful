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
import { useEffect, useState } from 'react';
import { fetchAddonManifest, fetchCatalog, type AddonDescriptor, type MediaType } from '@blissful/core';
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

export function useAddonRows(token: string | null): { addons: AddonDescriptor[]; addonRows: Record<string, AddonRowData> } {
  const [addons, setAddons] = useState<AddonDescriptor[]>([]);
  const [addonRows, setAddonRows] = useState<Record<string, AddonRowData>>({});

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

      // Hydrate each manifest (with catalogs) into a core AddonDescriptor.
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
            // unreachable addon — skip (no row, like the web)
          }
        }),
      );
      if (cancelled) return;
      // Promise.all resolves out of order — restore the installed order so rows are
      // stable and match getHomeRowOptions' ordering.
      descriptors.sort((a, b) => urls.indexOf(a.transportUrl) - urls.indexOf(b.transportUrl));
      setAddons(descriptors);

      // Fetch the first valid catalog of each addon → a row.
      const rows: Record<string, AddonRowData> = {};
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
            if (!res.metas?.length) return;
            rows[buildAddonRowId(addon.transportUrl, catalog.type, catalog.id)] = {
              title: `${addon.manifest?.name ?? 'Addon'} - ${catalog.name ?? catalog.id}`,
              items: res.metas.slice(0, MAX_ROW_ITEMS).map(metaToHomeItem),
              type: catalog.type,
              catalogId: catalog.id,
              transportUrl: addon.transportUrl,
            };
          } catch {
            // catalog unreachable / empty — skip
          }
        }),
      );
      if (!cancelled) setAddonRows(rows);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [token]);

  return { addons, addonRows };
}
