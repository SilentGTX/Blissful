import { useEffect, useState } from 'react';
import { fetchMeta, type StremioMetaDetail } from '../../../lib/stremioAddon';
import type { MediaItem } from '../../../types/media';

export type Meta = StremioMetaDetail['meta'];
export type HoveredMeta = { key: string; meta: Meta };

// Cached per title (`type:id`) so moving the pointer back to a tile repaints the
// featured panel instantly. Module-level, like the TV app's `metaCache`.
const metaCache = new Map<string, Meta>();

/** Featured meta for the hovered tile — the port of the TV app's
 *  `useFocusedMeta` (components/home/useFocusedMeta.ts), hover instead of
 *  D-pad focus.
 *
 *  Deliberately NEVER blanks between titles: on the TV, clearing on every focus
 *  change made the rating/genre/blurb block flash and collapse. A cached title
 *  repaints instantly; an uncached one keeps the CURRENT panel on screen until
 *  its own meta lands, and the in-flight request is aborted when the pointer
 *  moves on so a stale title's meta can't overwrite a newer one. The result
 *  carries its own key so callers only trust a match. */
export function useHoveredMeta(hovered: MediaItem | null): HoveredMeta | null {
  const [meta, setMeta] = useState<HoveredMeta | null>(null);
  const id = hovered?.id;
  const type = hovered?.type;

  useEffect(() => {
    if (!id || !type) return;
    const key = `${type}:${id}`;
    const cached = metaCache.get(key);
    if (cached) {
      setMeta({ key, meta: cached });
      return;
    }
    const ctrl = new AbortController();
    // Debounced: sweeping the pointer across a rail must not fire a request per
    // tile.
    const timer = setTimeout(() => {
      fetchMeta({ type, id, signal: ctrl.signal })
        .then((detail) => {
          if (!detail?.meta) return;
          metaCache.set(key, detail.meta);
          setMeta({ key, meta: detail.meta });
        })
        .catch(() => {
          /* aborted or offline — keep whatever is on screen */
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [id, type]);

  return meta;
}
