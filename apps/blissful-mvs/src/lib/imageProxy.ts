// Routes metahub / TMDB artwork URLs through the addon-proxy's caching `/img`
// endpoint, so posters/backdrops/stills are served from the Mac (NAS-cached,
// 30d) and Cloudflare's edge instead of hitting metahub directly — whose edge
// latency from some client routes swings between ~0.6s and ~20s.
//
// Anything that isn't a metahub/TMDB http(s) URL (local/bundled assets, data:
// or blob: URLs, already-proxied paths) is returned unchanged, so this is safe
// to apply at every `<img>` / backgroundImage call-site. Keep the RAW url in
// app logic (e.g. metahubPosterToBackdrop derivation) and only wrap at render.
//
// Desktop: the shell's local origin has no `/img` route, so the RELATIVE
// rewrite would 404 — instead, route through the backend's absolute `/img`
// (NAS-cached 30d + Cloudflare edge). This shields desktop from metahub's
// edge-latency swings and outright outages (2026-06-11: metahub down, every
// cold logo hung ~20s = "black veil, no logo" on Continue Watching resume).
// Cache misses during a metahub outage still fail, but anything ever viewed
// on either platform serves from the shared cache.

import { isNativeShell } from './desktop';

const ABSOLUTE_IMG_BASE = 'https://blissful.budinoff.com/img';

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
      // Web: same-origin relative (Traefik routes /img to the addon-proxy).
      // Desktop shell: absolute to the backend — the local origin has no /img.
      const base = isNativeShell() ? `${ABSOLUTE_IMG_BASE}?url=` : '/img?url=';
      return `${base}${encodeURIComponent(abs)}`;
    }
  } catch {
    /* not a parseable URL — leave as-is */
  }
  return src;
}
