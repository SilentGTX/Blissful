// Routes metahub / TMDB artwork URLs through the caching `/img` endpoint, so
// posters/backdrops/stills are served from blissful.budinoff.com (NAS-cached,
// 30d immutable) + Cloudflare's edge instead of hitting metahub directly —
// whose edge latency from some client routes swings between ~0.6s and ~20s.
//
// `/img` is reached the same way as the other backend helpers: relative on the
// desktop shell / browser dev (where ui_server.rs / the Vite proxy forwards it
// to blissful.budinoff.com), and absolute via PROXY_BASE on Android Tauri
// (proxy.rs forwards it). `proxyUrl('')` is `''` off-Tauri, so this stays a
// plain relative `/img?...` there.
//
// Anything that isn't a metahub/TMDB http(s) URL (local/bundled assets, data:
// or blob: URLs, already-proxied paths) is returned unchanged, so this is safe
// to apply at every `<img>` / backgroundImage call-site. Keep the RAW url in
// app logic (e.g. metahubPosterToBackdrop derivation) and only wrap at render.

import { proxyUrl } from './proxyBase';

export function proxiedImage(src: string | null | undefined): string {
  if (!src) return src ?? '';
  if (
    src.startsWith('/img?') ||
    src.includes('/img?url=') ||
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
      return proxyUrl(`/img?url=${encodeURIComponent(abs)}`);
    }
  } catch {
    /* not a parseable URL — leave as-is */
  }
  return src;
}
