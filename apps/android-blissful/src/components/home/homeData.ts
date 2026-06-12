import { normalizeStremioImage, type MediaType, type StremioMetaPreview } from '@blissful/core';
import { metahubPosterToBackdrop } from '../../lib/images';
import type { CwItem } from '../../lib/continueWatching';

// The normalized shape every Home tile / the featured InfoPanel reads. Built from
// either a catalog preview (Popular rows) or a Continue Watching entry.
export type HomeItem = {
  id: string;
  type: MediaType;
  name: string;
  poster?: string | null;
  imdbRating?: string | number | null;
  /** 0..100 — present only for Continue Watching tiles (drives the progress bar). */
  progress?: number | null;
  /** The original CW entry, kept so a tile press can open the Resume flow. */
  cw?: CwItem;
};

// Landscape (16:9) art for a tile / the full-bleed backdrop. Cinemeta hands us a
// portrait poster; for metahub titles the matching landscape BACKGROUND url is
// derivable from it (byte-identical to meta.background, no network fetch), so the
// tile paints real backdrop art instantly. Falls back to the poster (cover-cropped).
export function landscapeArt(poster: string | null | undefined): string | undefined {
  const p = normalizeStremioImage(poster);
  return metahubPosterToBackdrop(p) ?? p ?? undefined;
}

export function metaToHomeItem(meta: StremioMetaPreview): HomeItem {
  return { id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, imdbRating: meta.imdbRating };
}

export function cwToHomeItem(c: CwItem): HomeItem {
  return {
    id: c.id,
    type: (c.type === 'series' ? 'series' : 'movie') as MediaType,
    name: c.name,
    poster: c.poster,
    progress: c.progress,
    cw: c,
  };
}
