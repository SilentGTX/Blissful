// On low-end Android TVs, request the SMALL metahub poster variant instead of
// medium/large. A rail card renders at ~144 CSS px wide on the 10-foot UI, so the
// ~150x220 "small" art is pixel-matched — yet it decodes ~10x fewer bytes than
// the ~500x735 "medium". On a 1-2 GB-RAM GLES2 TV (e.g. Mali-470) that is a large
// graphics-memory + decode-CPU saving across ~200 posters, with no visible quality
// loss at 10 feet. No-op for non-metahub URLs and on desktop (call site gates on
// isTvMode()).
export function tvPosterUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // metahub posters: https://images.metahub.space/poster/{small|medium|large}/<id>/img
  return url.replace(
    /(\/\/images\.metahub\.space\/poster\/)(?:medium|large)(\/)/i,
    '$1small$2',
  );
}
