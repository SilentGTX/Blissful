import { useMemo, useState } from 'react';

type StreamSortKey = 'seeders' | 'size' | 'name';

export function useStreamFilters() {
  const [selectedAddon, setSelectedAddon] = useState<string>('ALL');
  const [streamSortKey, setStreamSortKey] = useState<StreamSortKey>('seeders');
  const [onlyTorrentioRdResolve, setOnlyTorrentioRdResolve] = useState(true);

  const addonSelectItems = useMemo(
    () => [
      { key: 'ALL', label: 'All' },
      { key: 'TORRENTIO', label: 'Torrentio' },
    ],
    []
  );

  return {
    selectedAddon,
    setSelectedAddon,
    streamSortKey,
    setStreamSortKey,
    onlyTorrentioRdResolve,
    setOnlyTorrentioRdResolve,
    addonSelectItems,
  };
}
