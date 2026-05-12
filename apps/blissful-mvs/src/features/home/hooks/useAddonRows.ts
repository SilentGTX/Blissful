import { useEffect, useState } from 'react';
import type { MediaItem, MediaType } from '../../../types/media';
import type { AddonDescriptor } from '../../../lib/stremioApi';
import { buildAddonRowId } from '../../../lib/homeRows';
import { mapTransportUrl, parseRating } from '../utils';

export type AddonRowData = {
  title: string;
  items: MediaItem[];
  addon: AddonDescriptor;
  type: MediaType;
  catalogId: string;
};

export function useAddonRows(addons: AddonDescriptor[], maxRowItems: number) {
  const [addonRows, setAddonRows] = useState<Record<string, AddonRowData>>({});

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const loadAddonRows = async () => {
      if (!addons.length) {
        setAddonRows({});
        return;
      }

      try {
        const rows: Record<string, AddonRowData> = {};
        const selectedAddons = addons;

        for (const addon of selectedAddons) {
          if (cancelled) return;
          const manifest = addon.manifest;
          if (!manifest?.catalogs?.length) continue;

          const catalog = manifest.catalogs.find((entry) => Boolean(entry.type && entry.id));
          if (!catalog) continue;

          const transportUrl = mapTransportUrl(addon.transportUrl);
          const baseUrl = transportUrl.replace(/manifest\.json$/, '').replace(/\/$/, '/');
          const url = `${baseUrl}catalog/${catalog.type}/${catalog.id}.json`;
          const proxied = `/addon-proxy?url=${encodeURIComponent(url)}`;
          const resp = await fetch(proxied, { signal: controller.signal });
          if (!resp.ok) continue;
          const data = (await resp.json()) as {
            metas?: Array<{
              id: string;
              name: string;
              type: string;
              poster?: string;
              description?: string;
              imdbRating?: string | number;
              genres?: string[];
            }>;
          };
          if (!data.metas || data.metas.length === 0) continue;

          const items = data.metas.slice(0, maxRowItems).map((meta) => ({
            id: meta.id,
            type: meta.type as MediaItem['type'],
            title: meta.name,
            posterUrl: meta.poster?.startsWith('//') ? `https:${meta.poster}` : meta.poster,
            blurb: meta.description,
            genres: meta.genres,
            rating: parseRating(meta.imdbRating),
          }));

          const rowId = buildAddonRowId(addon.transportUrl, catalog.type, catalog.id);
          rows[rowId] = {
            title: `${manifest.name ?? 'Addon'} - ${catalog.name ?? catalog.id}`,
            items,
            addon,
            type: catalog.type as MediaType,
            catalogId: catalog.id,
          };
        }

        if (!cancelled) setAddonRows(rows);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!cancelled) setAddonRows({});
      }
    };

    void loadAddonRows();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [addons, maxRowItems]);

  return addonRows;
}
