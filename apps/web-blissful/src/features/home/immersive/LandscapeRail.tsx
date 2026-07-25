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
      <div className="mb-3 flex items-center justify-between pr-8 pl-5">
        <h2 className="bliss-rail-title">{title}</h2>
        <div className="flex items-center gap-2">
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
