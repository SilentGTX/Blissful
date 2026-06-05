import type { MediaItem } from '../types/media';
import { Card, Chip } from '@heroui/react';
import { memo, useEffect, useState } from 'react';
import { InfoIcon } from '../icons/InfoIcon';
import { ImdbIcon } from '../icons/ImdbIcon';
import { PlayIcon } from '../icons/PlayIcon';
import { TruncatedText } from './TruncatedText';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useImdbRating } from '../lib/useImdbRating';
import { useTvFocusable } from '../spatial/useTvFocusable';
import { MediaCardMenu } from './MediaCardMenu';
import { isTvMode } from '../lib/platform';
import { tvPosterUrl } from '../lib/tvPosterUrl';

type MediaCardProps = {
  item: MediaItem;
  variant?: 'poster' | 'details';
  selected?: boolean;
  progress?: number | null;
  onPress?: () => void;
  /** Stable alternative to `onPress`: receives the item, so the rail can pass
   *  ONE stable function instead of a fresh `() => onItemPress(item)` closure
   *  per card per render. With React.memo this lets a rail-level re-render
   *  (Norigin saveLastFocusedChild fires one on every focus move) skip every
   *  card except the two whose focus actually changed — the core TV nav win. */
  onItemPress?: (item: MediaItem) => void;
  showHoverActions?: boolean;
  onPlay?: () => void;
  onInfo?: () => void;
  /** Claim D-pad focus on mount (route-entry first card) on TV. */
  autoFocusTv?: boolean;
  /** TV: focusKey to jump to when pressing UP from this card (e.g. the hero
   *  "Watch now" from the top home rail, which geometry otherwise misses). */
  upFocusKey?: string;
  /** Fired when the card gains D-pad/keyboard focus or mouse hover — used by
   *  Discover to live-preview the focused title in the side panel. */
  onFocus?: () => void;
  /** Stable alternative to `onFocus`: receives the item, same contract as
   *  `onItemPress` — the grid passes ONE stable function instead of a fresh
   *  `() => onFocus(item)` closure per card per render, so React.memo can
   *  skip every card whose focus didn't change on a D-pad move. */
  onItemFocus?: (item: MediaItem) => void;
};

function formatRating(rating?: number) {
  if (rating === undefined || Number.isNaN(rating)) return null;
  return rating.toFixed(1);
}

