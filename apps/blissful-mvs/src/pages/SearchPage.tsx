import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MediaRail from '../components/MediaRail';
import { SkeletonSearchGrid } from '../components/Skeleton';
import { useAddons } from '../context/AddonsProvider';
import { useUI } from '../context/UIProvider';
import { fetchAddonManifest, fetchCatalog } from '../lib/stremioAddon';
import type { MediaItem, MediaType } from '../types/media';

type SearchRow = {
  id: string;
  title: string;
  transportUrl: string; // base or manifest transport url
  type: MediaType;
  catalogId: string;
  items: MediaItem[];
};

function normalizePoster(url?: string) {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function baseFromTransportUrl(transportUrl: string) {
  return transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
}

function isCinemetaTransportUrl(transportUrl: string): boolean {
  return transportUrl.includes('cinemeta.strem.io');
}

function metaToItem(meta: {
  id: string;
  type: MediaType;
  name: string;
  poster?: string;
  description?: string;
  genres?: string[];
  year?: string | number;
  imdbRating?: string | number;
}): MediaItem {
  return {
    id: meta.id,
    type: meta.type,
    title: meta.name,
    posterUrl: normalizePoster(meta.poster),
    blurb: meta.description,
    genres: meta.genres,
    year: typeof meta.year === 'number' ? meta.year : meta.year ? Number.parseInt(String(meta.year), 10) : undefined,
    rating: typeof meta.imdbRating === 'number' ? meta.imdbRating : meta.imdbRating ? Number.parseFloat(String(meta.imdbRating)) : undefined,
  };
}

function shouldShowCatalogForSearch(catalog: Record<string, unknown>) {
  const extraSupported = (catalog as { extraSupported?: string[] }).extraSupported;
  const supported = Array.isArray(extraSupported) && (extraSupported.includes('search') || extraSupported.includes('query'));
  const extra = (catalog as { extra?: Array<{ name?: string }> }).extra;
  const declared = Array.isArray(extra) && extra.some((e) => e?.name === 'search' || e?.name === 'query');
  return supported || declared;
}

function isKitsuAddon(manifest?: { id?: string; name?: string } | null): boolean {
  const hay = `${manifest?.id ?? ''} ${manifest?.name ?? ''}`.toLowerCase();
  return hay.includes('kitsu');
}

export default function SearchPage() {
  const { addons } = useAddons();
  const { setQuery } = useUI();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const q = (searchParams.get('search') ?? searchParams.get('query') ?? '').trim();

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SearchRow[]>([]);

  useEffect(() => {
    setQuery(q);
  }, [q, setQuery]);

  const addonList = useMemo(() => {
    const items = addons.map((addon) => ({
      transportUrl: addon.transportUrl,
      name: addon.manifest?.name ?? addon.transportUrl,
      manifest: addon.manifest ?? null,
      hasManifest: Boolean(addon.manifest),
    }));

    const cinemeta = items.find((a) => isCinemetaTransportUrl(a.transportUrl));
    const rest = items.filter((a) => a !== cinemeta);

    const withCinemeta = cinemeta
      ? [cinemeta, ...rest]
      : [
        {
          transportUrl: 'https://v3-cinemeta.strem.io',
          name: 'Cinemeta',
          manifest: null,
          hasManifest: false,
        },
        ...rest,
      ];

    const seen = new Set<string>();
    return withCinemeta.filter((a) => {
      if (seen.has(a.transportUrl)) return false;
      seen.add(a.transportUrl);
      return true;
    });
  }, [addons]);

  useEffect(() => {
    if (!q) {
      setRows([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setRows([]);

    const upsertRows = (next: SearchRow[]) => {
      setRows((prev) => {
        const byId = new Map(prev.map((r) => [r.id, r] as const));
        for (const r of next) byId.set(r.id, r);
        return Array.from(byId.values());
      });
    };

    const seedCinemeta = async () => {
      try {
        const cinemetaAddon = addonList[0];
        const cinemetaTransportUrl = cinemetaAddon?.transportUrl ?? 'https://v3-cinemeta.strem.io';
        const baseUrl = baseFromTransportUrl(cinemetaTransportUrl);
        const [movies, series] = await Promise.all([
          fetchCatalog({ baseUrl, type: 'movie', id: 'top', extra: { search: q, skip: 0 }, signal: controller.signal }),
          fetchCatalog({ baseUrl, type: 'series', id: 'top', extra: { search: q, skip: 0 }, signal: controller.signal }),
        ]);

        const movieItems = movies.metas.slice(0, 10).map((m) => metaToItem({ ...m, type: 'movie' }));
        const seriesItems = series.metas.slice(0, 10).map((m) => metaToItem({ ...m, type: 'series' }));

        const nextRows: SearchRow[] = [];
        if (movieItems.length) {
          nextRows.push({
            id: `${cinemetaTransportUrl}::movie::top`,
            title: 'Popular - Movie',
            transportUrl: cinemetaTransportUrl,
            type: 'movie',
            catalogId: 'top',
            items: movieItems,
          });
        }
        if (seriesItems.length) {
          nextRows.push({
            id: `${cinemetaTransportUrl}::series::top`,
            title: 'Popular - Series',
            transportUrl: cinemetaTransportUrl,
            type: 'series',
            catalogId: 'top',
            items: seriesItems,
          });
        }
        if (!cancelled) {
          upsertRows(nextRows);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // ignore
      }
    };

    const run = async () => {
      try {
        // Seed cinemeta quickly so the page isn't empty.
        await seedCinemeta();

        const buildTasks = (resolved: Array<typeof addonList[number]>) => {
          const tasks: Array<{
            addon: (typeof resolved)[number];
            catalog: {
              type: MediaType;
              id: string;
              name?: string;
              extraSupported?: string[];
              extra?: Array<{ name: string }>;
            };
          }> = [];

          for (const addon of resolved) {
            if (isCinemetaTransportUrl(addon.transportUrl)) continue;
            const manifest = addon.manifest;
            if (!manifest?.catalogs?.length) continue;
            const catalogs = manifest.catalogs.slice();
            const isKitsu = isKitsuAddon(manifest);
            const pickKitsuCatalog = () => {
              const searchables = catalogs.filter((c) => shouldShowCatalogForSearch(c));
              const preferAnime = searchables.find((c) =>
                String(c.id).toLowerCase().includes('anime')
              );
              if (preferAnime) return preferAnime;
              return searchables[0] ?? catalogs[0] ?? null;
            };
            const filtered = isKitsu ? [pickKitsuCatalog()].filter(Boolean) as typeof catalogs : catalogs;
            for (const catalog of filtered) {
              if (!catalog?.type || !catalog?.id) continue;
              if (!shouldShowCatalogForSearch(catalog) && !isKitsuAddon(manifest)) continue;
              tasks.push({ addon, catalog });
            }
          }
          return tasks;
        };

        const runTasks = async (tasks: ReturnType<typeof buildTasks>) => {
          const concurrency = 6;
          let index = 0;

          const worker = async () => {
            while (index < tasks.length && !cancelled) {
              const current = tasks[index++];
              const { addon, catalog } = current;
              try {
                const baseUrl = baseFromTransportUrl(addon.transportUrl);
                const resp = await fetchCatalog({
                  baseUrl,
                  type: catalog.type,
                  id: catalog.id,
                  extra: { search: q, skip: 0 },
                  signal: controller.signal,
                });

                const items = resp.metas.slice(0, 10).map((m) => metaToItem({ ...m, type: catalog.type }));
                if (items.length === 0) continue;

                if (cancelled) return;
                upsertRows([
                  {
                    id: `${addon.transportUrl}::${catalog.type}::${catalog.id}`,
                    title: `${addon.name} - ${catalog.name ?? catalog.id}`,
                    transportUrl: addon.transportUrl,
                    type: catalog.type,
                    catalogId: catalog.id,
                    items,
                  },
                ]);
              } catch {
                // ignore
              }
            }
          };

          await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
        };

        // Kick off search immediately for addons with cached manifests (faster)
        const immediateTasks = buildTasks(addonList.filter((addon) => addon.hasManifest));
        const immediatePromise = runTasks(immediateTasks);

        // Fetch missing manifests and search remaining addons
        const resolved = await Promise.all(
          addonList.map(async (addon) => {
            if (addon.hasManifest) return addon;
            try {
              const base = baseFromTransportUrl(addon.transportUrl);
              const manifest = await fetchAddonManifest(base, controller.signal);
              return { ...addon, manifest };
            } catch {
              return { ...addon, manifest: null };
            }
          })
        );

        const delayedTasks = buildTasks(resolved.filter((addon) => !addon.hasManifest));
        await Promise.all([immediatePromise, runTasks(delayedTasks)]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [addonList, q]);

  return (
    <div className="board-container mt-4 overflow-x-hidden px-4 sm:px-0">
      <div className="board-content space-y-10">
        {!q ? (
          <div className="solid-surface rounded-[28px] bg-white/6 p-8">
            <div className="font-[Fraunces] text-2xl font-semibold tracking-tight">Search anything</div>
            <div className="mt-2 text-sm text-foreground/70">
              Movies, series, actors, or paste a link.
            </div>
          </div>
        ) : null}

        {q && loading && rows.length === 0 ? <SkeletonSearchGrid /> : null}

        {q && !loading && rows.length === 0 ? (
          <div className="text-sm text-foreground/60">No results.</div>
        ) : null}

        {rows.map((row) => (
          <MediaRail
            key={row.id}
            title={row.title}
            items={row.items}
            noScroll
            className="board-row-poster"
            onItemPress={(item) => navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`)}
            onSeeAll={() => {
              const qs = new URLSearchParams({ search: q });
              navigate(
                `/discover/${encodeURIComponent(row.transportUrl)}/${row.type}/${row.catalogId}?${qs.toString()}`,
                { state: { seedItems: row.items } }
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}
