import { useEffect, useMemo, useState } from 'react';
import { fetchMeta, type StremioMetaDetail } from '../../../lib/stremioAddon';
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
      setSelectedLoading(true);
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

    void run();
    return () => {
      cancelled = true;
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
