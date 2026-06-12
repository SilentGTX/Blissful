import { useEffect, useState } from 'react';
import type { StremioMetaDetail } from '@blissful/core';
import { resolveMeta } from '../../lib/metaResolver';
import type { HomeItem } from './homeData';

export type Meta = StremioMetaDetail['meta'];
export type FocusedMeta = { key: string; meta: Meta };

// Caches the featured meta per title (`type:id`) so moving focus back to a title
// repaints its InfoPanel instantly — no re-fetch, no blank. Module-level: shared
// by Home and Discover, and warmed by Home's addon-row prefetch.
export const metaCache = new Map<string, Meta>();

// Featured meta for the focused item (drives the immersive Backdrop + InfoPanel).
// NEVER blanks on focus change (that made the rating/genres/blurb section flash +
// collapse every time the title changed): a cached title repaints instantly; an
// uncached one keeps the CURRENT meta on screen until its own meta arrives (the
// in-flight fetch is aborted if focus moves on, so a stale title's meta can't
// land). Debounced so a fast scrub doesn't spam. The result carries the title key
// it belongs to — consumers only trust it when the key matches their focused item.
export function useFocusedMeta(focused: HomeItem | null, token: string | null): FocusedMeta | null {
  const [focusedMeta, setFocusedMeta] = useState<FocusedMeta | null>(null);
  useEffect(() => {
    if (!focused) return;
    const { id, type } = focused;
    const key = `${type}:${id}`;
    const cached = metaCache.get(key);
    if (cached) { setFocusedMeta({ key, meta: cached }); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      // Route through the owning addon so kitsu items get their real background
      // (the big poster behind) + meta, not Cinemeta's empty sentinel.
      resolveMeta(type, id, token, ctrl.signal)
        .then((r) => { if (r) { metaCache.set(key, r.meta); setFocusedMeta({ key, meta: r.meta }); } })
        .catch(() => {});
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [focused?.id, focused?.type, token]);
  return focusedMeta;
}
