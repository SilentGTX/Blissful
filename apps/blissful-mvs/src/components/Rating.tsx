import { ImdbIcon } from '../icons/ImdbIcon';
import { useImdbRating } from '../lib/useImdbRating';

type RatingProps = {
  /** IMDB id (tt-prefixed) used to fetch a rating + TMDB fallback. */
  imdbId?: string | null;
  /** Inline rating from the catalog/meta — used as the initial value
   *  while async lookup runs and as the displayed value if no IMDB id
   *  is provided (e.g. for per-episode ratings that Cinemeta ships
   *  directly on the video object). */
  initialRating?: number | string | null;
  /** Number of decimals to show. Defaults to 1. */
  decimals?: number;
  /** Extra classes for the wrapper. */
  className?: string;
  /** Tailwind classes for the IMDB logo (e.g. "h-4 w-4"). Defaults
   *  to the small inline-text size. */
  iconClassName?: string;
};

function parseRating(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  // Cinemeta ships "0" / 0 for episodes that don't have a rating — skip
  // rendering rather than showing a "0.0" chip.
  if (n <= 0) return null;
  return n;
}

// Global rating display — IMDB rating + IMDB logo next to it.
// Uses `useImdbRating` to fetch (IMDB scrape → TMDB fallback chain)
// when an `imdbId` is provided; otherwise displays `initialRating`
// directly (useful for per-episode ratings that Cinemeta ships on the
// video object — those are episode-specific and don't have their own
// scrapeable IMDB url).
export function Rating({
  imdbId,
  initialRating,
  decimals = 1,
  className,
  iconClassName = 'h-4 w-4',
}: RatingProps) {
  const seed = parseRating(initialRating);
  // Only fire the hook when we have a real tt-id to look up; otherwise
  // it skips the network call and just returns the seed value.
  const resolved = useImdbRating(imdbId ?? null, seed);
  const display = resolved ?? seed;
  if (display == null) return null;
  return (
    <span className={'inline-flex items-center gap-1 ' + (className ?? '')}>
      {/* `bliss-rating-value` (not `.label`) — HeroUI ships a global
          `.label` class that forces `font-size: var(--text-sm)`, weight
          500, and a fixed color, which silently overrides any classes
          callers pass via `className`. The legacy detail-page sizing
          rules (`.imdb-button-container-hTq0g .bliss-rating-value`) in
          index.css use this new name. */}
      <span className="bliss-rating-value">{display.toFixed(decimals)}</span>
      <ImdbIcon className={iconClassName + ' text-[#f5c518]'} />
    </span>
  );
}
