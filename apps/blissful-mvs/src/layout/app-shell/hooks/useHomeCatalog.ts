// One-shot fetch of the home page's "Popular Movies / Series" rows
// from the bundled Cinemeta addon plus its manifest. Used by HomePage
// (the only consumer); lives in a hook so AppShell doesn't have to
// own a fetch result + four pieces of state that change exactly once
// per session.
//
// The catalog endpoints are global (cinemeta-hosted, not per-user),
// so we keep this hook independent of auth and run it once on mount.
// Errors surface through the returned `error` field; consumers wire
// it into the toast queue via `useErrorToast` at the AppShell layer.

import { useEffect, useState } from 'react';
import { fetchAddonManifest, fetchCatalog } from '../../../lib/stremioAddon';
import type { StremioAddonManifest } from '../../../lib/stremioAddon';
import type { MediaItem } from '../../../types/media';
import { metaToItem } from '../utils';

export type HomeCatalog = {
  movieItems: MediaItem[];
  seriesItems: MediaItem[];
  loading: boolean;
  error: string | null;
  manifest: StremioAddonManifest | null;
};

export function useHomeCatalog(): HomeCatalog {
  const [movieItems, setMovieItems] = useState<MediaItem[]>([]);
  const [seriesItems, setSeriesItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<StremioAddonManifest | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchAddonManifest(),
      fetchCatalog({ type: 'movie', id: 'top' }),
      fetchCatalog({ type: 'series', id: 'top' }),
    ])
      .then(([manifestResult, movies, series]) => {
        if (cancelled) return;
        setManifest(manifestResult);
        setMovieItems(movies.metas.map((meta) => metaToItem({ ...meta, type: 'movie' })));
        setSeriesItems(series.metas.map((meta) => metaToItem({ ...meta, type: 'series' })));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load catalog';
        setError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { movieItems, seriesItems, loading, error, manifest };
}
