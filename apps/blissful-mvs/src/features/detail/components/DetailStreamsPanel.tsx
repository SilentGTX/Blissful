import type { StreamRow } from '../streams';
import { BlissSpinner } from '../../../components/base';
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
    description?: string;
    runtime?: string;
    rating?: number | string | null;
  }>;
  /** Show-level runtime fallback for per-episode display. */
  showRuntime?: string | null;
  /** Show-level IMDB rating — used as a per-episode fallback when
   *  Cinemeta returns "0" / no rating for the episode (very common). */
  showRating?: number | string | null;
  /** Show's IMDB id (tt-prefixed). Lets the per-episode Rating
   *  component fetch IMDB → TMDB fallback when no inline rating is
   *  available. */
  showImdbId?: string | null;
  /** Per-episode TMDB rating map for the current season: `{ [episode]: vote_average }`.
   *  Populated by DetailPage when the user picks a season (lazy
   *  /tmdb-season-info fetch). */
  episodeRatings?: Record<number, number> | undefined;
  /** Per-episode TMDB still URLs for the current season: `{ [episode]: url }`.
   *  Used as the episode-card thumbnail fallback when metahub 404s. */
  episodeStills?: Record<number, string> | undefined;
  /** True while the season's TMDB still fetch is in flight (keeps the
   *  episode-card skeleton up instead of flashing the show poster). */
  episodeStillsPending?: boolean;
  /** Full episode list across all seasons — drives the EpisodesDrawer
   *  (which manages season selection internally). */
  allVideos: Array<{
    id: string;
    title?: string | null;
    season?: number | null;
    episode?: number | null;
    thumbnail?: string | null;
    released?: string | null;
    description?: string | null;
  }>;
  /** Optional TMDB id for per-season metadata enrichment. */
  tmdbId?: number | null;
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
  onlyTorrentioRdResolve: boolean;
  onToggleWebReady: () => void;
  streamsLoading: boolean;
  streamRows: StreamRow[];
  type: string;
  id: string;
  metaName: string | null;
  metaPoster?: string | null;
  onNavigate: (playerLink: string) => void;
  onOpenExternalPrompt: (prompt: { title: string; url: string; reason: string; internalPlayerLink: string | null }) => void;
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
  episodeSearch,
  onEpisodeSearchChange,
  videosForSeason,
  showRuntime,
  showRating,
  showImdbId,
  episodeRatings,
  episodeStills,
  episodeStillsPending,
  onSelectEpisode,
  getEpisodeProgressInfo,
  normalizeImage,
  formatDate,
  getEpisodeTitle,
  addonSelectItems,
  selectedAddon,
  onSelectAddon,
  onlyTorrentioRdResolve,
  onToggleWebReady,
  streamsLoading,
  streamRows,
  type,
  id,
  metaName,
  metaPoster,
  onNavigate,
  onOpenExternalPrompt,
}: DetailStreamsPanelProps) {
  const isDesktop = variant === 'desktop';
  const seasonHeaderClassName = isDesktop ? 'p-4' : 'p-3';
  const episodeListClassName = isDesktop
    ? 'h-[calc(100%-7rem)] overflow-auto px-4 pb-4 pt-3 hide-scrollbar'
    : 'max-h-[60vh] overflow-auto px-3 pb-3 pt-2 hide-scrollbar';
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
        episodeSearch={episodeSearch}
        onEpisodeSearchChange={onEpisodeSearchChange}
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
          fallbackPoster={metaPoster ?? null}
          showRuntime={showRuntime ?? null}
          showRating={showRating ?? null}
          showImdbId={showImdbId ?? null}
          episodeRatings={episodeRatings}
          episodeStills={episodeStills}
          episodeStillsPending={episodeStillsPending}
        />
      ) : (
        <>
          <StreamFilters
            addonSelectItems={addonSelectItems}
            selectedAddon={selectedAddon}
            onSelectAddon={onSelectAddon}
            showAddonSelect={isDesktop}
            onlyTorrentioRdResolve={onlyTorrentioRdResolve}
            onToggleWebReady={onToggleWebReady}
            className={filterClassName}
            addonWidthClassName={isDesktop ? undefined : 'w-[120px]'}
            showWebReadyToggle={isDesktop}
          />

           <div className={streamListContainerClassName}>
             {streamsLoading ? (
               <div className="flex w-full items-center justify-center py-10">
                 <BlissSpinner size="lg" />
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
              onlyTorrentioRdResolve={onlyTorrentioRdResolve}
              getEpisodeProgressInfo={getEpisodeProgressInfo}
              onNavigate={onNavigate}
              onOpenExternalPrompt={onOpenExternalPrompt}
            />
          </div>
        </>
      )}
    </>
  );
}
