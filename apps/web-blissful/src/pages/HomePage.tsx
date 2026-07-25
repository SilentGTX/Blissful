import { Button, Modal } from '@heroui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorBoundary, ErrorRow } from '../components/ErrorBoundary';
import { SkeletonHomeRow } from '../components/Skeleton';
import { useAddons } from '../context/AddonsProvider';
import { useAuth } from '../context/AuthProvider';
import { useContinueWatchingContext } from '../context/ContinueWatchingProvider';
import { useHomeCatalogContext } from '../context/HomeCatalogProvider';
import { useStorage } from '../context/StorageProvider';
import { useUI } from '../context/UIProvider';
import type { MediaItem, MediaType } from '../types/media';
import type { AddonDescriptor } from '../lib/mediaTypes';
import { triggerStremioFullSync } from '../lib/stremioLinkApi';
import {
  HOME_ROW_POPULAR_MOVIE,
  HOME_ROW_POPULAR_SERIES,
  resolveHomeRowOrder,
} from '../lib/homeRows';
import { NetflixRow } from '../features/home/components/NetflixRow';
import { NetflixHero } from '../features/home/components/NetflixHero';
import { libraryProgressPercent, libraryItemToMediaItem } from '../features/home/utils';
import { useAddonRows } from '../features/home/hooks/useAddonRows';
import { ImmersiveBackdrop, ImmersiveInfoPanel } from '../features/home/immersive/ImmersiveBackdrop';
import { LandscapeRail } from '../features/home/immersive/LandscapeRail';
import { useHoveredMeta } from '../features/home/immersive/useHoveredMeta';
import { useNetflixHero } from '../features/home/hooks/useNetflixHero';
import { useNetflixReveal } from '../features/home/hooks/useNetflixReveal';

