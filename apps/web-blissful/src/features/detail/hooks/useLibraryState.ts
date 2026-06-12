import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeStremioImage } from '../../../lib/mediaTypes';
import type { LibraryItem } from '../../../lib/mediaTypes';
import {
  fetchBlissfulLibrary,
  putBlissfulLibraryItem,
} from '../../../lib/blissfulAuthApi';
import { resolveProgress } from '../../../lib/progress';
import { isInLibrary as isInLibraryStored, toggleLibrary } from '../../../lib/libraryStore';

type UseLibraryStateParams = {
  authKey: string | null;
  id: string;
  type: string;
  metaName: string | null;
  metaPoster: string | null;
};

// The /library endpoint returns the whole list. For a detail page we
// only need one item, so the cheapest API surface is a client-side
// filter on the fetched list — small enough that this isn't worth a
// dedicated GET /library/:id endpoint.
async function fetchOneLibraryItem(authKey: string, id: string): Promise<LibraryItem | null> {
  const all = await fetchBlissfulLibrary<LibraryItem>(authKey);
  return all.find((it) => it._id === id) ?? null;
}

export function useLibraryState({ authKey, id, type, metaName, metaPoster }: UseLibraryStateParams) {
  const [stremioLibraryItem, setStremioLibraryItem] = useState<LibraryItem | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);

  useEffect(() => {
    if (!authKey || !id) {
      setStremioLibraryItem(null);
      return;
    }
    let cancelled = false;
    const refetch = () => {
      fetchOneLibraryItem(authKey, id)
        .then((item) => {
          if (cancelled) return;
          setStremioLibraryItem(item);
        })
        .catch(() => {
          if (cancelled) return;
        });
    };
    refetch();
    const onProgress = () => {
      refetch();
    };
    window.addEventListener('blissful:progress', onProgress);
    return () => {
      cancelled = true;
      window.removeEventListener('blissful:progress', onProgress);
    };
  }, [authKey, id, libraryVersion]);

  const watchedVideoIds = useMemo(() => {
    const raw = String((stremioLibraryItem as any)?.state?.watched ?? '');
    if (!raw) return new Set<string>();
    const tokens = raw
      .split(/[\s,;|]+/g)
      .map((t) => t.trim())
      .filter(Boolean);
    return new Set(tokens);
  }, [(stremioLibraryItem as any)?.state?.watched]);

  const getEpisodeProgressInfo = useCallback(
    (videoId: string) => {
      const resolved = resolveProgress({
        type,
        id,
        videoId,
        libraryItem: stremioLibraryItem,
      });
      const watched = watchedVideoIds.has(videoId) || resolved.watched;
      return { ...resolved, watched };
    },
    [id, stremioLibraryItem, type, watchedVideoIds]
  );

  const inLibrary = useMemo(() => {
    if (!id) return false;
    if (authKey) {
      return Boolean(stremioLibraryItem && !(stremioLibraryItem as any)?.removed);
    }
    return isInLibraryStored({ type, id });
  }, [authKey, id, stremioLibraryItem, type]);

  const handleToggleLibrary = useCallback(() => {
    if (!metaName) return;
    if (!authKey) {
      toggleLibrary({ type, id, name: metaName, poster: undefined });
      setLibraryVersion((v) => v + 1);
      return;
    }

    const nextInLibrary = !inLibrary;
    const poster = metaPoster ? normalizeStremioImage(metaPoster) ?? null : null;

    // `temp: true` keeps the row visible in Continue Watching even
    // when `removed: true` — so removing from Library doesn't wipe
    // its CW entry. Adding to library clears the flag (real bookmark
    // again).
    setStremioLibraryItem((prev: any) => {
      if (!prev) return { _id: id, removed: !nextInLibrary, temp: !nextInLibrary, state: {} } as LibraryItem;
      return { ...prev, removed: !nextInLibrary, temp: !nextInLibrary } as LibraryItem;
    });

    // Build the upserted doc — preserve existing state (timeOffset etc),
    // toggle `removed` + `temp`. The server replaces the row, so we
    // must send the full shape we want stored.
    const base: Partial<LibraryItem> & { _id: string } = stremioLibraryItem
      ? { ...(stremioLibraryItem as any) }
      : ({ _id: id, type, name: metaName, poster, state: {} } as any);
    base._id = id;
    (base as any).removed = !nextInLibrary;
    (base as any).temp = !nextInLibrary;

    void putBlissfulLibraryItem(authKey, id, base)
      .then(() => fetchOneLibraryItem(authKey, id))
      .then((fresh) => setStremioLibraryItem(fresh))
      .catch(() => {
        // ignore
      });
  }, [authKey, id, inLibrary, metaName, metaPoster, stremioLibraryItem, type]);

  return {
    stremioLibraryItem,
    inLibrary,
    handleToggleLibrary,
    getEpisodeProgressInfo,
    libraryVersion,
  };
}
