import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { ErrorBoundary, ErrorRow } from '../../../components/ErrorBoundary';
import { SkeletonHomeRow } from '../../../components/Skeleton';
import type { MediaItem } from '../../../types/media';
import { ImmersiveBackdrop, ImmersiveInfoPanel } from './ImmersiveBackdrop';
import { LandscapeRail } from './LandscapeRail';
import { useHoveredMeta } from './useHoveredMeta';

/** The TV app names these rows "Popular Movies" / "Popular Series"; Classic
 *  uses its own "Popular - Movie" wording, so remap here rather than upstream. */
const TV_ROW_TITLES: Record<string, string> = {
  'Popular - Movie': 'Popular Movies',
  'Popular - Series': 'Popular Series',
};

export type ImmersiveRow = {
  id: string;
  title: string;
  items: MediaItem[];
};

/** The TV app's immersive Home (HomeScreen.tsx), driven by the pointer instead
 *  of the D-pad: a full-bleed backdrop + featured panel that follow the hovered
 *  tile, over a band of landscape-tile rails. */
export function ImmersiveHomePage({
  rows,
  continueItems,
  continueProgress,
  movieItems,
  seriesItems,
  loading,
  hiddenRowIds,
  homeEditMode,
  onToggleRowVisibility,
  onSeeAll,
  onItemClick,
}: {
  rows: ImmersiveRow[];
  continueItems: MediaItem[];
  continueProgress: Record<string, number>;
  movieItems: MediaItem[];
  seriesItems: MediaItem[];
  loading: boolean;
  hiddenRowIds: string[];
  homeEditMode: boolean;
  onToggleRowVisibility: (id: string) => void;
  onSeeAll: (row: ImmersiveRow) => void;
  onItemClick: (item: MediaItem) => void;
}) {
  const [hovered, setHovered] = useState<MediaItem | null>(null);

  // Feature something as soon as there is anything to feature, so the backdrop
  // and panel arrive populated instead of waiting for the first hover (the meta
  // fetch is keyed off this state).
  useEffect(() => {
    if (hovered) return;
    const first = continueItems[0] ?? movieItems[0] ?? seriesItems[0] ?? null;
    if (first) setHovered(first);
  }, [hovered, continueItems, movieItems, seriesItems]);

  const hoveredMeta = useHoveredMeta(hovered);
  const hoveredKey = hovered ? `${hovered.type}:${hovered.id}` : null;
  // Only trust meta that belongs to the item on screen (see useHoveredMeta).
  const featuredMeta = hoveredMeta && hoveredMeta.key === hoveredKey ? hoveredMeta.meta : null;

  return (
    <div className="relative -mx-4 md:-mx-5">
      <ImmersiveBackdrop item={hovered} meta={featuredMeta} fixed />

      <div className="relative z-10 flex min-h-[calc(100vh-8rem)] flex-col">
        {/* Featured panel — the upper band of the TV design. */}
        <div
          className="hidden shrink-0 md:block"
          style={{ padding: 'clamp(2rem,7vh,6rem) var(--bliss-safe-x) clamp(2rem,6vh,5rem)' }}
        >
          <ImmersiveInfoPanel item={hovered} meta={featuredMeta} />
        </div>

        {/* Rows band. */}
        <div className="mt-auto pb-24 md:pb-8">
          {continueItems.length > 0 ? (
            <LandscapeRail
              title="Continue Watching"
              items={continueItems}
              progressById={continueProgress}
              onHover={setHovered}
              onOpen={onItemClick}
            />
          ) : null}

          {loading ? (
            <div className="space-y-8 px-5">
              <SkeletonHomeRow />
              <SkeletonHomeRow />
              <SkeletonHomeRow />
            </div>
          ) : (
            rows.map((row) => (
              <ErrorBoundary key={row.id} fallback={<ErrorRow />}>
                <div className={hiddenRowIds.includes(row.id) ? 'opacity-40' : undefined}>
                  {homeEditMode ? (
                    <div className="px-5 pb-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-full bg-white/10 text-foreground/70"
                        onPress={() => onToggleRowVisibility(row.id)}
                      >
                        {hiddenRowIds.includes(row.id) ? 'Show' : 'Hide'} {row.title}
                      </Button>
                    </div>
                  ) : null}
                  <LandscapeRail
                    title={TV_ROW_TITLES[row.title] ?? row.title}
                    items={row.items}
                    onHover={setHovered}
                    onOpen={onItemClick}
                    onSeeAll={() => onSeeAll(row)}
                  />
                </div>
              </ErrorBoundary>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
