import type { MediaItem } from '../types/media';
import MediaCard from './MediaCard';

type MediaGridProps = {
  items: MediaItem[];
};

export default function MediaGrid({ items }: MediaGridProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-white/15 bg-white/10 p-8 text-center backdrop-blur-xl dark:border-white/15 dark:bg-white/10">
        <div className="text-sm font-semibold">No titles yet</div>
        <div className="mt-1 text-sm text-foreground/60">
          Add more movies or series to fill this shelf.
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {items.map((item) => (
        <MediaCard key={item.id} item={item} />
      ))}
    </div>
  );
}
