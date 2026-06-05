import { Spinner } from '@heroui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MediaCard from '../components/MediaCard';
import { useAuth } from '../context/AuthProvider';
import { useModals } from '../context/ModalsProvider';
import { CloseIcon } from '../icons/CloseIcon';
import { FocusableButton } from '../spatial/FocusableButton';
import { TvSelect } from '../spatial/TvSelect';
import { useTvFocusable } from '../spatial/useTvFocusable';
import { useTvGridWindow } from '../spatial/useTvGridWindow';
import { isTvMode } from '../lib/platform';
import {
  normalizeStremioImage,
  type LibraryItem,
} from '../lib/stremioApi';
import { fetchBlissfulLibrary, putBlissfulLibraryItem } from '../lib/blissfulAuthApi';
import { useErrorToast } from '../lib/useErrorToast';
import type { MediaItem } from '../types/media';

function formatTimeMs(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// Keep formatting helpers around for future UI, but Library grid doesn't show subtitles.
void formatTimeMs;

function percentProgress(item: LibraryItem): number | null {
  const offset = typeof item.state?.timeOffset === 'number' ? item.state.timeOffset : null;
  const duration = typeof item.state?.duration === 'number' ? item.state.duration : null;
  if (offset === null) return null;
  if (!Number.isFinite(offset) || offset <= 0) return null;

  // If duration is missing/zero, still show a tiny "in progress" bar like Stremio.
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return 2;

  return Math.min(100, Math.max(0, (offset / duration) * 100));
}

type TypeFilter = 'all' | string;
type SortMode = 'last_watched' | 'az' | 'za' | 'most_watched';
type WatchedFilter = 'all' | 'watched' | 'not_watched';

function typeLabel(type: string): string {
  const raw = type.trim();
  if (!raw) return 'Other';
  if (raw === 'movie') return 'Movies';
  if (raw === 'series') return 'Series';
  if (raw === 'channel') return 'TV Channels';
  if (raw === 'tv') return 'TV';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

// Remove-from-library "X" on a poster. Its own component so it can host a TV
// focus node (hooks can't run inside the cells `.map`). On TV it's a second
// D-pad stop on each cell (after the card); on desktop it's the mouse-only
// hover button. Stop-propagation so it never bubbles to the card's press.
function LibraryRemoveButton({ onRemove }: { onRemove: () => void }) {
  const { ref } = useTvFocusable({ onPress: onRemove, focusable: isTvMode() });
  return (
    <button
      ref={ref}
      type="button"
      className="tv-focusable-card absolute right-3 top-3 z-20 cursor-pointer rounded-full bg-black/45 p-2 text-white/80 backdrop-blur transition hover:bg-black/65 hover:text-white"
      aria-label="Remove from library"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRemove();
      }}
    >
      <CloseIcon size={16} />
    </button>
  );
}

