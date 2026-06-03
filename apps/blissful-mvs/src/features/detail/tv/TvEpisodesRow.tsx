// Bottom "EPISODES" row for the TV series detail page: a Season picker
// (TvSelect + prev/next) above a horizontal rail of 16:9 landscape episode
// cards. Wrapped in a Norigin focus container (saveLastFocusedChild) so the
// row restores the last-focused episode when you come back to it. Selecting an
// episode opens the stream popup (via onSelectEpisode → DetailPage).

import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { isTvMode } from '../../../lib/platform';
import { TvSelect } from '../../../spatial/TvSelect';
import { FocusableButton } from '../../../spatial/FocusableButton';
import { ChevronLeftIcon } from '../../../icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../../../icons/ChevronRightIcon';
import { TvEpisodeCard, type EpisodeVideo } from './TvEpisodeCard';

type Props = {
  season: number | null;
  seasonSelectItems: Array<{ key: string; label: string }>;
  onSeasonChange: (season: number | null) => void;
  canPrevSeason: boolean;
  canNextSeason: boolean;
  onPrevSeason: () => void;
  onNextSeason: () => void;
  videosForSeason: EpisodeVideo[];
  /** Episode card to claim route-entry focus (the next-to-watch episode). */
  autoFocusVideoId?: string | null;
  episodeRatings?: Record<number, number>;
  episodeStills?: Record<number, string>;
  episodeStillsPending?: boolean;
  fallbackPoster?: string | null;
  showRuntime?: string | null;
  normalizeImage: (value?: string | null) => string | null | undefined;
  formatDate: (value?: string) => string | null;
  getEpisodeTitle: (video: { title?: string; name?: string; id: string }) => string;
  getEpisodeProgressInfo: (id: string) => { percent: number; hasProgress: boolean; watched: boolean };
  onSelectEpisode: (videoId: string) => void;
};

export function TvEpisodesRow({
  season,
  seasonSelectItems,
  onSeasonChange,
  canPrevSeason,
  canNextSeason,
  onPrevSeason,
  onNextSeason,
  videosForSeason,
  autoFocusVideoId,
  episodeRatings,
  episodeStills,
  episodeStillsPending,
  fallbackPoster,
  showRuntime,
  normalizeImage,
  formatDate,
  getEpisodeTitle,
  getEpisodeProgressInfo,
  onSelectEpisode,
}: Props) {
  const tv = isTvMode();
  const { ref, focusKey } = useFocusable({
    focusable: tv,
    trackChildren: true,
    saveLastFocusedChild: true,
  });

  const seasonRow = (
    <div className="tv-episodes-season">
      {seasonSelectItems.length > 1 ? (
        <FocusableButton
          className="tv-season-arrow"
          disabled={!canPrevSeason}
          focusableTv={canPrevSeason}
          onPress={onPrevSeason}
          aria-label="Previous season"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </FocusableButton>
      ) : null}
      <TvSelect
        value={season == null ? undefined : String(season)}
        options={seasonSelectItems}
        onChange={(k) => onSeasonChange(Number.parseInt(k, 10))}
        ariaLabel="Season"
        className="tv-season-select"
        triggerClassName="tv-season-trigger"
      />
      {seasonSelectItems.length > 1 ? (
        <FocusableButton
          className="tv-season-arrow"
          disabled={!canNextSeason}
          focusableTv={canNextSeason}
          onPress={onNextSeason}
          aria-label="Next season"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </FocusableButton>
      ) : null}
    </div>
  );

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} className="tv-episodes">
        <div className="tv-episodes-head">
          <div className="tv-episodes-title">Episodes</div>
          {seasonRow}
        </div>
        <div className="tv-episodes-rail">
          {videosForSeason.map((v) => (
            <TvEpisodeCard
              key={v.id}
              video={v}
              episodeRatings={episodeRatings}
              episodeStills={episodeStills}
              episodeStillsPending={episodeStillsPending}
              fallbackPoster={fallbackPoster}
              showRuntime={showRuntime}
              normalizeImage={normalizeImage}
              formatDate={formatDate}
              getEpisodeTitle={getEpisodeTitle}
              getEpisodeProgressInfo={getEpisodeProgressInfo}
              autoFocus={autoFocusVideoId != null && v.id === autoFocusVideoId}
              focusKey={`tv-ep-${v.id}`}
              onPress={() => onSelectEpisode(v.id)}
            />
          ))}
        </div>
      </section>
    </FocusContext.Provider>
  );
}
