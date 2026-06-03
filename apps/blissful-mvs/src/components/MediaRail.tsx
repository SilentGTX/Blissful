import { Button, ScrollShadow } from '@heroui/react';
import type { ReactNode } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../types/media';
import MediaCard from './MediaCard';
import { ChevronLeftIcon } from '../icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../icons/ChevronRightIcon';
import { FocusableButton } from '../spatial/FocusableButton';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { isTvMode } from '../lib/platform';

type MediaRailProps = {
  title: string;
  items: MediaItem[];
  onSeeAll?: () => void;
  onItemPress?: (item: MediaItem) => void;
  actions?: ReactNode;
  dimmed?: boolean;
  noScroll?: boolean;
  className?: string;
  variant?: 'default' | 'netflix';
  showHoverActions?: boolean;
  onPlay?: (item: MediaItem) => void;
  onInfo?: (item: MediaItem) => void;
  /** TV: let the first card claim D-pad focus on mount. Default true (so
   *  Discover/Library route-entry still works); HomePage passes false so the
   *  hero "Watch now" is the single deterministic entry focusable. */
  autoFocusFirst?: boolean;
  /** TV: focusKey that UP from any card in this rail jumps to (used by the TOP
   *  home rail to route UP back onto the hero "Watch now"). */
  upFocusKey?: string;
};

export default function MediaRail({
  title,
  items,
  onSeeAll,
  onItemPress,
  actions,
  dimmed,
  noScroll,
  className,
  variant = 'default',
  showHoverActions = false,
  onPlay,
  onInfo,
  autoFocusFirst = true,
  upFocusKey,
}: MediaRailProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [cardWidth, setCardWidth] = useState(200);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const isNetflix = variant === 'netflix';

  // TV (classic noScroll rails): make THIS rail a Norigin focus CONTAINER so its
  // cards register with parentFocusKey = railFocusKey instead of the global ROOT.
  // Without it, every card on the home screen is a ROOT sibling, and Norigin
  // force-reflows ALL of them (~234) on every D-pad press — the ~200ms-per-press
  // lag on a low-end A53. With the container, a left/right move only measures
  // this rail's ~15 cards. Mirrors NetflixRow. Inert off-TV / non-noScroll.
  const tvRail = isTvMode() && !!noScroll && !isNetflix;
  const { ref: railRef, focusKey: railFocusKey } = useFocusable({
    focusable: tvRail,
    trackChildren: true,
    saveLastFocusedChild: true,
  });

  // De-duplicate by id. The same title can legitimately arrive twice (e.g. a
  // Stremio<->Blissful library sync that produced two entries for one id, or
  // overlapping catalog rows). Rendering two children with the same React key
  // corrupts reconciliation AND the Norigin focusable registry (nodes get
  // duplicated/omitted, leaving refs pointing at stale/missing DOM), which
  // breaks D-pad navigation. Keep the first occurrence of each id.
  const uniqueItems = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((it) => {
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    });
  }, [items]);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element || noScroll || isNetflix) return;

    const gap = 20;
    const target = 200;

    const update = () => {
      const width = element.clientWidth;
      if (!width) return;
      const count = Math.max(1, Math.floor((width + gap) / (target + gap)));
      const nextWidth = (width - gap * (count - 1)) / count;
      setCardWidth(nextWidth);
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => observer.disconnect();
  }, [isNetflix, noScroll]);

  useLayoutEffect(() => {
    if (!isNetflix) return;
    const scroller = scrollRef.current;
    if (!scroller) return;

    const update = () => {
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      setCanScrollLeft(scroller.scrollLeft > 8);
      setCanScrollRight(scroller.scrollLeft < maxScroll - 8);
    };

    update();
    scroller.addEventListener('scroll', update);
    const observer = new ResizeObserver(update);
    observer.observe(scroller);

    return () => {
      scroller.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [isNetflix]);

  const scrollByAmount = (direction: 'left' | 'right') => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const delta = Math.max(240, Math.floor(scroller.clientWidth * 0.8));
    scroller.scrollBy({ left: direction === 'left' ? -delta : delta, behavior: 'smooth' });
  };

  return (
    <section className={dimmed ? 'space-y-3 opacity-50' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="tv-rail-title text-lg font-semibold tracking-tight text-foreground/90">{title}</h2>
          {actions}
        </div>
        {onSeeAll ? (
          isTvMode() ? (
            // FocusableButton so the rail header is D-pad reachable on TV.
            <FocusableButton
              className="rounded-full px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground"
              onPress={onSeeAll}
            >
              See All
            </FocusableButton>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-foreground/70"
              onPress={onSeeAll}
            >
              See All
            </Button>
          )
        ) : null}
      </div>

      {isNetflix ? (
        <div className="netflix-rail-wrapper">
          <button
            type="button"
            className={
              'netflix-rail-arrow netflix-rail-arrow-left ' +
              (canScrollLeft ? '' : 'is-hidden')
            }
            aria-label="Scroll left"
            onClick={() => scrollByAmount('left')}
          >
            <ChevronLeftIcon className="h-[18px] w-[18px]" />
          </button>
          <div ref={scrollRef} className="netflix-rail hide-scrollbar">
            {uniqueItems.map((item) => (
              <div key={item.id} className="netflix-rail-item">
                <MediaCard
                  item={item}
                  variant="poster"
                  showHoverActions={showHoverActions}
                  onPress={onItemPress ? () => onItemPress(item) : undefined}
                  onPlay={onPlay ? () => onPlay(item) : undefined}
                  onInfo={onInfo ? () => onInfo(item) : undefined}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className={
              'netflix-rail-arrow netflix-rail-arrow-right ' +
              (canScrollRight ? '' : 'is-hidden')
            }
            aria-label="Scroll right"
            onClick={() => scrollByAmount('right')}
          >
            <ChevronRightIcon className="h-[18px] w-[18px]" />
          </button>
        </div>
      ) : noScroll ? (
        // On TV, wrap the cards in this rail's FocusContext so they become its
        // children (parentFocusKey = railFocusKey) — the per-keypress reflow then
        // scans ~15 cards, not all ~234. Off-TV the provider value is an empty
        // key and behaves exactly as before.
        <FocusContext.Provider value={tvRail ? railFocusKey : ''}>
          <div ref={tvRail ? railRef : rowRef} className={className ?? ''}>
            {uniqueItems.map((item, i) => (
              <div key={item.id} className="board-item">
                <MediaCard
                  item={item}
                  variant="poster"
                  autoFocusTv={autoFocusFirst && i === 0}
                  upFocusKey={upFocusKey}
                  // Stable item-handler (not a per-card closure) so memo'd cards
                  // skip re-render when a sibling gains focus — see MediaCard.
                  onItemPress={onItemPress}
                />
              </div>
            ))}
          </div>
        </FocusContext.Provider>
      ) : (
        <ScrollShadow
          orientation="horizontal"
          className="-mx-4"
          hideScrollBar
          size={80}
        >
          <div ref={rowRef} className="flex gap-5 px-4 pb-2">
            {uniqueItems.map((item, i) => (
              <div key={item.id} style={{ width: `${cardWidth}px` }}>
                <MediaCard
                  item={item}
                  variant="poster"
                  autoFocusTv={autoFocusFirst && i === 0}
                  onPress={onItemPress ? () => onItemPress(item) : undefined}
                />
              </div>
            ))}
          </div>
        </ScrollShadow>
      )}
    </section>
  );
}
