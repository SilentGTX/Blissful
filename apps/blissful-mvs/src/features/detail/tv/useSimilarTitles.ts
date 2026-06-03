// "You may also like" for the TV movie detail page. There's no real
// recommendations source (the Cinemeta addon meta has no similar/related
// field, and TMDB recommendations need an API key the user may not have), so
// we derive a useful row from the Cinemeta "top" catalog filtered by the
// title's first genre — the same catalog the home rows use, with a 5-min cache.

import { useEffect, useState } from 'react';
import { fetchCatalog } from '../../../lib/stremioAddon';
import { metaToItem } from '../../../layout/app-shell/utils';
import type { MediaItem } from '../../../types/media';

const CINEMETA = 'https://v3-cinemeta.strem.io';

export function useSimilarTitles(
  type: string,
  id: string,
  genre: string | undefined
): MediaItem[] {
  const [items, setItems] = useState<MediaItem[]>([]);

  useEffect(() => {
    if (type !== 'movie' || !genre) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    fetchCatalog({ type: 'movie', id: 'top', baseUrl: CINEMETA, extra: { genre }, signal: ac.signal })
      .then((resp) => {
        if (cancelled) return;
        const list = resp.metas
          .map((m) => metaToItem({ ...m, type: 'movie' }))
          .filter((it) => it.id !== id)
          .slice(0, 20);
        setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [type, id, genre]);

  return items;
}
