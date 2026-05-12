import { useEffect, useMemo, useState } from 'react';
import {
  fetchMeta,
  fetchStreams,
  type StremioMetaDetail,
  type StremioStream,
} from '../lib/stremioAddon';
import { getAddonDisplayName, type AddonDescriptor } from '../lib/stremioApi';
import type { MediaType } from '../types/media';
import { buildStreamDeepLinks } from '../lib/deepLinks';
import { getProgressPercent, getProgress } from '../lib/progressStore';
import type { StreamsByAddon, EnrichedStream } from '../features/detail/streams';

function baseFromTransportUrl(transportUrl: string) {
  return transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
}

type AddonResource =
  | string
  | {
      name: string;
      types?: string[];
      idPrefixes?: string[];
    };

const supportsResource = (
  addon: AddonDescriptor,
  resource: string,
  type: MediaType,
  id: string
): boolean => {
  const resources = addon.manifest?.resources as AddonResource[] | undefined;
  if (!resources || resources.length === 0) return true;

  const matching = resources.filter((entry) =>
    typeof entry === 'string' ? entry === resource : entry.name === resource
  );

  if (matching.length === 0) return false;

  return matching.some((entry) => {
    if (typeof entry === 'string') return true;
    if (entry.types && entry.types.length > 0 && !entry.types.includes(type)) return false;
    if (entry.idPrefixes && entry.idPrefixes.length > 0) {
      return entry.idPrefixes.some((prefix) => id.startsWith(prefix));
    }
    return true;
  });
};