function MediaCard({
  item,
  variant = 'details',
  selected = false,
  progress,
  onPress: onPressProp,
  onItemPress,
  showHoverActions = false,
  onPlay,
  onInfo,
  autoFocusTv,
  upFocusKey,
  onFocus,
  onItemFocus,
}: MediaCardProps) {
  // Resolve a single press handler. Prefer explicit `onPress`; else build it
  // from the stable item-based `onItemPress` (so the rail passes ONE stable
  // function and React.memo can skip non-focused cards). All `onPress`
  // references below are unchanged.
  const onPress = onPressProp ?? (onItemPress ? () => onItemPress(item) : undefined);
  // Same resolution for focus (see `onItemFocus` prop docs).
  const handleFocus = onFocus ?? (onItemFocus ? () => onItemFocus(item) : undefined);
  // TV: do NOT lazy-scrape IMDB ratings per card. On the home screen that
  // fires a burst of dozens of proxied imdb.com/Cinemeta fetches (one per
  // card with no addon-supplied rating) the instant the grid mounts, each
  // resolving with a setState re-render — a network + render storm competing
  // with poster decode on a weak TV. Neutralize the id on TV (hook still
  // called unconditionally — Rules of Hooks); the pill still shows for cards
  // whose addon meta already carried a rating.
  const imdbId = !isTvMode() && /^tt\d{5,}$/.test(item.id) ? item.id : null;
  const resolvedRating = useImdbRating(imdbId, item.rating ?? null);
  // TV D-pad focus (inert on desktop/browser — mouse onClick still works).
  const [menuOpen, setMenuOpen] = useState(false);
  const { ref: tvRef } = useTvFocusable({
    onPress,
    onFocus: handleFocus,
    // TV: holding OK opens a quick-actions menu (Open / Library / mark watched);
    // a short tap still fires onPress (navigate). Only for interactive cards.
    onLongPress: onPress ? () => setMenuOpen(true) : undefined,
    focusable: Boolean(onPress),
    autoFocus: Boolean(autoFocusTv),
    onArrowPress: upFocusKey
      ? (dir) => {
          // Force UP onto the hero; return false to skip Norigin's geometric
          // move (which would land on the wide pinned search bar instead).
          if (dir === 'up') {
            setFocus(upFocusKey);
            return false;
          }
          return true;
        }
      : undefined,
  });
  const rating = formatRating(resolvedRating ?? undefined);
  const subtitle = [item.year, item.runtime].filter(Boolean).join(' \u00b7 ');

  // Auto-retry posters on error/stall. The <img> element doesn't
  // re-fetch a failed src on its own, so without this a single CDN
  // blip from metahub leaves the card with the letter fallback
  // forever. We retry up to 3 times with exponential backoff,
  // appending `_r=N` to bust any negative HTTP cache. `imgLoaded`
  // is tracked only so the stall timer can self-disarm \u2014 it does
  // NOT gate visibility (poster renders progressively as bytes
  // arrive, no opacity fade-in).
  const POSTER_MAX_RETRIES = 3;
  // 9s of no onLoad/onError = assume stalled. metahub under load can
  // park a request indefinitely without ever erroring; this kicks the
  // retry path with a fresh `_r=N` cache-buster so the SW / browser
  // opens a new request.
  const POSTER_STALL_MS = 9000;
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
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
  useEffect(() => {
    if (!item.posterUrl) return;
    if (imgLoaded || imgError) return;
    if (retryNonce >= POSTER_MAX_RETRIES) return;
    const timer = window.setTimeout(() => {
      setImgError(true);
    }, POSTER_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [item.posterUrl, imgLoaded, imgError, retryNonce]);

  // On TV, downscale metahub posters to the "small" variant (pixel-matched to the
  // ~144px card, ~10x fewer decoded bytes) — big graphics-memory win on low-end
  // GLES2 TVs. No-op on desktop / for non-metahub URLs.
  const basePosterUrl = isTvMode() ? tvPosterUrl(item.posterUrl) : item.posterUrl;
  const posterSrc = basePosterUrl
    ? retryNonce > 0
      ? `${basePosterUrl}${basePosterUrl.includes('?') ? '&' : '?'}_r=${retryNonce}`
      : basePosterUrl
    : null;
  // Lazy-load posters on TV so off-screen / hidden rail cards don't all decode up
  // front into the constrained RAM. Desktop keeps eager for instant hover.
  const posterLoading = isTvMode() ? 'lazy' : 'eager';
  const posterGaveUp = imgError && retryNonce >= POSTER_MAX_RETRIES;

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

  // Hold-OK quick-actions menu (TV only; portaled, so placement is irrelevant).
  const cardMenu = menuOpen ? (
    <MediaCardMenu item={item} onClose={() => setMenuOpen(false)} />
  ) : null;

  if (variant === 'poster') {
    const p = typeof progress === 'number' && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : null;
    return (
      <div className="group/poster w-full">
        <div
          ref={tvRef}
          className={
            'cursor-pointer touch-manipulation tv-focusable-card ' +
            (showHoverActions ? 'netflix-card-wrap' : '')
          }
          onClick={onPress}
          onMouseEnter={handleFocus}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
          }}
          onTouchEnd={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          role="button"
          tabIndex={onPress ? 0 : undefined}
          onKeyDown={onPress ? (e) => { if (e.key === 'Enter' || e.key === ' ') onPress(); } : undefined}
        >
          <Card
            className={
              'group rounded-2xl p-0 shadow-[0_18px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl border-0 ' +
              (showHoverActions ? ' netflix-card' : '') +
              (selected ? 'solid-surface bg-white/10' : '')
            }
          >
            <Card.Content className="p-0 overflow-hidden">
              <div className="relative poster-aspect overflow-hidden">
                {posterSrc && !posterGaveUp ? (
                  <img
                    src={posterSrc}
                    alt={`${item.title} poster`}
                    className="h-full w-full rounded-2xl object-cover transition-transform duration-300 group-hover:scale-110"
                    loading={posterLoading}
                    decoding="async"
                    onLoad={() => setImgLoaded(true)}
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center rounded-2xl bg-white/10 text-3xl font-semibold">
                    {item.title.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {rating ? (
                  <div className="media-card-imdb absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-sm font-semibold text-white backdrop-blur">
                    <span>{rating}</span>
                    <ImdbIcon className="h-6 w-6 text-[#f5c518]" />
                  </div>
                ) : null}

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
            </Card.Content>
          </Card>
        </div>
        {/* min-h reserves space for exactly 2 lines of text-sm (20px line-
            height × 2 = 2.5rem) so card height stays constant whether the
            title wraps to 1 or 2 lines — prevents row reflow as titles
            load asynchronously across the grid. */}
        <TruncatedText
          content={item.title}
          className="tv-card-title mt-3 min-h-[2.5rem] text-center text-sm font-medium text-foreground/90 line-clamp-2 transition-colors duration-500 ease-out group-hover/poster:text-[var(--bliss-accent)]"
        />
        {cardMenu}
      </div>
    );
  }

  return (
    <div
      ref={tvRef}
      className={(onPress ? 'cursor-pointer ' : '') + 'tv-focusable-card'}
      onClick={onPress}
      role="button"
      tabIndex={onPress ? 0 : undefined}
      onKeyDown={onPress ? (e) => { if (e.key === 'Enter' || e.key === ' ') onPress(); } : undefined}
    >
      <Card
        className={
          'group rounded-2xl shadow-[0_18px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl border border-white/10 ' +
          'hover:border-white hover:shadow-[0_0_25px_rgba(255,255,255,0.3),0_0_50px_rgba(255,255,255,0.15),inset_0_0_20px_rgba(255,255,255,0.1)] hover:bg-white/10 ' +
          (selected
            ? 'solid-surface border-white shadow-[0_0_25px_rgba(255,255,255,0.3),0_0_50px_rgba(255,255,255,0.15),inset_0_0_20px_rgba(255,255,255,0.1)] bg-white/10'
            : '')
        }
      >
        <Card.Content className="p-3">
          <div className="relative overflow-hidden rounded-2xl">
            {posterSrc && !posterGaveUp ? (
              <img
                src={posterSrc}
                alt={`${item.title} poster`}
                className="h-[260px] w-full object-cover transition-transform duration-300 group-hover:scale-110"
                loading={posterLoading}
                decoding="async"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="grid h-[260px] w-full place-items-center bg-white/10 text-3xl font-semibold">
                {item.title.slice(0, 1).toUpperCase()}
              </div>
            )}
            {rating ? (
              <div className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-sm font-semibold text-white backdrop-blur">
                <span>{rating}</span>
                <ImdbIcon className="h-6 w-6 text-[#f5c518]" />
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <TruncatedText content={item.title} className="truncate text-sm font-semibold" />
              {subtitle ? <div className="mt-0.5 text-xs text-foreground/60">{subtitle}</div> : null}
            </div>
            <Chip size="sm" variant="soft" className="shrink-0 capitalize">
              {item.type}
            </Chip>
          </div>

          {item.blurb ? <div className="mt-2 line-clamp-2 text-xs text-foreground/75">{item.blurb}</div> : null}

          {item.genres && item.genres.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.genres.slice(0, 3).map((genre) => (
                <Chip key={`${item.id}-${genre}`} size="sm" variant="secondary">
                  {genre}
                </Chip>
              ))}
            </div>
          ) : null}
        </Card.Content>
      </Card>
      {cardMenu}
    </div>
  );
}

// Memoized: with stable props (notably the item-based `onItemPress` the rails
// now pass) a rail-level re-render — Norigin fires one on every focus move via
// saveLastFocusedChild — skips every card except the two whose focus changed,
// instead of re-rendering all ~14 heavy cards in the rail. Default shallow
// prop compare is correct here (item is a stable ref, handlers are stable).
export default memo(MediaCard);
