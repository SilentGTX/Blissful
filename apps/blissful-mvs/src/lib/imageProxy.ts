// Routes metahub / TMDB artwork URLs through the addon-proxy's caching `/img`
// endpoint, so posters/backdrops/stills are served from the Mac (NAS-cached,
// 30d) and Cloudflare's edge instead of hitting metahub directly — whose edge
// latency from some client routes swings between ~0.6s and ~20s.
//
// Anything that isn't a metahub/TMDB http(s) URL (local/bundled assets, data:
// or blob: URLs, already-proxied paths) is returned unchanged, so this is safe
// to apply at every `<img>` / backgroundImage call-site. Keep the RAW url in
// app logic (e.g. metahubPosterToBackdrop derivation) and only wrap at render.
export function proxiedImage(src: string | null | undefined): string {
  if (!src) return src ?? '';
  if (
    src.startsWith('/img?') ||
    src.startsWith('/addon-proxy') ||
    src.startsWith('data:') ||
    src.startsWith('blob:')
  ) {
    return src;
  }
  let abs = src;
  if (abs.startsWith('//')) abs = `https:${abs}`;
  if (!/^https?:\/\//i.test(abs)) return src; // local / bundled asset
  try {
    const host = new URL(abs).hostname;
    if (/(^|\.)metahub\.space$/i.test(host) || host === 'image.tmdb.org') {
      return `/img?url=${encodeURIComponent(abs)}`;
    }
  } catch {
    /* not a parseable URL — leave as-is */
  }
  return src;
}
