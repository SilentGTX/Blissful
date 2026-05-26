import { motion } from 'framer-motion';
import { Rating } from '../Rating';

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
  hasPlayedOnce: boolean;
  forceShow?: boolean;
  metaTitle?: string | null;
  title: string | null;
  description?: string | null;
  type: string | null;
  videoId: string | null;
  videos?: PauseOverlayVideo[];
  logo?: string | null;
  /** Show-level IMDb id (tt-prefixed) for async rating lookup when
   *  `imdbRating` is not populated from the catalog. */
  imdbId?: string | null;
  imdbRating?: string | null;
  duration: number;
};

function formatRuntime(totalSeconds: number): string | null {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

export function PauseOverlay({
  isPlaying, hasPlayedOnce, forceShow, metaTitle, title, description,
  type, videoId, videos, logo, imdbId, imdbRating, duration,
}: PauseOverlayProps) {
  if (!hasPlayedOnce && !forceShow) return null;
  if (isPlaying || (!metaTitle && !title && !description)) return null;

  const currentEp = type === 'series' && videoId && videos
    ? videos.find((v) => v.id === videoId) : null;
  const runtime = formatRuntime(duration);
  const episodeTitle = currentEp?.title ?? null;
  const episodeDescription = currentEp?.description ?? null;
  const seasonNum = currentEp?.season ?? null;
  const episodeNum = currentEp?.episode ?? null;
  const showMetaLine = currentEp && (seasonNum != null || episodeNum != null || runtime);
  const episodeRating = currentEp?.rating ?? null;
  const fallbackRating = !episodeRating && imdbRating ? imdbRating : null;
  const ratingText = episodeRating ?? fallbackRating;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-black/80 via-black/45 to-black/20" />
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="pointer-events-none absolute z-15"
        style={{ bottom: 'clamp(8rem, 14vh, 18rem)', left: 'clamp(1.25rem, 3vw, 4rem)', maxWidth: 'clamp(20rem, 45vw, 60rem)' }}>
        {logo ? (
          <img src={logo} alt={metaTitle ?? title ?? ''}
            className="w-auto object-contain drop-shadow-2xl" draggable={false}
            style={{ maxHeight: 'clamp(5rem, 9vw, 14rem)', marginBottom: 'clamp(0.75rem, 1.2vw, 1.75rem)' }} />
        ) : (
          <div className="font-semibold text-white drop-shadow"
            style={{ fontSize: 'clamp(1.5rem, 2.4vw, 3rem)', marginBottom: 'clamp(0.5rem, 0.8vw, 1rem)' }}>
            {metaTitle ?? title}
          </div>
        )}
        {showMetaLine ? (
          <div className="flex flex-wrap items-center gap-3 text-white/80 drop-shadow"
            style={{ fontSize: 'clamp(0.875rem, 1.05vw, 1.5rem)', marginBottom: 'clamp(0.25rem, 0.4vw, 0.75rem)' }}>
            <span>{[seasonNum != null ? `Season ${seasonNum}` : null, episodeNum != null ? `Episode ${episodeNum}` : null, runtime].filter(Boolean).join(' · ')}</span>
          </div>
        ) : null}
        {(currentEp && episodeTitle) || ratingText ? (
          <div className="flex flex-wrap items-center gap-3 font-semibold text-white drop-shadow"
            style={{ fontSize: 'clamp(1.125rem, 1.6vw, 2.25rem)', marginBottom: 'clamp(0.25rem, 0.4vw, 0.75rem)' }}>
            {currentEp && episodeTitle ? <span>{episodeTitle}</span> : null}
            {ratingText || imdbId ? (
              <Rating
                imdbId={imdbId}
                initialRating={ratingText}
                className="gap-1.5 rounded-full bg-black/45 pl-2.5 pr-1.5 py-0.5 text-[0.75em] font-semibold text-white backdrop-blur"
                iconClassName="h-[1.5em] w-[1.5em]" />
            ) : null}
          </div>
        ) : null}
        {(currentEp ? episodeDescription : description) ? (
          <div className="line-clamp-4 text-white/70 drop-shadow"
            style={{ fontSize: 'clamp(0.75rem, 0.95vw, 1.25rem)', maxWidth: 'clamp(18rem, 28vw, 36rem)' }}>
            {currentEp ? episodeDescription : description}
          </div>
        ) : null}
      </motion.div>
    </>
  );
}
