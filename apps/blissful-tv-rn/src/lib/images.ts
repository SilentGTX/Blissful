// Image helpers ported from apps/blissful-mvs (lib/transitionPoster.ts +
// lib/imageProxy.ts).
import { getStorageBaseUrl } from '@blissful/core';

// /img sits at the backend root (sibling of /storage).
function imgBase(): string {
  return getStorageBaseUrl().replace(/\/storage\/?$/, '');
}

/** Route metahub/TMDB art through the backend's caching image proxy
 *  (blissful.budinoff.com/img — NAS-cached, 30d-immutable, Cloudflare edge), same
 *  as the old app's lib/imageProxy.ts. Only those two hosts are wrapped; local /
 *  data / already-proxied urls pass through. expo-image then disk-caches the
 *  already-edge-cached bytes (both layers the old app had). */
export function proxiedImage(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith('data:') || src.includes('/img?url=')) return src;
  let abs = src;
  if (abs.startsWith('//')) abs = `https:${abs}`;
  if (!/^https?:\/\//i.test(abs)) return src; // local / bundled asset
  try {
    const host = new URL(abs).hostname;
    if (/(^|\.)metahub\.space$/i.test(host) || host === 'image.tmdb.org') {
      return `${imgBase()}/img?url=${encodeURIComponent(abs)}`;
    }
  } catch {
    /* not parseable — leave as-is */
  }
  return src;
}

/** Rewrite a metahub POSTER url into the matching landscape BACKGROUND url.
 *  Lets the Detail page paint the correct high-res backdrop from frame 1 (using
 *  the poster we already have) instead of showing the small vertical poster and
 *  then swapping to meta.background when it loads — which is the "flash". For
 *  metahub titles the derived URL is byte-identical to meta.background, so the
 *  <Image> source never changes. Returns null for non-metahub urls. */
export function metahubPosterToBackdrop(posterUrl: string | null | undefined): string | null {
  if (!posterUrl) return null;
  const m = posterUrl.match(
    /^(https?:\/\/images\.metahub\.space\/)poster\/(?:small|medium|large)\/([^/]+)\/img$/,
  );
  if (!m) return null;
  return `${m[1]}background/medium/${m[2]}/img`;
}
