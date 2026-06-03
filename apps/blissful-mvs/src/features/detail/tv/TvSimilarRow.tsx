// "You may also like" row for the TV movie detail page — a thin wrapper over the
// existing MediaRail (poster cards already have full TV focus + poster-retry).
// Renders nothing unless there are enough items to be worth a row.

import MediaRail from '../../../components/MediaRail';
import type { MediaItem } from '../../../types/media';

type Props = {
  items: MediaItem[];
  onItemPress: (item: MediaItem) => void;
};

export function TvSimilarRow({ items, onItemPress }: Props) {
  if (items.length < 4) return null;
  return (
    <div className="tv-similar-row">
      <MediaRail
        title="You may also like"
        items={items}
        onItemPress={onItemPress}
        noScroll
        className="board-row-poster"
        autoFocusFirst={false}
      />
    </div>
  );
}
