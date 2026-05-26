import { useState, type ReactNode } from 'react';
import { Rating } from '../../../components/Rating';

// Cinemeta returns metahub URLs for future episodes that don't
// yet have artwork. The URL is technically valid but 404s. This
// component swaps to the show poster on load error so we never
// leave a blank gray rectangle.
function EpisodeThumb({ src, fallback }: { src?: string | null; fallback?: string | null }) {
  const [failed, setFailed] = useState(false);
  const effective = !failed && src ? src : fallback || null;
  if (!effective) {
    return <div className="absolute inset-0 bg-white/5" />;
  }
  return (
    <img
      src={effective}
      alt=""
      className="absolute inset-0 h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      onError={() => {
        if (!failed) setFailed(true);
      }}
    />
  );
}

type EpisodePanelProps = {
  videosForSeason: Array<{
    id: string;
    thumbnail?: string | null;
    released?: string | null;
    episode?: number;
    title?: string;
    name?: string;
    number?: number;
    description?: string;
    /** Per-episode runtime (rare — usually missing from Cinemeta). */
    runtime?: string;
    /** Per-episode IMDB-style rating string (Cinemeta returns this as
     *  the `rating` field; ships "0" when not rated). */
    rating?: number | string | null;
  }>;
  /** Show-level runtime ("24 min", "1h 30m", etc.) — used as a uniform
   *  per-episode fallback when Cinemeta doesn't ship a per-episode
   *  runtime. */
  showRuntime?: string | null;
  /** Show-level IMDB rating — Cinemeta returns "0" for most per-episode
   *  ratings, so we fall back to the show's rating when missing. */
  showRating?: number | string | null;
  /** Show's IMDB id (tt-prefixed). Triggers Rating's IMDB→TMDB fallback
   *  chain when neither the episode nor the show ships a rating. */
  showImdbId?: string | null;
  /** Per-episode TMDB rating map for the current season:
   *  `{ [episodeNumber]: vote_average }`. Used as a fallback when
   *  Cinemeta's per-episode `rating` field is "0" / missing. */
  episodeRatings?: Record<number, number> | undefined;
  onSelectVideo: (id: string) => void;
  getEpisodeProgressInfo: (id: string) => { percent: number; hasProgress: boolean; watched: boolean };
  normalizeImage: (value?: string | null) => string | null | undefined;
  formatDate: (value?: string) => string | null;
  getEpisodeTitle: (video: { title?: string; name?: string; id: string }) => string;
  listContainerClassName: string;
  emptyState?: ReactNode;
  /** Show poster (or background) used as fallback when an
   *  episode's metahub thumbnail 404s. */
  fallbackPoster?: string | null;
};

export function EpisodePanel({
  videosForSeason,
  onSelectVideo,
  getEpisodeProgressInfo,
  normalizeImage,
  formatDate,
  getEpisodeTitle,
  listContainerClassName,
  emptyState,
  fallbackPoster,
  showRuntime,
  showRating: _showRating,
  showImdbId: _showImdbId,
  episodeRatings,
}: EpisodePanelProps) {
  return (
    <>
      <div className={listContainerClassName}>
        {videosForSeason.length === 0 ? emptyState : null}
        {/* Stacked 16:9 cards with text overlaid on the image — same
            visual language as the player's episode picker (poster fills
            the card, gradient + title sit at the bottom). */}
        <div className="space-y-3">
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
            const runtime = v.runtime ?? showRuntime ?? null;
            const description = v.description ?? null;
            // Episode rating: prefer Cinemeta's value (when non-zero),
            // fall back to TMDB's per-episode `vote_average` looked up
            // from the season map.
            const cinemetaRating = (() => {
              if (v.rating == null) return null;
              const n = typeof v.rating === 'number' ? v.rating : Number.parseFloat(v.rating);
              return Number.isFinite(n) && n > 0 ? n : null;
            })();
            const episodeRating =
              cinemetaRating ??
              (episodeNumber != null ? episodeRatings?.[episodeNumber] ?? null : null);

            const isWatched = info.hasProgress || info.watched;
            return (
              <button
                key={v.id}
                type="button"
                className={
                  'block w-[90%] mx-auto cursor-pointer overflow-hidden rounded-xl text-left transition-transform duration-200 ease-out hover:scale-[1.03]'
                }
                onClick={() => onSelectVideo(v.id)}
              >
                <div
                  className="relative w-full overflow-hidden bg-white/5"
                  style={{ aspectRatio: '16 / 9' }}
                >
                  <EpisodeThumb src={thumb} fallback={fallbackPoster} />

                  {/* Rating top-left over the poster — matches the
                      MetaPanel style: no pill wrapper, just text + IMDB
                      logo with a drop shadow for legibility over the
                      thumbnail. */}
                  <Rating
                    initialRating={episodeRating}
                    iconClassName="h-7 w-7"
                    className="absolute left-2 top-2 z-20 gap-0.5 text-sm font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                  />

                  {/* Solid yellow "Watched" chip in the top-right
                      corner of the poster. */}
                  {isWatched ? (
                    <span className="absolute right-2 top-2 z-20 rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">
                      Watched
                    </span>
                  ) : null}

                  {/* Watch-progress bar across the bottom of the thumb. */}
                  {p > 0 ? (
                    <div className="absolute inset-x-0 bottom-0 z-10 h-1 bg-black/40">
                      <div
                        className="h-full bg-[var(--bliss-accent)]"
                        style={{ width: `${Math.max(2, p)}%` }}
                      />
                    </div>
                  ) : null}

                  {/* Bottom gradient + text. */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/65 to-transparent px-3 pb-3 pt-6">
                    <div className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                      {episodeNumber ? `${episodeNumber}. ` : ''}
                      {episodeTitle}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/80 drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                      {runtime ? <span>{runtime}</span> : null}
                      {released ? <span>{released}</span> : null}
                    </div>
                    {description ? (
                      <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/75 drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                        {description}
                      </div>
                    ) : null}
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
