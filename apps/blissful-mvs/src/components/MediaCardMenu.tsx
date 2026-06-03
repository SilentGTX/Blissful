// TV quick-actions menu for a media card — opened by HOLDING OK on the card
// (see useTvFocusable onLongPress + MediaCard). A centered portaled sheet that
// reuses useTvOverlay (pause Norigin, native-focus the first item, Up/Down/
// Enter/Esc, Back closes). Mirrors TvFriendActionsMenu. TV-only: MediaCard only
// ever opens it on a TV long-press, so it never mounts on desktop.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { MediaItem } from '../types/media';
import type { LibraryItem } from '../lib/stremioApi';
import { useAuth } from '../context/AuthProvider';
import { useTvOverlay } from '../spatial/useTvOverlay';
import { fetchBlissfulLibrary, putBlissfulLibraryItem } from '../lib/blissfulAuthApi';
import { triggerStremioItemSync } from '../lib/stremioLinkApi';
import { isInLibrary as isInLibraryStored, toggleLibrary } from '../lib/libraryStore';
import { normalizeStremioImage } from '../lib/mediaTypes';
import { notifySuccess } from '../lib/toastQueues';

type Props = {
  item: MediaItem;
  onClose: () => void;
};

export function MediaCardMenu({ item, onClose }: Props) {
  const navigate = useNavigate();
  const { authKey } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useTvOverlay({
    open: true,
    containerRef,
    onClose,
    autoFocusSelector: '.tv-card-menu-item',
  });

  const [inLibrary, setInLibrary] = useState(false);
  const [busy, setBusy] = useState(false);

  const poster = normalizeStremioImage(item.posterUrl ?? undefined) ?? item.posterUrl ?? null;
  const name = item.title ?? item.id;
  const isMovie = item.type === 'movie';

  // Resolve current library membership for the right Add/Remove label. The
  // toggle action re-checks the truth before writing, so the label is just a
  // hint and a slow/failed fetch can't cause a wrong write.
  useEffect(() => {
    let cancelled = false;
    if (!authKey) {
      setInLibrary(isInLibraryStored({ type: item.type, id: item.id }));
      return;
    }
    fetchBlissfulLibrary<LibraryItem>(authKey)
      .then((items) => {
        if (cancelled) return;
        const existing = items.find((it) => it && it._id === item.id);
        setInLibrary(Boolean(existing && !existing.removed));
      })
      .catch(() => {
        if (!cancelled) setInLibrary(isInLibraryStored({ type: item.type, id: item.id }));
      });
    return () => {
      cancelled = true;
    };
  }, [authKey, item.type, item.id]);

  const openDetail = () => {
    onClose();
    navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`);
  };

  // Soft-toggle library membership — mirrors HomePage.handleAddToLibrary: upsert
  // `removed` so saved progress survives a remove+re-add; new items get a stub.
  const toggleLibraryAction = async () => {
    if (busy) return;
    if (!authKey) {
      toggleLibrary({ type: item.type, id: item.id, name, poster: poster ?? undefined });
      notifySuccess('Library', inLibrary ? 'Removed from library' : 'Added to library');
      onClose();
      return;
    }
    setBusy(true);
    try {
      const items = await fetchBlissfulLibrary<LibraryItem>(authKey);
      const existing = items.find((it) => it && it._id === item.id);
      const currentlyIn = Boolean(existing && !existing.removed);
      const base: Partial<LibraryItem> & { _id: string } = existing
        ? { ...existing }
        : { _id: item.id, type: item.type, name, poster: poster ?? null, state: {} };
      base.removed = currentlyIn;
      await putBlissfulLibraryItem(authKey, item.id, base);
      triggerStremioItemSync(authKey, item.id);
      notifySuccess('Library', currentlyIn ? 'Removed from library' : 'Added to library');
    } catch {
      // ignore — the 15-min cron heals
    } finally {
      setBusy(false);
      onClose();
    }
  };

  // Mark a MOVIE watched: flag it watched (Library "Watched" filter reads
  // timesWatched/flaggedWatched) AND clear any Continue-Watching progress so it
  // leaves the CW rail — then push to the linked Stremio account. Series are
  // omitted (per-episode watched needs a WatchedBitField encoder, not built).
  const markMovieWatched = async () => {
    if (busy || !isMovie) return;
    if (!authKey) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const items = await fetchBlissfulLibrary<LibraryItem>(authKey);
      const existing = items.find((it) => it && it._id === item.id);
      const prevState = ((existing?.state as Record<string, unknown> | undefined) ?? {});
      const prevTimes =
        typeof prevState.timesWatched === 'number' && prevState.timesWatched > 0
          ? prevState.timesWatched
          : 0;
      const nowIso = new Date().toISOString();
      const base: Partial<LibraryItem> & { _id: string } = existing
        ? { ...existing }
        : { _id: item.id, type: item.type, name, poster: poster ?? null, state: {} };
      base.removed = false;
      (base as { state: Record<string, unknown> }).state = {
        ...prevState,
        timesWatched: prevTimes + 1,
        flaggedWatched: 1,
        timeOffset: 0,
        duration: 0,
        lastWatched: nowIso,
      };
      await putBlissfulLibraryItem(authKey, item.id, base);
      triggerStremioItemSync(authKey, item.id);
      notifySuccess('Marked as watched', name);
    } catch {
      // ignore
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return createPortal(
    <div className="tv-card-menu-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        className="tv-card-menu"
        role="menu"
        aria-label={`Actions for ${name}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="tv-card-menu-head">
          <div className="tv-card-menu-title">{name}</div>
        </div>
        <button type="button" className="tv-card-menu-item is-accent" onClick={openDetail}>
          Open
        </button>
        <button
          type="button"
          className="tv-card-menu-item"
          onClick={() => void toggleLibraryAction()}
          disabled={busy}
        >
          {inLibrary ? 'Remove from Library' : 'Add to Library'}
        </button>
        {isMovie ? (
          <button
            type="button"
            className="tv-card-menu-item"
            onClick={() => void markMovieWatched()}
            disabled={busy}
          >
            Mark as watched
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
