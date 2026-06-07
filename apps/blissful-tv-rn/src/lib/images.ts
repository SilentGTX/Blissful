// Image helpers ported from apps/blissful-mvs (lib/transitionPoster.ts +
// lib/imageProxy.ts).

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
