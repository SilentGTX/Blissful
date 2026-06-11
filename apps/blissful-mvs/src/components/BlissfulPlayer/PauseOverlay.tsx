// Pause-state info card — surfaces movie/episode metadata in the
// bottom-left when the user pauses playback. Bitcine-inspired: the
// player goes from "all UI hidden during playback" → "title + meta +
// description visible" without taking over the whole screen.
//
// Behavior:
//   - For series: shows the current episode's title, S/E label, runtime,
//     and per-episode description (falls back to the show's description
//     if the episode's is empty).
//   - For movies: shows the show-level title + description.
//   - IMDb rating chip: per-episode rating when present, else show-level.
//   - Layout is responsive via clamp() so it scales smoothly from phone
//     to 4K monitor without media-query breakpoints.

import { Fragment, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Rating } from '../Rating';
import { proxiedImage } from '../../lib/imageProxy';

export type PauseOverlayVideo = {
  id: string;
  title: string | null;
  season: number | null;
  episode: number | null;
  thumbnail: string | null;
  released: string | null;
  description: string | null;
  rating: string | null;
};

export type PauseOverlayProps = {
  isPlaying: boolean;
  /** True once the underlying <video> has fired `play` at least once.
   *  Used to suppress the overlay during initial mount-buffer-autoplay
   *  when isPlaying is still false but the user hasn't paused. */
  hasPlayedOnce: boolean;
  /** When true the `hasPlayedOnce` gate is bypassed — used by
   *  watch-party guests who join a paused stream via a direct
   *  invite link. Without this they'd land on a paused video
   *  with no overlay (because `play` never fired locally) and
   *  no context for what they're watching. */
  forceShow?: boolean;
  metaTitle?: string | null;
  title: string | null;
  description?: string | null;
  type: string | null;
  videoId: string | null;
  videos?: PauseOverlayVideo[];
  logo?: string | null;
  imdbRating?: string | null;
  /** Movie release date (addon meta). Used to render runtime ·
   *  release-date line for movies; series use per-episode info. */
  released?: string | null;
  duration: number;
  /** Mini-player: scale down only the info CARD (the dim still covers the
   *  whole window). 1 = no scaling (full player). */
  cardScale?: number;
};

