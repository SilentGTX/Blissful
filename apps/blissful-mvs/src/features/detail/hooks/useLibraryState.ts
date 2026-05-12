import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addToLibraryItem,
  datastoreGetLibraryItemById,
  normalizeStremioImage,
  removeFromLibraryItem,
} from '../../../lib/stremioApi';
import type { LibraryItem } from '../../../lib/stremioApi';
import { resolveProgress } from '../../../lib/progress';
import { isInLibrary as isInLibraryStored, toggleLibrary } from '../../../lib/libraryStore';

type UseLibraryStateParams = {
  authKey: string | null;
  id: string;
  type: string;
  metaName: string | null;
  metaPoster: string | null;
};

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
      datastoreGetLibraryItemById({ authKey, id })
        .then((item) => {
          if (cancelled) return;
          setStremioLibraryItem(item as LibraryItem | null);
        })
        .catch(() => {
          if (cancelled) return;
        });
    };
    refetch();
    // Re-fetch when the player saves progress (NativeMpvPlayer +
    // SimplePlayer dispatch this event after each periodic save). Without
    // this, the detail page's Continue Watching time stays frozen at
    // whatever value was current on first mount.
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
      // `watched` here can also flip true on the cloud-state `watched`
      // token even if no progress was saved (Stremio marks fully-watched
      // episodes with a comma-separated list of video ids).
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
    setStremioLibraryItem((prev: any) => {
      if (!prev) return { _id: id, removed: !nextInLibrary, state: {} } as LibraryItem;
      return { ...prev, removed: !nextInLibrary } as LibraryItem;
    });

    if (nextInLibrary) {
      const poster = metaPoster ? normalizeStremioImage(metaPoster) ?? null : null;
      void addToLibraryItem({ authKey, id, type: type as any, name: metaName, poster })
        .then(() => datastoreGetLibraryItemById({ authKey, id }))
        .then((fresh) => setStremioLibraryItem(fresh as LibraryItem | null))
        .catch(() => {
          // ignore
        });
    } else {
      void removeFromLibraryItem({ authKey, id })
        .then(() => datastoreGetLibraryItemById({ authKey, id }))
        .then((fresh) => setStremioLibraryItem(fresh as LibraryItem | null))
        .catch(() => {
          // ignore
        });
    }
  }, [authKey, id, inLibrary, metaName, metaPoster, type]);

  return {
    stremioLibraryItem,
    inLibrary,
    handleToggleLibrary,
    getEpisodeProgressInfo,
    libraryVersion,
  };
}