export default function LibraryPage() {
  const { authKey } = useAuth();
  const { openLogin } = useModals();
  const navigate = useNavigate();

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useErrorToast(error, 'Library error');

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('last_watched');
  const [watchedFilter, setWatchedFilter] = useState<WatchedFilter>('all');
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    if (!authKey) {
      setItems([]);
      setLoading(false);
      setError(null);
      hasLoadedOnceRef.current = false;
      return;
    }

    let cancelled = false;

    const refresh = () => {
      const showLoading = !hasLoadedOnceRef.current;
      if (showLoading) setLoading(true);
      setError(null);
      fetchBlissfulLibrary<LibraryItem>(authKey!)
        .then((result) => {
          if (cancelled) return;
          const next = result.filter((it) => !it.removed);
          hasLoadedOnceRef.current = true;
          setItems(next);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Failed to load library');
          if (showLoading) setItems([]);
        })
        .finally(() => {
          if (cancelled) return;
          if (showLoading) setLoading(false);
        });
    };

    refresh();
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [authKey]);

  const filtered = useMemo(() => {
    const byType = typeFilter === 'all' ? items : items.filter((it) => it.type === typeFilter);
    const byQuery = byType;

    const isWatched = (it: LibraryItem) => {
      const times = typeof it.state?.timesWatched === 'number' ? it.state.timesWatched : 0;
      const flagged = typeof it.state?.flaggedWatched === 'number' ? it.state.flaggedWatched : 0;
      const watchedRaw = typeof it.state?.watched === 'string' ? it.state.watched.trim() : '';
      return times > 0 || flagged > 0 || watchedRaw.length > 0;
    };

    const byWatched =
      watchedFilter === 'all'
        ? byQuery
        : watchedFilter === 'watched'
          ? byQuery.filter(isWatched)
          : byQuery.filter((it) => !isWatched(it));

    const withMtime = (it: LibraryItem) => {
      if (typeof it._mtime === 'number') return it._mtime;
      const n = Date.parse(String(it._mtime ?? ''));
      return Number.isFinite(n) ? n : 0;
    };
    const withTimesWatched = (it: LibraryItem) => (typeof it.state?.timesWatched === 'number' ? it.state.timesWatched : 0);
    const withTimeWatched = (it: LibraryItem) => (typeof it.state?.timeWatched === 'number' ? it.state.timeWatched : 0);

    return byWatched.slice().sort((a, b) => {
      if (sortMode === 'az') return a.name.localeCompare(b.name);
      if (sortMode === 'za') return b.name.localeCompare(a.name);
      if (sortMode === 'most_watched') {
        const dt = withTimesWatched(b) - withTimesWatched(a);
        if (dt !== 0) return dt;
        const d2 = withTimeWatched(b) - withTimeWatched(a);
        if (d2 !== 0) return d2;
        return withMtime(b) - withMtime(a);
      }
      return withMtime(b) - withMtime(a);
    });
  }, [items, sortMode, typeFilter, watchedFilter]);

  const typeOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) {
      const t = String(it.type ?? '').trim();
      if (t) seen.add(t);
    }
    const known = ['movie', 'series', 'channel'];
    const list = Array.from(seen).sort((a, b) => {
      const ia = known.indexOf(a);
      const ib = known.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b);
    });
    return ['all', ...list];
  }, [items]);

  // Per-item card data, memoised so each MediaCard's `item` prop keeps a
  // stable identity across re-renders (the cards are memo'd; a fresh object
  // per render would defeat that and re-render every mounted card on each
  // focus move / library poll).
  const cells = useMemo(
    () =>
      filtered.map((item) => ({
        item,
        videoId: item.type === 'series' ? item.state?.video_id ?? null : null,
        progress: percentProgress(item),
        mediaItem: {
          id: item._id,
          type: item.type,
          title: item.name,
          posterUrl: normalizeStremioImage(item.poster),
        } as MediaItem,
      })),
    [filtered]
  );
  const indexById = useMemo(
    () => new Map(filtered.map((it, index) => [it._id, index])),
    [filtered]
  );

  // TV: a heavy user's library is 500-2000+ items; un-windowed, EVERY one
  // mounted a live MediaCard (poster decode + rating fetch + ResizeObserver)
  // on first Library open — a mount/memory cliff that can kill the WebView
  // renderer on a 2GB device. Window the grid around the focused card the
  // same way Discover does. Off-TV everything stays mounted as before.
  //
  // Track the focused ITEM (by id), not a positional index: a sort/filter
  // switch reorders `cells` without any new focus event, and a stored index
  // would leave the window centered on the old POSITION — unmounting the
  // still-focused card when its new index lands >buffer away (focus then
  // falls back to the top-left card). Deriving the index per render keeps
  // the window glued to the item across reorders; if the item is filtered
  // out entirely, the window re-anchors to the top (index 0).
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdx = useMemo(
    () => (focusedId ? indexById.get(focusedId) ?? 0 : 0),
    [focusedId, indexById]
  );
  const { windowed, cellH, measureCell, isMounted } = useTvGridWindow(focusedIdx);
  const focusLibraryCard = useCallback(
    (m: MediaItem) => {
      // Only the TV window consumes focus position; skip the per-hover
      // re-render on desktop (where `isMounted` is always true anyway).
      if (!windowed) return;
      setFocusedId(m.id);
    },
    [windowed]
  );
  const openLibraryItem = useCallback(
    (m: MediaItem) => {
      const idx = indexById.get(m.id);
      const cell = idx !== undefined ? cells[idx] : undefined;
      if (!cell) return;
      const base = `/detail/${encodeURIComponent(cell.item.type)}/${encodeURIComponent(cell.item._id)}`;
      const href = cell.item.type === 'series' && typeof cell.videoId === 'string'
        ? `${base}?videoId=${encodeURIComponent(cell.videoId)}`
        : base;
      navigate(href);
    },
    [indexById, cells, navigate]
  );

  // Soft-remove a title from the library (upsert removed:true), optimistically
  // dropping it from the grid. Same backend write as the detail page.
  const removeLibraryItem = useCallback(
    (item: LibraryItem) => {
      if (!authKey) return;
      setItems((prev) => prev.filter((x) => x._id !== item._id));
      void putBlissfulLibraryItem(authKey, item._id, { ...item, removed: true }).catch(() => {
        // ignore — the 30s refresh will reconcile if the write failed
      });
    },
    [authKey]
  );

  if (!authKey) {
    return (
      <div className="mt-4">
        <div className="solid-surface rounded-[28px] bg-white/6 p-6">
          <div className="font-[Fraunces] text-2xl font-semibold">Library</div>
          <div className="mt-1 text-sm text-foreground/60">Login to see your Stremio library.</div>
          <div className="mt-5">
            <FocusableButton className="rounded-full bg-white text-black" onPress={openLogin} autoFocusTv>
              Login
            </FocusableButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="mt-5 flex flex-nowrap items-center gap-3 overflow-x-auto hide-scrollbar">
        <div className="flex-none">
          <TvSelect
            ariaLabel="Type"
            value={typeFilter}
            onChange={(key) => setTypeFilter(key)}
            options={typeOptions.map((t) => ({ key: t, label: t === 'all' ? 'All' : typeLabel(t) }))}
            className="w-[160px]"
            triggerClassName="bg-white/6 border border-white/10 rounded-full h-11 text-foreground"
          />
        </div>

        <div className="flex flex-nowrap gap-2">
          {([
            { key: 'last_watched', label: 'Last watched' },
            { key: 'az', label: 'A-Z' },
            { key: 'za', label: 'Z-A' },
            { key: 'most_watched', label: 'Most watched' },
          ] as const).map((chip) => (
            <FocusableButton
              key={chip.key}
              className={
                'cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold tracking-tight transition ' +
                (sortMode === chip.key ? 'bg-white text-black' : 'bg-white/10 text-white/90 hover:bg-white/15')
              }
              onPress={() => setSortMode(chip.key)}
            >
              {chip.label}
            </FocusableButton>
          ))}

          {([
            { key: 'watched', label: 'Watched' },
            { key: 'not_watched', label: 'Not watched' },
          ] as const).map((chip) => (
            <FocusableButton
              key={chip.key}
              className={
                'cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold tracking-tight transition ' +
                (watchedFilter === chip.key ? 'bg-white text-black' : 'bg-white/10 text-white/90 hover:bg-white/15')
              }
              onPress={() => setWatchedFilter((prev) => (prev === chip.key ? 'all' : chip.key))}
            >
              {chip.label}
            </FocusableButton>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-8 flex w-full items-center justify-center text-foreground/70">
          <Spinner
            size="lg"
            color="current"
            className="text-[var(--bliss-accent)] drop-shadow-[0_0_12px_var(--bliss-accent-glow)]"
          />
        </div>
      ) : null}


      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(clamp(160px,16vw,420px),1fr))]">
        {!loading && filtered.length === 0 ? (
          <div className="text-sm text-foreground/60">No library items found.</div>
        ) : null}

        {cells.map((cell, index) => {
          const { item } = cell;
          if (!isMounted(index)) {
            // TV out-of-window cell: same grid slot, same height, no card
            // (see useTvGridWindow). Keeps column flow and scroll geometry
            // identical to a fully-mounted grid.
            return <div key={item._id} style={{ height: cellH || 380 }} aria-hidden />;
          }

          return (
            <div key={item._id} className="relative" ref={measureCell}>
              {/* Remove-from-library X — top-right of the poster. D-pad
                  focusable on TV, mouse-driven on desktop. */}
              <LibraryRemoveButton onRemove={() => removeLibraryItem(item)} />

              <MediaCard
                item={cell.mediaItem}
                variant="poster"
                progress={cell.progress}
                autoFocusTv={index === 0}
                onItemFocus={focusLibraryCard}
                onItemPress={openLibraryItem}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
