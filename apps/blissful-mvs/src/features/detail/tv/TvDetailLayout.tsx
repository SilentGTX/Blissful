// Full-bleed 10-foot detail layout (TV only). Pure presentation + focus shell —
// it owns NO data hooks (DetailPage owns them and spreads them in), only the
// local movie-Watch popup state + the "you may also like" fetch. Backdrop fills
// the right, a left column holds logo / meta / genres+cast / summary / actions,
// and the bottom is an episodes rail (series) or a similar-titles row (movie).
// Selecting an episode or pressing Watch opens the centered stream popup.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { isTvMode } from '../../../lib/platform';
import { Rating } from '../../../components/Rating';
import StremioIcon from '../../../components/StremioIcon';
import { GenreChips } from '../components/GenreChips';
import { LibraryActionButton } from '../../../components/LibraryActionButton';
import { FocusableButton } from '../../../spatial/FocusableButton';
import { TvEpisodesRow } from './TvEpisodesRow';
import { TvSimilarRow } from './TvSimilarRow';
import { TvStreamsPopup } from './TvStreamsPopup';
import { useSimilarTitles } from './useSimilarTitles';
import type { EpisodeVideo } from './TvEpisodeCard';
import type { StreamRow } from '../streams';
import type { MediaItem } from '../../../types/media';

type ProgressInfo = {
  percent: number;
  hasProgress: boolean;
  watched: boolean;
  timeSeconds: number;
  durationSeconds: number;
};

type Props = {
  // hero / meta
  background: string | null;
  logo: string | null;
  logoTitle: string;
  logoFailed: boolean;
  onLogoError: () => void;
  runtime: string | null;
  released: string | null;
  releaseInfo: string | null;
  resolvedImdbRating: number | null;
  genres: string[];
  onGenreClick: (genre: string) => void;
  cast: string[];
  onCastClick: (name: string) => void;
  description: string | null;
  // identity
  type: string;
  id: string;
  isSeriesLike: boolean;
  metaName: string | null;
  metaPoster?: string | null;
  // actions
  inLibrary: boolean;
  onToggleLibrary: () => void;
  isLoggedIn: boolean;
  hasTrailer: boolean;
  onOpenTrailer: () => void;
  onShare: () => void;
  onBack: () => void;
  // streams (popup)
  streamRows: StreamRow[];
  streamsLoading: boolean;
  addonSelectItems: Array<{ key: string; label: string }>;
  selectedAddon: string;
  onSelectAddon: (key: string) => void;
  selectedVideoId: string | null;
  selectedEpisodeLabel: string | null;
  onBackToEpisodes: () => void;
  onNavigate: (playerLink: string) => boolean | void;
  getEpisodeProgressInfo: (id: string) => ProgressInfo;
  // episodes (series)
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
  onSelectEpisode: (videoId: string) => void;
  // similar (movie)
  onSimilarPress: (item: MediaItem) => void;
  // modals (Trailer / Share / Unreleased — owned by DetailPage)
  modals?: ReactNode;
};

