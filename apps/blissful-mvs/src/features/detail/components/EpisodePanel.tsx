import { Input } from '@heroui/react';
import type { ReactNode } from 'react';
import { WatchBadge } from './WatchBadge';

type EpisodePanelProps = {
  episodeSearch: string;
  onEpisodeSearchChange: (value: string) => void;
  videosForSeason: Array<{
    id: string;
    thumbnail?: string | null;
    released?: string | null;
    episode?: number;
    title?: string;
    name?: string;
    number?: number;
  }>;
  selectedVideoId: string | null;
  onSelectVideo: (id: string) => void;
  getEpisodeProgressInfo: (id: string) => { percent: number; hasProgress: boolean; watched: boolean };
  normalizeImage: (value?: string | null) => string | null | undefined;
  formatDate: (value?: string) => string | null;
  getEpisodeTitle: (video: { title?: string; name?: string; id: string }) => string;
  searchContainerClassName: string;
  listContainerClassName: string;
  emptyState?: ReactNode;
};

export function EpisodePanel({
  episodeSearch,
  onEpisodeSearchChange,
  videosForSeason,
  selectedVideoId,
  onSelectVideo,
  getEpisodeProgressInfo,
  normalizeImage,
  formatDate,
  getEpisodeTitle,
  searchContainerClassName,
  listContainerClassName,
  emptyState,
}: EpisodePanelProps) {
  return (
    <>
      <div className={searchContainerClassName}>
        <Input
          value={episodeSearch}
          onChange={(e) => onEpisodeSearchChange(e.target.value)}
          placeholder="Search episodes"
          className="w-full bg-white/10 border border-white/10 rounded-full px-4 py-2 text-white"
        />
      </div>

      <div className={listContainerClassName}>
        {videosForSeason.length === 0 ? emptyState : null}
        <div className="space-y-2">
          {videosForSeason.map((v) => {
            const thumb = normalizeImage(v.thumbnail ?? undefined);
            const info = getEpisodeProgressInfo(v.id);
            const p = info.percent;
            const released = formatDate(v.released ?? undefined);
            const episodeTitle = getEpisodeTitle(v);
            const episodeNumber =
              typeof v.episode === 'number'
                ? v.episode
                : typeof v.number === 'number'
                  ? v.number
                  : null;
            const label = episodeNumber ? `${episodeNumber}. ${episodeTitle}` : episodeTitle;

            return (
              <button
                key={v.id}
                type="button"
                className={
                  'w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10 ' +
                  (selectedVideoId === v.id ? 'ring-1 ring-white/30' : '')
                }
                onClick={() => onSelectVideo(v.id)}
              >
                <div className="flex gap-3">
                  <div className="relative h-14 w-24 overflow-hidden rounded-xl bg-white/10">
                    {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
                    {p > 0 ? (
                      <div className="absolute inset-x-1 top-1 h-1 overflow-hidden rounded-full bg-black/40">
                        <div className="h-full bg-emerald-400" style={{ width: `${Math.max(2, p)}%` }} />
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white tracking-[-0.01em]">
                      {label}
                    </div>
                    <div className="mt-1 text-xs text-white/60">{released ?? ''}</div>
                  </div>

                  <div className="flex flex-col items-end justify-between">
                    {info.hasProgress || info.watched ? <WatchBadge /> : <div />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
