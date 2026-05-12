import { Button } from '@heroui/react';
import type { ReactNode } from 'react';
import type { MediaItem } from '../types/media';
import MediaCard from './MediaCard';

type MediaGridRowProps = {
  title: string;
  items: MediaItem[];
  onSeeAll?: () => void;
  actions?: ReactNode;
  dimmed?: boolean;
};

export default function MediaGridRow({ title, items, onSeeAll, actions, dimmed }: MediaGridRowProps) {
  return (
    <section className={dimmed ? 'space-y-3 opacity-50' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground/90">{title}</h2>
          {actions}
        </div>
        {onSeeAll ? (
          <Button size="sm" variant="ghost" className="text-foreground/70" onPress={onSeeAll}>
            See All
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item) => (
          <MediaCard key={item.id} item={item} variant="poster" />
        ))}
      </div>
    </section>
  );
}
