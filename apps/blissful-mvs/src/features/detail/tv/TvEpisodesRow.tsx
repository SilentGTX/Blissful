// Bottom "EPISODES" row for the TV series detail page: a Season picker
// (TvSelect + prev/next) above a horizontal rail of 16:9 landscape episode
// cards. Wrapped in a Norigin focus container (saveLastFocusedChild) so the
// row restores the last-focused episode when you come back to it. Selecting an
// episode opens the stream popup (via onSelectEpisode → DetailPage).
//
// Huge single seasons (Kitsu lists e.g. One Piece's 1000+ episodes all as
// "Season 1") are split into RANGES of CHUNK episodes with their own selector +
// prev/next arrows, so you never scroll past hundreds of cards. On load we land
// on the range containing the next-to-watch episode (autoFocusVideoId).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { isTvMode } from '../../../lib/platform';
import { TvSelect } from '../../../spatial/TvSelect';
import { FocusableButton } from '../../../spatial/FocusableButton';
import { ChevronLeftIcon } from '../../../icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../../../icons/ChevronRightIcon';
import { TvEpisodeCard, type EpisodeVideo } from './TvEpisodeCard';

// Above this many episodes in one season, paginate into ranges.
const CHUNK = 50;

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

  const total = videosForSeason.length;
  const needsRanges = total > CHUNK;
  const chunkCount = Math.ceil(total / CHUNK);

  // Stable focusKeys so the episode cards' UP can target whichever head control
  // is shown (geometric nav misses it from a far-right card in a long rail).
  const SEASON_KEY = 'tv-ep-season-select';
  const RANGE_KEY = 'tv-ep-range-select';
  const showSeasonSelect = seasonSelectItems.length > 1 || !needsRanges;
  const headFocusKey = needsRanges ? RANGE_KEY : showSeasonSelect ? SEASON_KEY : undefined;

  // Index of the next-to-watch episode within this season (-1 if absent), and
  // the range that contains it — our default landing range.
  const autoIdx = useMemo(
    () => (autoFocusVideoId ? videosForSeason.findIndex((v) => v.id === autoFocusVideoId) : -1),
    [autoFocusVideoId, videosForSeason],
  );
  const defaultChunk = autoIdx >= 0 ? Math.floor(autoIdx / CHUNK) : 0;

  const [chunk, setChunk] = useState(defaultChunk);
  // True once the user changes the range themselves — after that we stop
  // auto-pulling focus into the rail so range arrows/select can be stepped.
  const userMovedRef = useRef(false);

  // Re-default the range when the season (or its episode set) changes.
  useEffect(() => {
    userMovedRef.current = false;
    setChunk(autoIdx >= 0 ? Math.floor(autoIdx / CHUNK) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, total]);

  const epNum = (v: EpisodeVideo | undefined, i: number) =>
    v && typeof v.episode === 'number' && v.episode > 0 ? v.episode : i + 1;

  const rangeOptions = useMemo(() => {
    if (!needsRanges) return [];
    return Array.from({ length: chunkCount }, (_, c) => {
      const start = c * CHUNK;
      const end = Math.min(total, start + CHUNK) - 1;
      return {
        key: String(c),
        label: `Ep ${epNum(videosForSeason[start], start)}–${epNum(videosForSeason[end], end)}`,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRanges, chunkCount, total, videosForSeason]);

  const safeChunk = Math.min(chunk, Math.max(0, chunkCount - 1));
  const visibleVideos = needsRanges
    ? videosForSeason.slice(safeChunk * CHUNK, safeChunk * CHUNK + CHUNK)
    : videosForSeason;

  const goToChunk = (c: number) => {
    userMovedRef.current = true;
    setChunk(Math.min(Math.max(0, c), chunkCount - 1));
  };

  // Auto-focus target inside the visible range: the next-to-watch episode when
  // it's in view AND the user hasn't manually paged (so range stepping doesn't
  // yank focus off the selector). Otherwise no auto-pull.
  const chunkHasAuto = autoFocusVideoId != null && visibleVideos.some((v) => v.id === autoFocusVideoId);
  const railAutoFocusId = !userMovedRef.current && chunkHasAuto ? autoFocusVideoId : null;

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
      {/* Hide the redundant 1-option season select when ranges carry the nav. */}
      {seasonSelectItems.length > 1 || !needsRanges ? (
        <TvSelect
          value={season == null ? undefined : String(season)}
          options={seasonSelectItems}
          onChange={(k) => onSeasonChange(Number.parseInt(k, 10))}
          ariaLabel="Season"
          className="tv-season-select"
          triggerClassName="tv-season-trigger"
          focusKey={SEASON_KEY}
        />
      ) : null}
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

      {/* Episode-range selector for huge seasons. */}
      {needsRanges ? (
        <>
          <FocusableButton
            className="tv-season-arrow"
            disabled={safeChunk <= 0}
            focusableTv={safeChunk > 0}
            onPress={() => goToChunk(safeChunk - 1)}
            aria-label="Previous episode range"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </FocusableButton>
          <TvSelect
            value={String(safeChunk)}
            options={rangeOptions}
            onChange={(k) => goToChunk(Number.parseInt(k, 10))}
            ariaLabel="Episode range"
            className="tv-season-select"
            triggerClassName="tv-season-trigger"
            focusKey={RANGE_KEY}
          />
          <FocusableButton
            className="tv-season-arrow"
            disabled={safeChunk >= chunkCount - 1}
            focusableTv={safeChunk < chunkCount - 1}
            onPress={() => goToChunk(safeChunk + 1)}
            aria-label="Next episode range"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </FocusableButton>
        </>
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
          {visibleVideos.map((v) => (
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
              // Only the initial next-to-watch landing auto-pulls focus into
              // the rail. When paging ranges, focus stays on the selector (so
              // the arrows can be stepped); Down then enters the new range.
              autoFocus={railAutoFocusId != null && v.id === railAutoFocusId}
              focusKey={`tv-ep-${v.id}`}
              upFocusKey={headFocusKey}
              onPress={() => onSelectEpisode(v.id)}
            />
          ))}
        </div>
      </section>
    </FocusContext.Provider>
  );
}
