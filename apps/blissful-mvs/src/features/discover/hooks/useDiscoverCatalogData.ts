import { useEffect, useMemo, useRef, useState } from 'react';
import type { AddonDescriptor } from '../../../lib/stremioApi';
import { fetchCatalog } from '../../../lib/stremioAddon';
import type { MediaItem, MediaType } from '../../../types/media';
import { metaToItem } from '../utils';
import type { NavigateFunction } from 'react-router-dom';

type UseDiscoverCatalogDataParams = {
  transportUrl: string | null;
  discoverType: MediaType;
  discoverCatalog: string;
  discoverGenre: string | null;
  discoverYear: string | null;
  query: string;
  addons: AddonDescriptor[];
  searchParams: URLSearchParams;
  seedItems: MediaItem[];
  navigate: NavigateFunction;
};

export function useDiscoverCatalogData({
  transportUrl,
  discoverType,
  discoverCatalog,
  discoverGenre,
  discoverYear,
  query,
  addons,
  searchParams,
  seedItems,
  navigate,
}: UseDiscoverCatalogDataParams) {
  const [rawItems, setRawItems] = useState<MediaItem[]>(seedItems);
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);

  const baseUrl = useMemo(() => {
    const raw = transportUrl;
    if (!raw) return 'https://v3-cinemeta.strem.io';
    return raw.replace(/\/manifest\.json$/, '');
  }, [transportUrl]);

  const extra = useMemo(() => {
    const next: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      next[key] = value;
    }

    if (discoverCatalog === 'year') {
      delete next.genre;
    } else {
      delete next.year;
    }

    if (query.trim()) {
      next.search = query.trim();
    }
    return next;
  }, [searchParams, query, discoverCatalog]);

  const filteredItems = useMemo(() => {
    if (discoverCatalog === 'year' && discoverYear && discoverYear !== 'all') {
      const year = Number.parseInt(discoverYear, 10);
      if (!Number.isFinite(year)) return rawItems;
      return rawItems.filter((item) => item.year === year);
    }
    if (discoverGenre && discoverGenre !== 'all') {
      return rawItems.filter((item) => (item.genres ?? []).includes(discoverGenre));
    }
    return rawItems;
  }, [rawItems, discoverCatalog, discoverGenre, discoverYear]);

  useEffect(() => {
    if (transportUrl) return;
    const first = addons
      .flatMap((addon) =>
        (addon.manifest?.catalogs ?? []).map((catalog) => ({ addon, catalog }))
      )
      .find((entry) => entry.catalog.type === 'movie');
    if (!first) return;
    navigate(
      '/discover/' +
      encodeURIComponent(first.addon.transportUrl) +
      '/' +
      first.catalog.type +
      '/' +
      first.catalog.id,
      { replace: true }
    );
  }, [addons, navigate, transportUrl]);

  const loadPage = useMemo(() => {
    return async (skip: number) => {
      const resp = await fetchCatalog({
        type: discoverType,
        id: discoverCatalog,
        baseUrl,
        extra: {
          ...extra,
          ...(skip > 0 ? { skip: String(skip) } : null),
        },
      });
      return resp;
    };
  }, [discoverType, discoverCatalog, baseUrl, extra]);

  useEffect(() => {
    let cancelled = false;
    setRawItems([]);
    setHasMore(false);

    const run = async () => {
      setDiscoverLoading(true);
      try {
        const resp = await loadPage(0);
        if (cancelled) return;
        const items = resp.metas.map((meta) => metaToItem({ ...meta, type: discoverType }));
        setRawItems(items);
        setHasMore(Boolean(resp.hasMore));

        if (discoverCatalog === 'year') {
          setAvailableGenres([]);
        } else {
          const genres = new Set<string>();
          for (const item of items) {
            for (const g of item.genres ?? []) genres.add(g);
          }
          setAvailableGenres(Array.from(genres).sort((a, b) => a.localeCompare(b)));
        }

        if (gridScrollRef.current) {
          gridScrollRef.current.scrollTop = 0;
        }
      } catch {
        if (cancelled) return;
        setRawItems([]);
        setAvailableGenres([]);
        setHasMore(false);
      } finally {
        if (!cancelled) setDiscoverLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadPage, discoverType, discoverCatalog, discoverGenre, discoverYear]);

  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const threshold = 400;

    const onScroll = () => {
      if (discoverLoading || loadingMore || !hasMore) return;
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining > threshold) return;

      setLoadingMore(true);
      const skip = rawItems.length;
      loadPage(skip)
        .then((resp) => {
          const nextItems = resp.metas.map((meta) => metaToItem({ ...meta, type: discoverType }));
          setRawItems((prev) => {
            const merged = [...prev, ...nextItems];
            if (discoverCatalog !== 'year') {
              const genres = new Set<string>();
              for (const item of merged) {
                for (const g of item.genres ?? []) genres.add(g);
              }
              setAvailableGenres(Array.from(genres).sort((a, b) => a.localeCompare(b)));
            }
            return merged;
          });
          setHasMore(Boolean(resp.hasMore));
        })
        .catch(() => {
          // ignore
        })
        .finally(() => setLoadingMore(false));
    };

    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [rawItems.length, discoverType, discoverCatalog, discoverLoading, hasMore, loadPage, loadingMore]);

  useEffect(() => {
    if (discoverLoading || loadingMore || !hasMore) return;
    const filterActive =
      (discoverCatalog === 'year' && discoverYear && discoverYear !== 'all') ||
      (discoverCatalog !== 'year' && discoverGenre && discoverGenre !== 'all');
    if (!filterActive) return;
    if (filteredItems.length >= 24) return;

    setLoadingMore(true);
    const skip = rawItems.length;
    loadPage(skip)
      .then((resp) => {
        const nextItems = resp.metas.map((meta) => metaToItem({ ...meta, type: discoverType }));
        setRawItems((prev) => [...prev, ...nextItems]);
        setHasMore(Boolean(resp.hasMore));
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [discoverCatalog, discoverGenre, discoverYear, discoverLoading, filteredItems.length, hasMore, loadPage, loadingMore, rawItems.length]);

  return {
    rawItems,
    setRawItems,
    filteredItems,
    availableGenres,
    discoverLoading,
    hasMore,
    loadingMore,
    gridScrollRef,
    baseUrl,
  };
}
