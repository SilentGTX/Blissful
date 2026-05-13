import { Button, ListBox, Select, Spinner } from '@heroui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MediaCard from '../components/MediaCard';
import { useAuth } from '../context/AuthProvider';
import { useModals } from '../context/ModalsProvider';
import { CloseIcon } from '../icons/CloseIcon';
import {
  datastoreGetLibraryItems,
  normalizeStremioImage,
  removeFromLibraryItem,
  type LibraryItem,
} from '../lib/stremioApi';
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
      datastoreGetLibraryItems({ authKey })
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

  if (!authKey) {
    return (
      <div className="mt-4">
        <div className="solid-surface rounded-[28px] bg-white/6 p-6">
          <div className="font-[Fraunces] text-2xl font-semibold">Library</div>
          <div className="mt-1 text-sm text-foreground/60">Login to see your Stremio library.</div>
          <div className="mt-5">
            <Button className="rounded-full bg-white text-black" onPress={openLogin}>
              Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="mt-5 flex flex-nowrap items-center gap-3 overflow-x-auto hide-scrollbar">
        <div className="flex-none">
          <Select
            aria-label="Type"
            selectedKey={typeFilter}
            onSelectionChange={(key) => {
              if (typeof key === 'string') setTypeFilter(key);
            }}
            className="w-[160px]"
          >
            <Select.Trigger className="bg-white/6 border border-white/10 rounded-full h-11 text-foreground">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {typeOptions.map((t) => (
                  <ListBox.Item key={t} id={t} textValue={t === 'all' ? 'All' : typeLabel(t)}>
                    {t === 'all' ? 'All' : typeLabel(t)}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <div className="flex flex-nowrap gap-2">
          {([
            { key: 'last_watched', label: 'Last watched' },
            { key: 'az', label: 'A-Z' },
            { key: 'za', label: 'Z-A' },
            { key: 'most_watched', label: 'Most watched' },
          ] as const).map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={
                'cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold tracking-tight transition ' +
                (sortMode === chip.key ? 'bg-white text-black' : 'bg-white/10 text-white/90 hover:bg-white/15')
              }
              onClick={() => setSortMode(chip.key)}
            >
              {chip.label}
            </button>
          ))}

          {([
            { key: 'watched', label: 'Watched' },
            { key: 'not_watched', label: 'Not watched' },
          ] as const).map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={
                'cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold tracking-tight transition ' +
                (watchedFilter === chip.key ? 'bg-white text-black' : 'bg-white/10 text-white/90 hover:bg-white/15')
              }
              onClick={() => setWatchedFilter((prev) => (prev === chip.key ? 'all' : chip.key))}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-8 flex w-full items-center justify-center text-foreground/70">
          <Spinner
            size="lg"
            color="current"
            className="text-[var(--bliss-teal)] drop-shadow-[0_0_12px_var(--bliss-teal-glow)]"
          />
        </div>
      ) : null}


      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]">
        {!loading && filtered.length === 0 ? (
          <div className="text-sm text-foreground/60">No library items found.</div>
        ) : null}

        {filtered.map((item) => {
          const poster = normalizeStremioImage(item.poster);
          const progress = percentProgress(item);
          const videoId = item.type === 'series' ? item.state?.video_id ?? null : null;

          const mediaItem: MediaItem = {
            id: item._id,
            type: item.type,
            title: item.name,
            posterUrl: poster,
          };

          return (
            <div key={item._id} className="relative">
              <button
                type="button"
                className="absolute right-3 top-3 z-20 cursor-pointer rounded-full bg-black/35 p-2 text-white/70 backdrop-blur hover:bg-black/45 hover:text-white"
                aria-label="Remove from library"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!authKey) return;
                  setItems((prev) => prev.filter((x) => x._id !== item._id));
                  void removeFromLibraryItem({ authKey, id: item._id }).catch(() => {
                    // ignore
                  });
                }}
              >
                <CloseIcon size={16} />
              </button>

              <MediaCard
                item={mediaItem}
                variant="poster"
                progress={progress}
                onPress={() => {
                  const base = `/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item._id)}`;
                  const href = item.type === 'series' && typeof videoId === 'string'
                    ? `${base}?videoId=${encodeURIComponent(videoId)}`
                    : base;
                  navigate(href);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
