import type { ReactNode } from 'react';
import type { MediaItem } from '../types/media';
import MediaCard from './MediaCard';

type MediaRailMobileProps = {
  title: string;
  items: MediaItem[];
  onSeeAll?: () => void;
  onItemPress?: (item: MediaItem) => void;
  actions?: ReactNode;
  dimmed?: boolean;
};

export default function MediaRailMobile({
  title,
  items,
  onSeeAll,
  onItemPress,
  actions,
  dimmed,
}: MediaRailMobileProps) {
  return (
    <section className={dimmed ? 'space-y-2 opacity-50' : 'space-y-2'}>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-foreground/90">{title}</h2>
          {actions}
        </div>
        {onSeeAll ? (
          <button
            type="button"
            className="text-xs text-foreground/70 hover:text-foreground/90 px-2 py-1"
            onClick={onSeeAll}
          >
            See All
          </button>
        ) : null}
      </div>

      {/* Horizontal scrollable rail with snap points */}
      <div className="overflow-x-auto overflow-y-hidden hide-scrollbar snap-x snap-mandatory scroll-smooth px-4">
        <div className="flex gap-2 pb-2">
          {items.map((item, index) => (
            <div 
              key={item.id} 
              className={`flex-shrink-0 snap-start ${index === 0 ? 'ml-0' : ''} ${index === items.length - 1 ? 'mr-2' : ''}`}
              style={{ width: '120px' }}
            >
              <MediaCard
                item={item}
                variant="poster"
                onPress={onItemPress ? () => onItemPress(item) : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
