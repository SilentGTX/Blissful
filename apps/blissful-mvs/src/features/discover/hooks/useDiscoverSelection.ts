import { useEffect, useMemo, useState } from 'react';
import { fetchMeta, type StremioMetaDetail } from '../../../lib/stremioAddon';
import { isTvMode } from '../../../lib/platform';
import type { MediaItem, MediaType } from '../../../types/media';

type UseDiscoverSelectionParams = {
  discoverType: MediaType;
  baseUrl: string;
  filteredItems: MediaItem[];
};

export function useDiscoverSelection({ discoverType, baseUrl, filteredItems }: UseDiscoverSelectionParams) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<StremioMetaDetail | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  useEffect(() => {
    if (!filteredItems.length) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const isDesktop = window.innerWidth >= 1024;
    if (isDesktop && (!selectedId || !filteredItems.some((item) => item.id === selectedId))) {
      setSelectedId(filteredItems[0]?.id ?? null);
    }
  }, [filteredItems, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    const run = async () => {
      try {
        const resp = await fetchMeta({ type: discoverType, id: selectedId, baseUrl });
        if (cancelled) return;
        setSelectedMeta(resp);
      } catch {
        if (cancelled) return;
        setSelectedMeta(null);
      } finally {
        if (!cancelled) setSelectedLoading(false);
      }
    };

    // TV: debounce the fetch behind a short settle window — D-pad scanning
    // changes `selectedId` on every step, and undebounced this fired one
    // meta request PER STEP through the loopback proxy — wasted network +
    // JSON parse on titles the user skimmed past. The spinner still shows
    // immediately; only the request waits for the selection to rest. 200ms
    // sits under perception for the preview panel but absorbs a held-down
    // D-pad (Norigin steps ~100ms). Desktop keeps the immediate fetch
    // (0ms) so hover-preview timing is unchanged off-TV.
    setSelectedLoading(true);
    const timer = window.setTimeout(() => void run(), isTvMode() ? 200 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [discoverType, selectedId, baseUrl]);

  const selected = useMemo(() => selectedMeta?.meta ?? null, [selectedMeta]);

  return {
    selectedId,
    setSelectedId,
    selectedMeta,
    selectedLoading,
    selected,
  };
}