export function TvDetailLayout(props: Props) {
  const [movieWatchOpen, setMovieWatchOpen] = useState(false);
  const similar = useSimilarTitles(props.type, props.id, props.genres[0]);

  // The detail is a full-screen overlay (covers the rail + top bar). Trap D-pad
  // focus inside it so arrows never reach the rail/top bar behind it; Back/Esc
  // exits the page. Norigin stays running; the stream popup pauses on top.
  const tv = isTvMode();
  const { ref: shellRef, focusKey: shellFocusKey } = useFocusable({
    focusable: tv,
    isFocusBoundary: tv,
    focusBoundaryDirections: ['up', 'down', 'left', 'right'],
    saveLastFocusedChild: true,
    trackChildren: true,
  });

  const popupOpen = props.isSeriesLike ? props.selectedVideoId !== null : movieWatchOpen;
  const closePopup = props.isSeriesLike ? props.onBackToEpisodes : () => setMovieWatchOpen(false);
  const popupTitle = props.isSeriesLike
    ? props.selectedEpisodeLabel ?? props.logoTitle
    : props.metaName ?? props.logoTitle;

  // Route-entry focus for the next-to-watch episode (series). The card's own
  // autoFocus can't claim reliably because `autoFocusVideoId` resolves AFTER
  // mount (async watched-bitfield decode), by which point a route-entry action
  // button already holds focus and useTvFocusable's []-deps autoFocus effect
  // won't re-fire. So once the target card is mounted (its season applied +
  // registered) and the user hasn't started navigating, focus it explicitly.
  // Skipped while the stream popup owns focus (an episode is selected). TV only.
  const userMovedRef = useRef(false);
  useEffect(() => {
    if (!tv || !props.isSeriesLike) return;
    const onKey = () => {
      userMovedRef.current = true;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tv, props.isSeriesLike]);

  const autoFocusVideoId = props.autoFocusVideoId ?? null;
  useEffect(() => {
    if (!tv || !props.isSeriesLike || !autoFocusVideoId || popupOpen) return;
    let cancelled = false;
    const key = `tv-ep-${autoFocusVideoId}`;
    const attempt = (n: number) => {
      if (cancelled || userMovedRef.current) return;
      const node = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
      if (node) {
        setFocus(key);
        return;
      }
      if (n < 6) window.setTimeout(() => attempt(n + 1), 80);
    };
    const id = window.setTimeout(() => attempt(0), 60);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [tv, props.isSeriesLike, autoFocusVideoId, popupOpen]);

  // Exactly one route-entry autoFocus target.
  const primary: 'watch' | 'library' | 'trailer' | 'share' = !props.isSeriesLike
    ? 'watch'
    : props.isLoggedIn
      ? 'library'
      : props.hasTrailer
        ? 'trailer'
        : 'share';

  const metaParts = [
    props.runtime,
    props.released ?? props.releaseInfo,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);

  return (
    <FocusContext.Provider value={shellFocusKey}>
    <div ref={shellRef} className="tv-detail-shell">
      {props.background ? (
        <div className="tv-detail-backdrop">
          <img src={props.background} alt="" />
        </div>
      ) : null}
      <div className="tv-detail-scrim" />

      <div className="tv-detail-content">
        <FocusableButton className="tv-detail-back" onPress={props.onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Back</span>
        </FocusableButton>

        <div className="tv-detail-left">
          {props.logo && !props.logoFailed ? (
            <img className="tv-detail-logo" src={props.logo} alt={props.logoTitle} onError={props.onLogoError} />
          ) : (
            <div className="tv-detail-title-text">{props.logoTitle}</div>
          )}

          <div className="tv-detail-metarow">
            {metaParts.map((part) => (
              <span key={part}>{part}</span>
            ))}
            <Rating initialRating={props.resolvedImdbRating} className="tv-detail-rating" iconClassName="h-5 w-5" />
          </div>

          <div className="tv-detail-tags">
            {props.genres.length ? (
              <div>
                <div className="tv-detail-label">Genres</div>
                <GenreChips genres={props.genres} onGenreClick={props.onGenreClick} limit={5} className="tv-detail-chips" />
              </div>
            ) : null}
            {props.cast.length ? (
              <div>
                <div className="tv-detail-label">Cast</div>
                <div className="tv-detail-chips">
                  {props.cast.slice(0, 5).map((c) => (
                    <FocusableButton key={c} className="tv-detail-chip" onPress={() => props.onCastClick(c)}>
                      {c}
                    </FocusableButton>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {props.description ? (
            <div>
              <div className="tv-detail-label">Summary</div>
              <p className="tv-detail-summary">{props.description}</p>
            </div>
          ) : null}

          <div className="tv-detail-actions">
            {!props.isSeriesLike ? (
              <FocusableButton
                className="action-button-Pn4hZ tv-watch-btn"
                onPress={() => setMovieWatchOpen(true)}
                autoFocusTv={primary === 'watch'}
                aria-label="Watch"
              >
                <StremioIcon name="play" className="icon" />
                <span className="text">Watch</span>
              </FocusableButton>
            ) : null}
            {props.isLoggedIn ? (
              <LibraryActionButton
                inLibrary={props.inLibrary}
                onToggleLibrary={props.onToggleLibrary}
                autoFocusTv={primary === 'library'}
              />
            ) : null}
            <FocusableButton
              className={'action-button-Pn4hZ' + (props.hasTrailer ? '' : ' is-disabled')}
              onPress={props.onOpenTrailer}
              focusableTv={props.hasTrailer}
              disabled={!props.hasTrailer}
              autoFocusTv={primary === 'trailer'}
              aria-label="Trailer"
            >
              <StremioIcon name="trailer" className="icon" />
              <span className="text">Trailer</span>
            </FocusableButton>
            <FocusableButton
              className="action-button-Pn4hZ"
              onPress={props.onShare}
              autoFocusTv={primary === 'share'}
              aria-label="Share"
            >
              <StremioIcon name="share" className="icon" />
              <span className="text">Share</span>
            </FocusableButton>
          </div>
        </div>

        <div className="tv-detail-bottom">
          {props.isSeriesLike ? (
            <TvEpisodesRow
              season={props.season}
              seasonSelectItems={props.seasonSelectItems}
              onSeasonChange={props.onSeasonChange}
              canPrevSeason={props.canPrevSeason}
              canNextSeason={props.canNextSeason}
              onPrevSeason={props.onPrevSeason}
              onNextSeason={props.onNextSeason}
              videosForSeason={props.videosForSeason}
              autoFocusVideoId={props.autoFocusVideoId}
              episodeRatings={props.episodeRatings}
              episodeStills={props.episodeStills}
              episodeStillsPending={props.episodeStillsPending}
              fallbackPoster={props.fallbackPoster}
              showRuntime={props.showRuntime}
              normalizeImage={props.normalizeImage}
              formatDate={props.formatDate}
              getEpisodeTitle={props.getEpisodeTitle}
              getEpisodeProgressInfo={props.getEpisodeProgressInfo}
              onSelectEpisode={props.onSelectEpisode}
            />
          ) : (
            <TvSimilarRow items={similar} onItemPress={props.onSimilarPress} />
          )}
        </div>
      </div>

      <TvStreamsPopup
        open={popupOpen}
        onClose={closePopup}
        title={popupTitle}
        type={props.type}
        id={props.id}
        selectedVideoId={props.selectedVideoId}
        streamRows={props.streamRows}
        streamsLoading={props.streamsLoading}
        addonSelectItems={props.addonSelectItems}
        selectedAddon={props.selectedAddon}
        onSelectAddon={props.onSelectAddon}
        metaName={props.metaName}
        metaPoster={props.metaPoster}
        episodeLabel={props.selectedEpisodeLabel}
        getEpisodeProgressInfo={props.getEpisodeProgressInfo}
        onNavigate={props.onNavigate}
      />

      {props.modals}
    </div>
    </FocusContext.Provider>
  );
}
