// Addon-routed meta resolution — ported from the web app's models/useMetaDetails.ts.
// `fetchMeta` defaults to Cinemeta, which has no addon-specific IDs (e.g. Anime
// Kitsu's `kitsu:NNN`), so for addon items it returns an empty sentinel and the
// Detail page / home backdrop come up blank. Instead we build an ordered list of
// candidate base URLs and keep the FIRST response that actually has content:
//   1. the prefix-owning addon (kitsu:* -> the Kitsu addon),
//   2. then every installed addon (Cinemeta is already first in that list),
//   3. then Cinemeta as a final fallback.
import { fetchMeta, type MediaType, type StremioMetaDetail } from '@blissful/core';
import { loadAddonUrls } from './streamPicker';

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

function toBaseUrl(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
}

function hasContent(r: StremioMetaDetail | null | undefined): boolean {
  return Boolean(r?.meta?.name || r?.meta?.poster || r?.meta?.background);
}

function metaCandidates(transportUrls: string[], id: string): string[] {
  const bases: string[] = [];
  const push = (b: string) => { if (b && !bases.includes(b)) bases.push(b); };
  // Prefix special-case (matches the web): kitsu:* -> the Kitsu addon first so we
  // don't waste the leading Cinemeta request that always comes back empty for it.
  if (id.startsWith('kitsu:')) {
    const kitsu = transportUrls.find((u) => /kitsu/i.test(u));
    if (kitsu) push(toBaseUrl(kitsu));
  }
  for (const u of transportUrls) push(toBaseUrl(u));
  push(CINEMETA_BASE);
  return bases;
}

/** Resolve meta for an item, routing addon IDs (e.g. `kitsu:`) to the owning
 *  addon. Returns null if no candidate has content. */
export async function resolveMeta(
  type: MediaType,
  id: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<StremioMetaDetail | null> {
  let urls: string[] = [];
  try {
    urls = await loadAddonUrls(token);
  } catch {
    urls = [];
  }
  for (const baseUrl of metaCandidates(urls, id)) {
    if (signal?.aborted) return null;
    try {
      let resp = await fetchMeta({ type, id, baseUrl, signal });
      // Kitsu (and some anime addons) serve anime meta under the `series` resource,
      // not `anime` — retry as series when the anime fetch came back empty.
      if (!hasContent(resp) && type === 'anime') {
        try {
          resp = await fetchMeta({ type: 'series', id, baseUrl, signal });
        } catch {
          /* keep the anime resp */
        }
      }
      if (hasContent(resp)) return resp;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
