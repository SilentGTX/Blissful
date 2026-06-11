import type { MediaItem } from '../types/media';
import { BlissCard, BlissChip } from './base';
import { useEffect, useState } from 'react';
import { InfoIcon } from '../icons/InfoIcon';
import { PlayIcon } from '../icons/PlayIcon';
import { Rating } from './Rating';
import { TruncatedText } from './TruncatedText';
import { rememberClickedPoster } from '../lib/transitionPoster';
import { useGlitchText } from '../lib/useGlitchText';
import { proxiedImage } from '../lib/imageProxy';

type MediaCardProps = {
  item: MediaItem;
  variant?: 'poster' | 'details';
  selected?: boolean;
  progress?: number | null;
  onPress?: () => void;
  showHoverActions?: boolean;
  onPlay?: () => void;
  onInfo?: () => void;
};

export default function MediaCard({
  item,
  variant = 'details',
  selected = false,
  progress,
  onPress,
  showHoverActions = false,
  onPlay,
  onInfo,
}: MediaCardProps) {
  const imdbId = /^tt\d{5,}$/.test(item.id) ? item.id : null;
  const subtitle = [item.year, item.runtime].filter(Boolean).join(' \u00b7 ');

  const handlePlay = () => {
    if (onPlay) {
      onPlay();
      return;
    }
    if (onPress) onPress();
  };

  const handleInfo = () => {
    if (onInfo) {
      onInfo();
      return;
    }
    if (onPress) onPress();
  };

  // Per-card image-load tracking: poster fades in once the bitmap has
  // decoded, instead of popping in instantly the moment the browser is
  // ready to paint it. Eliminates the staggered "flash" you get on
  // /discover and /library when many posters load at different times.
  //
  // `retryNonce` drives auto-retry-on-error: when the browser's fetch
  // fails (CDN blip, 502 from metahub under load, etc.) the slot
  // would otherwise sit empty forever — the <img> element doesn't
  // re-fetch a failed src on its own. We retry with exponential
  // backoff up to 3 times, appending `_r=N` to bust any negative HTTP
  // cache, then fall back to the letter avatar if it's still dead.
  const POSTER_MAX_RETRIES = 3;
  // How long we wait for the <img> to fire EITHER onLoad or onError
  // before assuming the request is stalled. metahub under load + a
  // saturated H2 connection can park a request indefinitely (the
  // browser's <img> timeout is 30s+) without ever erroring — leaves
  // the card empty until the next page reload. After this many ms
  // with no resolution we flip `imgError` so the retry path below
  // fires with a fresh `_r=N` cache-buster, which forces the SW /
  // browser to open a new request.
  const POSTER_STALL_MS = 9000;
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
    // Reset when the underlying URL changes (e.g. catalog refilter).
    setImgLoaded(false);
    setImgError(false);
    setRetryNonce(0);
  }, [item.posterUrl]);
  useEffect(() => {
    if (!imgError || retryNonce >= POSTER_MAX_RETRIES) return;
    const delay = 800 * Math.pow(2, retryNonce); // 800ms, 1.6s, 3.2s
    const timer = window.setTimeout(() => {
      setImgError(false);
      setImgLoaded(false);
      setRetryNonce((n) => n + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [imgError, retryNonce]);
  // Stall detection: arms a timer whenever a fresh src is in flight
  // (no load yet, no error yet, and we still have retries left).
  // The timer fires `setImgError(true)` which kicks the retry effect
  // above. Cleared on load, on error, when src/retryNonce changes,
  // or on unmount.
  useEffect(() => {
    if (!item.posterUrl) return;
    if (imgLoaded || imgError) return;
    if (retryNonce >= POSTER_MAX_RETRIES) return;
    const timer = window.setTimeout(() => {
      setImgError(true);
    }, POSTER_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [item.posterUrl, imgLoaded, imgError, retryNonce]);

  const posterSrc = item.posterUrl
    ? retryNonce > 0
      ? `${item.posterUrl}${item.posterUrl.includes('?') ? '&' : '?'}_r=${retryNonce}`
      : item.posterUrl
    : null;
  const posterGaveUp = imgError && retryNonce >= POSTER_MAX_RETRIES;

  // Glitch the card label on hover. Only the visible string is
  // scrambled — `alt`, `aria-label`, etc keep the real title.
  const [isHovering, setIsHovering] = useState(false);
  const displayTitle = useGlitchText(item.title, isHovering);

  if (variant === 'poster') {
    const p = typeof progress === 'number' && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : null;
    const handlePosterClick = () => {
      rememberClickedPoster(item.type, item.id, item.posterUrl);
      if (onPress) onPress();
    };
    // The card frame (rating chip, title, fallback letter) is always
    // visible — only the poster image itself fades in once decoded.
    // The previous "fade the whole card in on imgLoaded" approach
    // left holes in the row whenever `onLoad` didn't propagate (busy
    // catalog rails, slow CDN, etc.): the wrapper stayed at opacity 0
    // but still occupied its grid slot.
    return (
      <div
        className="group/poster w-full"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <div
          className={
            'cursor-pointer touch-manipulation ' +
            (showHoverActions ? 'netflix-card-wrap' : '')
          }
          onClick={handlePosterClick}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
          }}
          onTouchEnd={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          role="button"
          tabIndex={onPress ? 0 : undefined}
          onKeyDown={onPress ? (e) => { if (e.key === 'Enter' || e.key === ' ') handlePosterClick(); } : undefined}
        >
          <BlissCard
            surface="poster"
            className={
              'group ' +
              (showHoverActions ? ' netflix-card' : '') +
              (selected ? 'solid-surface bg-white/10' : '')
            }
          >
            <BlissCard.Content className="p-0 overflow-hidden">
              <div className="relative poster-aspect overflow-hidden">
                {posterSrc && !posterGaveUp ? (
                  // Plain <img> — the motion.img + layoutId was carried
                  // over from the old card→detail FLIP morph, which is
                  // no longer wired up. Keeping motion around was
                  // delaying onLoad on some rails (image appeared
                  // broken until a hover-induced re-layout). `loading
                  // ="eager"` + `decoding="async"` ensures the browser
                  // fetches immediately but decodes off the main
                  // thread.
                  <img
                    src={proxiedImage(posterSrc)}
                    alt={`${item.title} poster`}
                    className="h-full w-full rounded-2xl object-cover transition-transform duration-300 group-hover:scale-110"
                    loading="eager"
                    decoding="async"
                    onLoad={() => setImgLoaded(true)}
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center rounded-2xl bg-white/10 text-3xl font-semibold">
                    {item.title.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <Rating
                  imdbId={imdbId}
                  initialRating={item.rating ?? null}
                  iconClassName="h-7 w-7"
                  className="absolute left-3 top-3 rounded-full bg-black/45 pl-2.5 pr-1.5 py-0.5 text-sm font-semibold text-white backdrop-blur"
                />

                {showHoverActions ? (
                  <div className="netflix-card-overlay">
                    <div className="netflix-card-actions">
                      <button
                        type="button"
                        className="netflix-action-btn netflix-action-btn-play"
                        aria-label="Play"
                        onClick={(event) => {
                          event.stopPropagation();
                          handlePlay();
                        }}
                      >
                        <PlayIcon size={16} />
                        <span>Play</span>
                      </button>
                      <button
                        type="button"
                        className="netflix-action-btn netflix-action-btn-info"
                        aria-label="Info"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleInfo();
                        }}
                      >
                        <InfoIcon size={16} />
                        <span>Info</span>
                      </button>
                    </div>
                  </div>
                ) : null}

                {p !== null && p > 0 ? (
                  <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10">
                    <div className="relative h-1.5 overflow-hidden rounded-full">
                      <div className="absolute inset-0 bg-black/35" />
                      <div className="absolute inset-y-0 left-0 bg-[var(--bliss-accent)]" style={{ width: `${p}%` }} />
                    </div>
                  </div>
                ) : null}
              </div>
            </BlissCard.Content>
          </BlissCard>
        </div>
        {/* Title scales with viewport width so it stays readable at
            TV viewing distance. min-h tracks the font size so the
            card height still stays constant whether the title wraps
            to one line or two. Tooltip surfaces the full title when
            it's clamped (the visible text is the hover-glitch render,
            but the tooltip always shows the real title). */}
        <TruncatedText
          content={item.title}
          display={displayTitle}
          className="mt-3 min-h-[2.75em] text-center font-medium text-foreground/90 line-clamp-2 transition-colors duration-500 ease-out group-hover/poster:text-[var(--bliss-accent)] text-[clamp(0.8125rem,0.9vw,1.375rem)] leading-snug"
        />
      </div>
    );
  }

  return (
    <div
      className={onPress ? 'cursor-pointer' : ''}
      onClick={onPress}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      role="button"
      tabIndex={onPress ? 0 : undefined}
      onKeyDown={onPress ? (e) => { if (e.key === 'Enter' || e.key === ' ') onPress(); } : undefined}
    >
      <BlissCard
        surface="panel"
        className={
          'group ' +
          'hover:border-white hover:shadow-[0_0_25px_rgba(255,255,255,0.3),0_0_50px_rgba(255,255,255,0.15),inset_0_0_20px_rgba(255,255,255,0.1)] hover:bg-white/10 ' +
          (selected
            ? 'solid-surface border-white shadow-[0_0_25px_rgba(255,255,255,0.3),0_0_50px_rgba(255,255,255,0.15),inset_0_0_20px_rgba(255,255,255,0.1)] bg-white/10'
            : '')
        }
      >
        <BlissCard.Content className="p-3">
          <div className="relative overflow-hidden rounded-2xl">
            {posterSrc && !posterGaveUp ? (
              <img
                src={proxiedImage(posterSrc)}
                alt={`${item.title} poster`}
                className="h-[260px] w-full object-cover transition-transform duration-300 group-hover:scale-110"
                decoding="async"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="grid h-[260px] w-full place-items-center bg-white/10 text-3xl font-semibold">
                {item.title.slice(0, 1).toUpperCase()}
              </div>
            )}
            <Rating
              imdbId={imdbId}
              initialRating={item.rating ?? null}
              iconClassName="h-7 w-7"
              className="absolute right-3 top-3 rounded-full bg-black/45 pl-2.5 pr-1.5 py-0.5 text-sm font-semibold text-white backdrop-blur"
            />
          </div>

          <div className="mt-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <TruncatedText
                content={item.title}
                display={displayTitle}
                className="truncate text-sm font-semibold"
              />
              {subtitle ? <div className="mt-0.5 text-xs text-foreground/60">{subtitle}</div> : null}
            </div>
            <BlissChip variant="soft" className="shrink-0 capitalize">
              {item.type}
            </BlissChip>
          </div>

          {item.blurb ? <div className="mt-2 line-clamp-2 text-xs text-foreground/75">{item.blurb}</div> : null}

          {item.genres && item.genres.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.genres.slice(0, 3).map((genre) => (
                <BlissChip key={`${item.id}-${genre}`} variant="secondary">
                  {genre}
                </BlissChip>
              ))}
            </div>
          ) : null}
        </BlissCard.Content>
      </BlissCard>
    </div>
  );
}
