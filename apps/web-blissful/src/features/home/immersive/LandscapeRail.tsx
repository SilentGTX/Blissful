import { memo, useCallback, useRef } from 'react';
import { proxiedImage } from '../../../lib/imageProxy';
import type { MediaItem } from '../../../types/media';
import { landscapeArt } from './ImmersiveBackdrop';

/** One 16:9 tile — port of the TV app's PosterCard `landscape` variant, with
 *  the title inside over the bottom scrim (the Home placement). */
const LandscapeTile = memo(function LandscapeTile({
  item,
  progress,
  onHover,
  onOpen,
}: {
  item: MediaItem;
  progress?: number;
  onHover: (item: MediaItem) => void;
  onOpen: (item: MediaItem) => void;
}) {
  const art = landscapeArt(item.posterUrl);
  return (
    <button
      type="button"
      className="bliss-tile"
      data-testid="bliss-tile"
      title={item.title}
      onMouseEnter={() => onHover(item)}
      onFocus={() => onHover(item)}
      onClick={() => onOpen(item)}
    >
      {art ? (
        <img src={proxiedImage(art)} alt="" className="bliss-tile-art" draggable={false} loading="lazy" />
      ) : null}
      <span className="bliss-tile-scrim" />
      {progress != null && progress > 0 ? (
        <span className="bliss-tile-progress">
          <span style={{ width: `${Math.min(100, progress)}%` }} />
        </span>
      ) : null}
      <span className="bliss-tile-title">{item.title}</span>
    </button>
  );
});

/** Grid cell: the same 16:9 tile with the title BELOW, left-aligned — the TV's
 *  `titlePlacement="below"` content-grid layout (Discover / Library / Search).
 *  `selected` mirrors the TV's focused ring for the card the preview pane is
 *  currently showing, which on the TV is always the focused one. */
export const LandscapeGridCard = memo(function LandscapeGridCard({
  item,
  progress,
  selected,
  onHover,
  onOpen,
}: {
  item: MediaItem;
  progress?: number;
  selected?: boolean;
  onHover?: (item: MediaItem) => void;
  onOpen: (item: MediaItem) => void;
}) {
  const art = landscapeArt(item.posterUrl);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        className={selected ? 'bliss-tile is-selected' : 'bliss-tile'}
        data-testid="bliss-tile"
        title={item.title}
        onMouseEnter={onHover ? () => onHover(item) : undefined}
        onFocus={onHover ? () => onHover(item) : undefined}
        onClick={() => onOpen(item)}
      >
        {art ? (
          <img src={proxiedImage(art)} alt="" className="bliss-tile-art" draggable={false} loading="lazy" />
        ) : null}
        {progress != null && progress > 0 ? (
          <span className="bliss-tile-progress">
            <span style={{ width: `${Math.min(100, progress)}%` }} />
          </span>
        ) : null}
      </button>
      <div className="bliss-tile-title-below">{item.title}</div>
    </div>
  );
});

/** A titled horizontal rail of landscape tiles — port of the TV app's
 *  `LandscapeRail`. The TV focus-scrolls with the D-pad; here the pointer
 *  scrolls the rail, with arrow buttons for the trackpad-less case. */
export const LandscapeRail = memo(function LandscapeRail({
  title,
  items,
  progressById,
  onHover,
  onOpen,
  onSeeAll,
}: {
  title: string;
  items: MediaItem[];
  progressById?: Record<string, number>;
  onHover: (item: MediaItem) => void;
  onOpen: (item: MediaItem) => void;
  onSeeAll?: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const nudge = useCallback((dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Roughly one screenful, so a click never leaves a tile half-shown.
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.8), behavior: 'smooth' });
  }, []);

  if (!items.length) return null;

  return (
    <section className="mb-8">
      <div className="group/rail mb-3 flex items-center justify-between pr-8 pl-5">
        <h2 className="bliss-rail-title">{title}</h2>
        {/* The TV rail has no arrows (D-pad scrolls it). Keep them for the
            mouse, but only once the pointer is on the rail, so at rest the
            header looks like the TV's. */}
        <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover/rail:opacity-100 focus-within:opacity-100">
          {onSeeAll ? (
            <button type="button" className="bliss-chip" onClick={onSeeAll}>
              See all
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`Scroll ${title} left`}
            className="bliss-chip"
            onClick={() => nudge(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={`Scroll ${title} right`}
            className="bliss-chip"
            onClick={() => nudge(1)}
          >
            ›
          </button>
        </div>
      </div>
      <div className="relative">
        <div className="bliss-rail-scroller" ref={scrollerRef}>
          {items.map((item) => (
            <LandscapeTile
              key={`${item.type}:${item.id}`}
              item={item}
              progress={progressById?.[item.id]}
              onHover={onHover}
              onOpen={onOpen}
            />
          ))}
        </div>
        <div className="bliss-rail-fade" />
      </div>
    </section>
  );
});
