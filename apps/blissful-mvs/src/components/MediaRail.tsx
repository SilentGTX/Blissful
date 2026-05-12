import { Button, ScrollShadow } from '@heroui/react';
import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { MediaItem } from '../types/media';
import MediaCard from './MediaCard';
import { ChevronLeftIcon } from '../icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../icons/ChevronRightIcon';

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
}: MediaRailProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [cardWidth, setCardWidth] = useState(200);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const isNetflix = variant === 'netflix';

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
          <h2 className="text-lg font-semibold tracking-tight text-foreground/90">{title}</h2>
          {actions}
        </div>
        {onSeeAll ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-foreground/70"
            onPress={onSeeAll}
          >
            See All
          </Button>
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
            {items.map((item) => (
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
        <div ref={rowRef} className={className ?? ''}>
          {items.map((item) => (
            <div key={item.id} className="board-item">
              <MediaCard
                item={item}
                variant="poster"
                onPress={onItemPress ? () => onItemPress(item) : undefined}
              />
            </div>
          ))}
        </div>
      ) : (
        <ScrollShadow
          orientation="horizontal"
          className="-mx-4"
          hideScrollBar
          size={80}
        >
          <div ref={rowRef} className="flex gap-5 px-4 pb-2">
            {items.map((item) => (
              <div key={item.id} style={{ width: `${cardWidth}px` }}>
                <MediaCard
                  item={item}
                  variant="poster"
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
