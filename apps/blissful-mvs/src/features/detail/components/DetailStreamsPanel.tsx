import type { StreamRow } from '../streams';
import { Spinner } from '@heroui/react';
import { EpisodePanel } from './EpisodePanel';
import { SeasonHeader } from './SeasonHeader';
import { StreamFilters } from './StreamFilters';
import { StreamList } from './StreamList';

type DetailStreamsPanelProps = {
  variant: 'mobile' | 'desktop';
  isSeriesLike: boolean;
  rightMode: 'episodes' | 'streams';
  selectedVideoId: string | null;
  selectedEpisodeLabel: string | null;
  nextEpisode: { id: string } | null;
  onBackToEpisodes: () => void;
  onNextEpisode: () => void;
  season: number | null;
  seasonSelectItems: Array<{ key: string; label: string }>;
  onSeasonChange: (season: number) => void;
  canPrevSeason: boolean;
  canNextSeason: boolean;
  onPrevSeason: () => void;
  onNextSeason: () => void;
  videosForSeason: Array<{
    id: string;
    thumbnail?: string | null;
    released?: string | null;
    episode?: number;
    title?: string;
    name?: string;
    number?: number;
  }>;
  onSelectEpisode: (id: string) => void;
  getEpisodeProgressInfo: (id: string) => {
    percent: number;
    hasProgress: boolean;
    watched: boolean;
    timeSeconds: number;
    durationSeconds: number;
  };
  normalizeImage: (value?: string | null) => string | null | undefined;
  formatDate: (value?: string) => string | null;
  getEpisodeTitle: (video: { title?: string; name?: string; id: string }) => string;
  addonSelectItems: Array<{ key: string; label: string }>;
  selectedAddon: string;
  onSelectAddon: (key: string) => void;
  streamsLoading: boolean;
  streamRows: StreamRow[];
  type: string;
  id: string;
  metaName: string | null;
  metaPoster?: string | null;
  onNavigate: (playerLink: string) => void;
};

export function DetailStreamsPanel({
  variant,
  isSeriesLike,
  rightMode,
  selectedVideoId,
  selectedEpisodeLabel,
  nextEpisode,
  onBackToEpisodes,
  onNextEpisode,
  season,
  seasonSelectItems,
  onSeasonChange,
  canPrevSeason,
  canNextSeason,
  onPrevSeason,
  onNextSeason,
  videosForSeason,
  onSelectEpisode,
  getEpisodeProgressInfo,
  normalizeImage,
  formatDate,
  getEpisodeTitle,
  addonSelectItems,
  selectedAddon,
  onSelectAddon,
  streamsLoading,
  streamRows,
  type,
  id,
  metaName,
  metaPoster,
  onNavigate,
}: DetailStreamsPanelProps) {
  const isDesktop = variant === 'desktop';
  const seasonHeaderClassName = isDesktop ? 'p-4' : 'p-3';
  const episodeListClassName = isDesktop
    ? 'h-[calc(100%-10.75rem)] overflow-auto px-4 pb-4 hide-scrollbar'
    : 'max-h-[60vh] overflow-auto px-3 pb-3 hide-scrollbar';
  const filterClassName = isDesktop ? 'px-4 pb-4' : 'px-3 pb-3';
  const streamListContainerClassName = isDesktop
    ? 'h-[calc(100%-10.75rem)] overflow-auto px-4 pb-4 hide-scrollbar'
    : '';
  const streamEmptyClassName = isDesktop
    ? 'rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70'
    : '';

  return (
    <>
      <SeasonHeader
        isSeriesLike={isSeriesLike}
        rightMode={rightMode}
        selectedVideoId={selectedVideoId}
        selectedEpisodeLabel={selectedEpisodeLabel}
        nextEpisode={nextEpisode}
        onBackToEpisodes={onBackToEpisodes}
        onNextEpisode={onNextEpisode}
        season={season}
        seasonSelectItems={seasonSelectItems}
        onSeasonChange={onSeasonChange}
        canPrevSeason={canPrevSeason}
        canNextSeason={canNextSeason}
        onPrevSeason={onPrevSeason}
        onNextSeason={onNextSeason}
        className={seasonHeaderClassName}
      />

      {isSeriesLike && rightMode === 'episodes' ? (
        <EpisodePanel
          videosForSeason={videosForSeason}
          onSelectVideo={onSelectEpisode}
          getEpisodeProgressInfo={getEpisodeProgressInfo}
          normalizeImage={normalizeImage}
          formatDate={formatDate}
          getEpisodeTitle={getEpisodeTitle}
          listContainerClassName={episodeListClassName}
        />
      ) : (
        <>
          <StreamFilters
            addonSelectItems={addonSelectItems}
            selectedAddon={selectedAddon}
            onSelectAddon={onSelectAddon}
            showAddonSelect={isDesktop}
            className={filterClassName}
            addonWidthClassName={isDesktop ? undefined : 'w-[120px]'}
          />

           <div className={streamListContainerClassName}>
             {streamsLoading ? (
               <div className="flex w-full items-center justify-center py-10">
                 <Spinner
                   size="lg"
                   color="current"
                   className="text-[var(--bliss-accent)] drop-shadow-[0_0_12px_var(--bliss-accent-glow)]"
                 />
               </div>
             ) : null}
             {!streamsLoading && streamRows.length === 0 ? (
               <div className={streamEmptyClassName}>No streams found.</div>
             ) : null}

            <StreamList
              rows={streamRows}
              variant={variant}
              type={type}
              id={id}
              selectedVideoId={selectedVideoId}
              metaName={metaName}
              metaPoster={metaPoster ?? null}
              episodeLabel={selectedEpisodeLabel ?? null}
              getEpisodeProgressInfo={getEpisodeProgressInfo}
              onNavigate={onNavigate}
            />
          </div>
        </>
      )}
    </>
  );
}