export default function HomePage() {
  const maxRowItems = 10;
  const { addons, addonsLoading } = useAddons();
  const { authKey } = useAuth();
  const { uiStyle, homeEditMode } = useUI();
  const { homeRowPrefs, setHomeRowPrefs } = useStorage();
  const { movieItems, seriesItems, loading, homeRowOptions, saveHomeRowPrefs } =
    useHomeCatalogContext();
  const { continueWatching } = useContinueWatchingContext();
  const navigate = useNavigate();
  const isNetflix = uiStyle === 'netflix';
  const revealRootRef = useRef<HTMLDivElement | null>(null);
  // Immersive home: the hovered tile drives the backdrop + featured panel.
  const [hovered, setHovered] = useState<MediaItem | null>(null);
  const hoveredMeta = useHoveredMeta(hovered);

  // Stremio sync trigger: every time the home page mounts, kick off a
  // full sync so Continue Watching reflects progress made elsewhere
  // (Stremio app, another device). Fire-and-forget; module-level
  // cooldown in stremioLinkApi (60 s) coalesces rapid navigations.
  useEffect(() => {
    triggerStremioFullSync(authKey ?? null);
  }, [authKey]);
  const [heroTrailerId, setHeroTrailerId] = useState<string | null>(null);
  const { hero, heroMeta, heroPrev, heroPrevMeta, heroIsFading, heroFadeIn } = useNetflixHero(
    isNetflix,
    movieItems,
    seriesItems
  );


  const metaLookup = useMemo(() => {
    const map = new Map<string, MediaItem>();
    [...movieItems, ...seriesItems].forEach((item) => {
      map.set(item.id, item);
    });
    return map;
  }, [movieItems, seriesItems]);

  const continueItems = useMemo(
    () => continueWatching.map((item) => libraryItemToMediaItem(item, metaLookup)),
    [continueWatching, metaLookup]
  );
  const continueProgress = useMemo(() => {
    const map: Record<string, number> = {};
    continueWatching.forEach((item) => {
      const pct = libraryProgressPercent(item);
      if (typeof pct === 'number' && Number.isFinite(pct)) {
        map[item._id] = pct;
      }
    });
    return map;
  }, [continueWatching]);

  // Seed the featured item as soon as there is anything to feature, so the
  // backdrop + panel arrive fully populated instead of waiting for the first
  // hover (the meta fetch is keyed off this state).
  useEffect(() => {
    if (hovered) return;
    const first = continueItems[0] ?? movieItems[0] ?? seriesItems[0] ?? null;
    if (first) setHovered(first);
  }, [hovered, continueItems, movieItems, seriesItems]);

  const addonRows = useAddonRows(addons, maxRowItems);

  const rowsToRender = useMemo(() => {
    const resolved = resolveHomeRowOrder(homeRowOptions, homeRowPrefs);
    type RenderRow = {
      id: string;
      title: string;
      items: MediaItem[];
      addon?: AddonDescriptor;
      type?: MediaType;
      catalogId?: string;
    };
    const result: RenderRow[] = [];

    resolved.order.forEach((id) => {
      if (resolved.hidden.includes(id) && !homeEditMode) return;
      if (id === HOME_ROW_POPULAR_MOVIE) {
        result.push({ id, title: 'Popular - Movie', items: movieItems });
        return;
      }
      if (id === HOME_ROW_POPULAR_SERIES) {
        result.push({ id, title: 'Popular - Series', items: seriesItems });
        return;
      }
      const addonRow = addonRows[id];
      if (addonRow) {
        result.push({
          id,
          title: addonRow.title,
          items: addonRow.items,
          addon: addonRow.addon,
          type: addonRow.type,
          catalogId: addonRow.catalogId,
        });
      }
    });

    return result;
  }, [addonRows, homeRowOptions, homeRowPrefs, movieItems, seriesItems, homeEditMode]);

  const showRowsLoading = (addonsLoading || loading) && rowsToRender.length === 0;

  useNetflixReveal(isNetflix, revealRootRef, [rowsToRender.length, continueItems.length, hero?.id]);

  const handleSeeAll = useCallback(
    (row: (typeof rowsToRender)[number]) => {
      if (row.id === HOME_ROW_POPULAR_MOVIE) {
        navigate(
          '/discover/' + encodeURIComponent('https://v3-cinemeta.strem.io') + '/movie/top',
          { state: { seedItems: row.items } }
        );
        return;
      }
      if (row.id === HOME_ROW_POPULAR_SERIES) {
        navigate(
          '/discover/' + encodeURIComponent('https://v3-cinemeta.strem.io') + '/series/top',
          { state: { seedItems: row.items } }
        );
        return;
      }
      if (row.addon && row.type && row.catalogId) {
        navigate(
          '/discover/' +
            encodeURIComponent(row.addon.transportUrl) +
            '/' +
            row.type +
            '/' +
            row.catalogId,
          { state: { seedItems: row.items } }
        );
      } else {
        navigate('/discover');
      }
    },
    [navigate]
  );

  const toggleVisibility = async (id: string) => {
    const nextHidden = homeRowPrefs.hidden.includes(id)
      ? homeRowPrefs.hidden.filter((rowId) => rowId !== id)
      : [...homeRowPrefs.hidden, id];
    const nextPrefs = { ...homeRowPrefs, hidden: nextHidden };
    setHomeRowPrefs(nextPrefs);
    await saveHomeRowPrefs(nextPrefs);
  };

  if (isNetflix) {
    const heroTrailer = heroMeta?.meta?.trailerStreams?.find((t) => t?.ytId)?.ytId ?? null;
    return (
      <div className="netflix-home" ref={revealRootRef}>
        <div className="netflix-home-stack">
          <NetflixHero
            item={hero}
            meta={heroMeta}
            prevItem={heroPrev}
            prevMeta={heroPrevMeta}
            isFading={heroIsFading}
            fadeIn={heroFadeIn}
            onPlay={() => {
              if (!hero) return;
              navigate(`/detail/${hero.type}/${encodeURIComponent(hero.id)}`);
            }}
            onInfo={() => {
              if (!hero) return;
              navigate(`/detail/${hero.type}/${encodeURIComponent(hero.id)}`);
            }}
            onTrailer={heroTrailer ? () => setHeroTrailerId(heroTrailer) : undefined}
          />

          {continueItems.length > 0 ? (
            <NetflixRow
              title="Continue Watching"
              items={continueItems}
              progressById={continueProgress}
              onItemPress={(item) => navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`)}
            />
          ) : null}

          {addonsLoading || loading ? (
            <div className="space-y-8">
              <SkeletonHomeRow />
              <SkeletonHomeRow />
              <SkeletonHomeRow />
            </div>
          ) : (
            rowsToRender.map((row) => (
              <NetflixRow
                key={row.id}
                title={row.title}
                items={row.items}
                onItemPress={(item) => navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`)}
              />
            ))
          )}
        </div>

        <Modal>
          <Modal.Backdrop
            isOpen={Boolean(heroTrailerId)}
            onOpenChange={(open) => {
              if (!open) setHeroTrailerId(null);
            }}
            variant="blur"
            className="bg-black/60"
          >
            <Modal.Container placement="center" size="cover">
              <Modal.Dialog className="bg-transparent shadow-none">
                <Modal.Header className="sr-only"><Modal.Heading>Trailer</Modal.Heading></Modal.Header>
                <Modal.Body className="px-0">
                  <div className="overflow-hidden rounded-[28px] bg-black">
                    {heroTrailerId ? (
                      <iframe
                        title="Trailer"
                        className="h-[70vh] w-[min(1000px,92vw)]"
                        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(heroTrailerId)}?autoplay=1`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    ) : null}
                  </div>
                </Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </div>
    );
  }

  // ---- Immersive home (the Android TV design, driven by the pointer) -------
  // Hovering a tile swaps the full-bleed backdrop + featured panel, exactly as
  // D-pad focus does on the TV. Before anything is hovered we feature the first
  // Continue Watching entry, falling back to the first popular title.
  const defaultFeatured = continueItems[0] ?? movieItems[0] ?? seriesItems[0] ?? null;
  const featured = hovered ?? defaultFeatured;
  const featuredKey = featured ? `${featured.type}:${featured.id}` : null;
  // Only trust meta that belongs to the item on screen (see useHoveredMeta).
  const featuredMeta = hoveredMeta && hoveredMeta.key === featuredKey ? hoveredMeta.meta : null;
  const openItem = (item: MediaItem) =>
    navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`);

  return (
    <div className="relative -mx-4 md:-mx-5">
      <ImmersiveBackdrop item={featured} meta={featuredMeta} fixed />

      <div className="relative z-10 flex min-h-[calc(100vh-8rem)] flex-col">
        {/* Featured panel — the upper band of the TV design. */}
        <div
          className="hidden shrink-0 md:block"
          style={{ padding: 'clamp(2rem,6vh,5rem) var(--bliss-safe-x) clamp(1.5rem,4vh,3rem)' }}
        >
          <ImmersiveInfoPanel item={featured} meta={featuredMeta} />
        </div>

        {/* Rows band. */}
        <div className="mt-auto pb-24 md:pb-8">
          {continueItems.length > 0 ? (
            <LandscapeRail
              title="Continue Watching"
              items={continueItems}
              progressById={continueProgress}
              onHover={setHovered}
              onOpen={openItem}
            />
          ) : null}

          {showRowsLoading ? (
            <div className="space-y-8 px-5">
              <SkeletonHomeRow />
              <SkeletonHomeRow />
              <SkeletonHomeRow />
            </div>
          ) : (
            rowsToRender.map((row) => (
              <ErrorBoundary key={row.id} fallback={<ErrorRow />}>
                <div className={homeRowPrefs.hidden.includes(row.id) ? 'opacity-40' : undefined}>
                  {homeEditMode ? (
                    <div className="px-5 pb-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-full bg-white/10 text-foreground/70"
                        onPress={() => toggleVisibility(row.id)}
                      >
                        {homeRowPrefs.hidden.includes(row.id) ? 'Show' : 'Hide'} {row.title}
                      </Button>
                    </div>
                  ) : null}
                  <LandscapeRail
                    title={row.title}
                    items={row.items}
                    onHover={setHovered}
                    onOpen={openItem}
                    onSeeAll={() => handleSeeAll(row)}
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