function formatRuntime(totalSeconds: number): string | null {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

// Pretty-print an addon-meta release date for the pause overlay's
// meta line. Cinemeta gives an ISO timestamp ("2026-05-15T..."), and
// some addons fall back to `releaseInfo` which is just a year. Both
// surface as a plain year here so it tracks the design language on
// the detail page (and avoids surfacing different formats per addon).
function formatReleaseYear(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const year = Number.parseInt(trimmed.slice(0, 4), 10);
  return Number.isFinite(year) && year > 1800 ? String(year) : trimmed;
}

export function PauseOverlay({
  isPlaying,
  hasPlayedOnce,
  forceShow,
  metaTitle,
  title,
  description,
  type,
  videoId,
  videos,
  logo,
  imdbRating,
  released,
  duration,
  cardScale = 1,
}: PauseOverlayProps) {
  // Hide while paused-on-load (autoplay hasn't fired yet) so the
  // description doesn't flash before the video starts. Early-return
  // on resume gives the instant-disappear the user wants — no exit
  // animation, no AnimatePresence. The enter animation still runs on
  // re-mount because motion's initial → animate fires on first render.
  // `forceShow` lets watch-party guests bypass this — they want
  // the overlay when they join a paused room, even though their
  // local <video> has never fired `play`.
  if (!hasPlayedOnce && !forceShow) return null;
  if (isPlaying || (!metaTitle && !title && !description)) return null;

  // For series: pull the current episode's metadata so we can surface
  // "Season X · Episode Y · Hh Mm" + episode title + episode
  // description instead of the show-level fields.
  const currentEp = type === 'series' && videoId && videos
    ? videos.find((v) => v.id === videoId)
    : null;
  const runtime = formatRuntime(duration);
  const episodeTitle = currentEp?.title ?? null;
  const episodeDescription = currentEp?.description ?? null;
  const seasonNum = currentEp?.season ?? null;
  const episodeNum = currentEp?.episode ?? null;

  // Resolve the rating chip's text BEFORE building the movie meta
  // line — the line wants to inject the Rating chip inline.
  const episodeRating = currentEp?.rating ?? null;
  const fallbackRating = !episodeRating && imdbRating ? imdbRating : null;
  const ratingText = episodeRating ?? fallbackRating;

  // Movies: meta line is `release year · IMDb rating · runtime` on
  // a single row. Series: keep the existing `Season X · Episode Y ·
  // runtime` layout (rating still sits inline with the episode
  // title). Movies build their meta line as JSX so the Rating chip
  // can be interleaved between the text parts; series stay
  // string-only.
  const isMovie = type === 'movie';
  const releaseYear = isMovie ? formatReleaseYear(released) : null;
  const seriesMetaParts = currentEp
    ? [
        seasonNum != null ? `Season ${seasonNum}` : null,
        episodeNum != null ? `Episode ${episodeNum}` : null,
        runtime,
      ].filter(Boolean)
    : [];
  const movieMetaParts: ReactNode[] = isMovie
    ? [
        releaseYear ? <span key="year">{releaseYear}</span> : null,
        ratingText ? (
          <Rating
            key="rating"
            initialRating={ratingText}
            className="gap-1.5 rounded-full bg-black/45 pl-2.5 pr-1.5 py-0.5 text-[0.75em] font-semibold text-white backdrop-blur"
            iconClassName="h-[1.5em] w-[1.5em]"
          />
        ) : null,
        runtime ? <span key="rt">{runtime}</span> : null,
      ].filter(Boolean)
    : [];
  const showMetaLine = isMovie
    ? movieMetaParts.length > 0
    : seriesMetaParts.length > 0;

  return (
    <>
      {/* Dim — full-bleed gradient behind the metadata card. Animates
          IN on pause (fade), unmounts INSTANTLY on resume (early
          return above + no AnimatePresence). Cinematic gradient with
          heavier dim at the bottom where the text sits. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-black/80 via-black/45 to-black/20"
      />
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="pointer-events-none absolute z-15"
        style={
          cardScale !== 1
            ? {
                // Mini window: pin to the bottom-left and scale the whole card
                // (origin bottom-left) so the viewport-sized content fits.
                bottom: '7%',
                left: '4%',
                maxWidth: '92%',
                transform: `scale(${cardScale})`,
                transformOrigin: 'bottom left',
              }
            : {
                // Sits higher than the bottom controls so the description
                // has room to wrap without colliding with the scrub bar.
                bottom: 'clamp(8rem, 14vh, 18rem)',
                left: 'clamp(1.25rem, 3vw, 4rem)',
                maxWidth: 'clamp(20rem, 45vw, 60rem)',
              }
        }
      >
      {logo ? (
        <img
          src={proxiedImage(logo)}
          alt={metaTitle ?? title ?? ''}
          className="w-auto object-contain drop-shadow-2xl"
          style={{
            // 6rem on phone → 14rem on 4K.
            maxHeight: 'clamp(5rem, 9vw, 14rem)',
            marginBottom: 'clamp(0.75rem, 1.2vw, 1.75rem)',
          }}
          draggable={false}
        />
      ) : (
        <div
          className="font-semibold text-white drop-shadow"
          style={{
            fontSize: 'clamp(1.5rem, 2.4vw, 3rem)',
            marginBottom: 'clamp(0.5rem, 0.8vw, 1rem)',
          }}
        >
          {metaTitle ?? title}
        </div>
      )}

      {/* Meta line. Series → "Season X · Episode Y · runtime" (rating
          chip rides with the episode title below). Movies → year ·
          rating · runtime, all on one row, separators between every
          rendered part. */}
      {showMetaLine ? (
        <div
          className="flex flex-wrap items-center gap-3 text-white/80 drop-shadow"
          style={{
            fontSize: 'clamp(0.875rem, 1.05vw, 1.5rem)',
            marginBottom: 'clamp(0.25rem, 0.4vw, 0.75rem)',
          }}
        >
          {isMovie ? (
            movieMetaParts.map((node, i) => (
              <Fragment key={i}>
                {i > 0 ? <span className="text-white/40">·</span> : null}
                {node}
              </Fragment>
            ))
          ) : (
            <span>{seriesMetaParts.join(' · ')}</span>
          )}
        </div>
      ) : null}

      {/* Episode title for series, with IMDb rating chip inline next
          to it. Per-episode rating from Cinemeta when present, else
          falls back to the show-level rating. Movies skip this block
          entirely — their rating lives on the meta line above. */}
      {!isMovie && ((currentEp && episodeTitle) || ratingText) ? (
        <div
          className="flex flex-wrap items-center gap-3 font-semibold text-white drop-shadow"
          style={{
            fontSize: 'clamp(1.125rem, 1.6vw, 2.25rem)',
            marginBottom: 'clamp(0.25rem, 0.4vw, 0.75rem)',
          }}
        >
          {currentEp && episodeTitle ? <span>{episodeTitle}</span> : null}
          {ratingText ? (
            <Rating
              initialRating={ratingText}
              /* Dark rounded pill matching MediaCard's IMDb chip.
                 `font-semibold` overrides the parent's font-weight so
                 the chip's text matches the title's weight; sized in
                 em so it tracks the title's font-size. */
              className="gap-1.5 rounded-full bg-black/45 pl-2.5 pr-1.5 py-0.5 text-[0.75em] font-semibold text-white backdrop-blur"
              iconClassName="h-[1.5em] w-[1.5em]"
            />
          ) : null}
        </div>
      ) : null}

      {/* Description — episode description for series, else
          show-level. Capped to roughly the logo's horizontal extent
          so it wraps onto multiple rows instead of stretching across
          the panel's full 45vw width. */}
      {(currentEp ? episodeDescription : description) ? (
        <div
          className="line-clamp-4 text-white/70 drop-shadow"
          style={{
            fontSize: 'clamp(0.75rem, 0.95vw, 1.25rem)',
            maxWidth: 'clamp(18rem, 28vw, 36rem)',
          }}
        >
          {currentEp ? episodeDescription : description}
        </div>
      ) : null}
      </motion.div>
    </>
  );
}