export function useMetaDetails(params: {
  type: string;
  id: string;
  streamVideoId?: string | null;
  addons: AddonDescriptor[];
  enableStreams: boolean;
}) {
  const { type, id, streamVideoId, addons, enableStreams } = params;
  const isSeriesLike = type === 'series' || type === 'anime';

  const [meta, setMeta] = useState<StremioMetaDetail | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);

  const [streamsByAddon, setStreamsByAddon] = useState<StreamsByAddon>({});
  const [streamsLoading, setStreamsLoading] = useState(false);

  const metaBaseCandidates = useMemo(() => {
    const bases: string[] = [];
    
    // Prioritize addon based on ID prefix (like stremio-custom)
    // debtv:* -> Debridio TV, kitsu:* -> Kitsu, other prefixes -> their respective addons
    if (id?.startsWith('debtv:')) {
      // Find Debridio addon and prioritize it
      const debridioAddon = addons.find(a => 
        a.transportUrl.includes('debridio') || 
        a.manifest?.name?.toLowerCase().includes('debridio')
      );
      if (debridioAddon) {
        bases.push(baseFromTransportUrl(debridioAddon.transportUrl));
      }
    }

    if (id?.startsWith('kitsu:')) {
      const kitsuAddon = addons.find(
        (a) =>
          a.transportUrl.toLowerCase().includes('kitsu') ||
          a.manifest?.name?.toLowerCase().includes('kitsu') ||
          a.manifest?.id?.toLowerCase().includes('kitsu')
      );
      if (kitsuAddon) {
        bases.push(baseFromTransportUrl(kitsuAddon.transportUrl));
      }
    }
    
    // Add all addon bases
    for (const addon of addons) {
      const base = baseFromTransportUrl(addon.transportUrl);
      if (!bases.includes(base)) bases.push(base);
    }
    
    // Cinemeta last as fallback
    if (!bases.includes('https://v3-cinemeta.strem.io')) {
      bases.push('https://v3-cinemeta.strem.io');
    }
    
    return bases;
  }, [addons, id]);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let cancelled = false;
    setMetaLoading(true);
    setMeta(null);

    const run = async () => {
      for (const baseUrl of metaBaseCandidates) {
        if (cancelled) return;
        try {
          let resp = await fetchMeta({ type, id, baseUrl, signal: controller.signal });
          if (cancelled) return;
          // Only use meta if it has actual content (name or poster)
          if (!(resp?.meta?.name || resp?.meta?.poster || resp?.meta?.background) && type === 'anime') {
            try {
              resp = await fetchMeta({ type: 'series', id, baseUrl, signal: controller.signal });
            } catch {
              // ignore
            }
          }
          if (resp?.meta?.name || resp?.meta?.poster || resp?.meta?.background) {
            setMeta(resp);
            return;
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // try next base
        }
      }
    };

    void run().finally(() => {
      if (!cancelled) setMetaLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, metaBaseCandidates, type]);

  const streamId = useMemo(() => {
    if (!enableStreams) return null;
    if (isSeriesLike) return streamVideoId ?? null;
    return id;
  }, [enableStreams, id, streamVideoId, isSeriesLike]);

  const startTimeSeconds = useMemo(() => {
    const entry = getProgress({ type, id, videoId: isSeriesLike ? (streamVideoId ?? undefined) : undefined });
    return entry?.time ?? null;
  }, [id, streamVideoId, type, isSeriesLike]);

  useEffect(() => {
    if (!streamId) {
      setStreamsByAddon({});
      setStreamsLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setStreamsLoading(true);
    setStreamsByAddon({});

    const run = async () => {
      const selectedVideo =
        isSeriesLike && streamVideoId && meta?.meta?.videos?.length
          ? meta.meta.videos.find((v) => v.id === streamVideoId) ?? null
          : null;
      const videoLabel = selectedVideo
        ? typeof selectedVideo.season === 'number' && typeof selectedVideo.episode === 'number'
          ? `S${selectedVideo.season}E${selectedVideo.episode} ${(selectedVideo.title ?? selectedVideo.name ?? '').trim()}`.trim()
          : (selectedVideo.title ?? selectedVideo.name ?? selectedVideo.id)
        : null;

      const progress = getProgressPercent({
        type,
        id,
        videoId: isSeriesLike ? (streamVideoId ?? undefined) : undefined,
      });

      const deepLinksFor = (stream: StremioStream) =>
        buildStreamDeepLinks({
          type,
          id,
          metaName: meta?.meta?.name ?? null,
          metaPoster: meta?.meta?.poster ?? null,
          metaLogo: meta?.meta?.logo ?? null,
          videoId: isSeriesLike ? (streamVideoId ?? null) : null,
          videoLabel,
          stream,
          startTimeSeconds,
        });

      const streamAddons = addons.filter((addon) =>
        supportsResource(addon, 'stream', type as MediaType, streamId)
      );

      await Promise.all(
        streamAddons.map(async (addon) => {
          const baseUrl = baseFromTransportUrl(addon.transportUrl);
          try {
            const resp = await fetchStreams({ type, id: streamId, baseUrl, signal: controller.signal });
            if (cancelled) return;
            setStreamsByAddon((prev) => ({
              ...prev,
              [addon.transportUrl]: {
                addonName: getAddonDisplayName(addon),
                streams: (resp.streams ?? []).map((s): EnrichedStream => ({
                  ...s,
                  deepLinks: deepLinksFor(s),
                  progress,
                })),
              },
            }));
          } catch (err: unknown) {
            if (cancelled) return;
            if (err instanceof DOMException && err.name === 'AbortError') return;
            const message = err instanceof Error ? err.message : 'Failed to load streams';
            setStreamsByAddon((prev) => ({
              ...prev,
              [addon.transportUrl]: {
                addonName: getAddonDisplayName(addon),
                streams: [],
                error: message,
              },
            }));
          }
        })
      );
    };

    void run().finally(() => {
      if (!cancelled) setStreamsLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [addons, meta?.meta?.name, meta?.meta?.videos, startTimeSeconds, streamId, streamVideoId, type, isSeriesLike]);

  return {
    meta,
    metaLoading,
    streamsByAddon,
    streamsLoading,
  };
}
