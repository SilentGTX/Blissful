// One 16:9 landscape episode card for the TV detail page's bottom EPISODES
// rail. Reuses EpisodePanel's image-fallback chain (EpisodeThumb) + Rating;
// title + runtime/date/IMDb sit BELOW the thumbnail (image-30 style). Own
// useTvFocusable with a horizontal-rail scroll override (inline:'center').

import { Rating } from '../../../components/Rating';
import { EpisodeThumb } from '../components/EpisodePanel';
import { useTvFocusable } from '../../../spatial/useTvFocusable';
import { isAndroidTv } from '../../../lib/platform';

export type EpisodeVideo = {
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
};

type Props = {
  video: EpisodeVideo;
  episodeRatings?: Record<number, number>;
  episodeStills?: Record<number, string>;
  episodeStillsPending?: boolean;
  fallbackPoster?: string | null;
  showRuntime?: string | null;
  normalizeImage: (value?: string | null) => string | null | undefined;
  formatDate: (value?: string) => string | null;
  getEpisodeTitle: (video: { title?: string; name?: string; id: string }) => string;
  getEpisodeProgressInfo: (id: string) => { percent: number; hasProgress: boolean; watched: boolean };
  onPress: () => void;
  autoFocus?: boolean;
  /** Stable Norigin focusKey (e.g. `tv-ep-<videoId>`) so the detail page can
   *  setFocus this card once the async next-to-watch decode resolves. */
  focusKey?: string;
};

export function TvEpisodeCard({
  video: v,
  episodeRatings,
  episodeStills,
  episodeStillsPending,
  fallbackPoster,
  showRuntime,
  normalizeImage,
  formatDate,
  getEpisodeTitle,
  getEpisodeProgressInfo,
  onPress,
  autoFocus,
  focusKey,
}: Props) {
  const { ref } = useTvFocusable({
    onPress,
    autoFocus,
    focusKey,
    // Center the focused card in the horizontal rail (the hook default
    // inline:'nearest' is wrong for a row that scrolls sideways).
    onFocus: () => ref.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: isAndroidTv() ? 'instant' : 'smooth' }),
  });

  const thumb = normalizeImage(v.thumbnail ?? undefined);
  const info = getEpisodeProgressInfo(v.id);
  const p = info.percent;
  const released = formatDate(v.released ?? undefined);
  const episodeTitle = getEpisodeTitle(v);
  const episodeNumber =
    typeof v.episode === 'number' ? v.episode : typeof v.number === 'number' ? v.number : null;
  const runtime = v.runtime ?? showRuntime ?? null;
  const cinemetaRating = (() => {
    if (v.rating == null) return null;
    const n = typeof v.rating === 'number' ? v.rating : Number.parseFloat(v.rating);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const episodeRating =
    cinemetaRating ?? (episodeNumber != null ? episodeRatings?.[episodeNumber] ?? null : null);
  const isWatched = info.hasProgress || info.watched;

  return (
    <button ref={ref} type="button" className="tv-episode-card tv-focusable-card" onClick={onPress}>
      <div className="tv-episode-thumb relative w-full overflow-hidden bg-white/5" style={{ aspectRatio: '16 / 9' }}>
        <EpisodeThumb
          key={thumb ?? 'no-thumb'}
          thumb={thumb}
          still={episodeNumber != null ? episodeStills?.[episodeNumber] ?? null : null}
          poster={fallbackPoster}
          stillPending={episodeStillsPending}
        />
        {isWatched ? (
          <span className="absolute right-2 top-2 z-20 rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">
            Watched
          </span>
        ) : null}
        <span className="tv-episode-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="8,5 20,12 8,19" />
          </svg>
        </span>
        {episodeRating != null ? (
          <div className="tv-episode-imdb">
            <Rating initialRating={episodeRating} className="tv-episode-rating" iconClassName="h-4 w-4" />
          </div>
        ) : null}
        {p > 0 ? (
          <div className="absolute inset-x-0 bottom-0 z-10 h-1 bg-black/40">
            <div className="h-full bg-[var(--bliss-accent)]" style={{ width: `${Math.max(2, p)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="tv-episode-card-meta">
        <div className="tv-episode-card-title">
          {episodeNumber ? `${episodeNumber}. ` : ''}
          {episodeTitle}
        </div>
        <div className="tv-episode-card-sub">
          {runtime ? <span>{runtime}</span> : null}
          {released ? <span>{released}</span> : null}
        </div>
      </div>
    </button>
  );
}
