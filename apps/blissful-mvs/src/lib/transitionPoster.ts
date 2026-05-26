// Tiny in-memory cache of the click context the user just initiated.
// DetailPage reads this on mount so the shared-element FLIP can render
// the high-res landscape backdrop from the very first frame instead of
// flashing the small card poster URL while waiting for meta to load.
//
// For metahub-served posters (the common case) we can derive the
// matching backdrop URL deterministically from the poster URL alone:
//   https://images.metahub.space/poster/<size>/<imdb>/img
//   -> https://images.metahub.space/background/medium/<imdb>/img
// That gives us the same URL `meta.meta.background` will resolve to,
// but without waiting on the meta call. We also kick off a hidden
// preload at click time so the bitmap is in the browser cache by the
// time the FLIP layer mounts a few ms later.

export type CachedClickPoster = {
  posterUrl: string;
  backdropUrl: string | null;
};

const store = new Map<string, CachedClickPoster>();

export function metahubPosterToBackdrop(posterUrl: string | null | undefined): string | null {
  if (!posterUrl) return null;
  const m = posterUrl.match(
    /^(https?:\/\/images\.metahub\.space\/)poster\/(?:small|medium|large)\/([^/]+)\/img$/,
  );
  if (!m) return null;
  return `${m[1]}background/medium/${m[2]}/img`;
}

export function rememberClickedPoster(
  type: string,
  id: string,
  posterUrl: string | null | undefined,
): void {
  if (!posterUrl) return;
  const backdropUrl = metahubPosterToBackdrop(posterUrl);
  store.set(`${type}::${id}`, { posterUrl, backdropUrl });
  // Warm the browser cache so the FLIP layer's first paint can already
  // be the high-res backdrop. Fire-and-forget — no error handling needed.
  if (backdropUrl) {
    const img = new Image();
    img.src = backdropUrl;
  }
}

export function consumeClickedPoster(type: string, id: string): CachedClickPoster | null {
  const key = `${type}::${id}`;
  const value = store.get(key);
  if (value) {
    store.delete(key);
    return value;
  }
  return null;
}
