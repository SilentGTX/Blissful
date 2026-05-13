import { Button, Modal } from '@heroui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorBoundary, ErrorRow } from '../components/ErrorBoundary';
import { SkeletonHomeRow } from '../components/Skeleton';
import MediaRail from '../components/MediaRail';
import MediaRailMobile from '../components/MediaRailMobile';
import { useAddons } from '../context/AddonsProvider';
import { useAuth } from '../context/AuthProvider';
import { useContinueWatchingContext } from '../context/ContinueWatchingProvider';
import { useHomeCatalogContext } from '../context/HomeCatalogProvider';
import { useStorage } from '../context/StorageProvider';
import { useUI } from '../context/UIProvider';
import type { MediaItem, MediaType } from '../types/media';
import type { AddonDescriptor } from '../lib/stremioApi';
import {
  addToLibraryItem,
  datastoreGetLibraryItemById,
  normalizeStremioImage,
  removeFromLibraryItem,
} from '../lib/stremioApi';
import { isInLibrary as isInLibraryStored, toggleLibrary } from '../lib/libraryStore';
import {
  HOME_ROW_POPULAR_MOVIE,
  HOME_ROW_POPULAR_SERIES,
  resolveHomeRowOrder,
} from '../lib/homeRows';
import { NetflixRow } from '../features/home/components/NetflixRow';
import { NetflixHero } from '../features/home/components/NetflixHero';
import { NowPopular } from '../features/home/components/NowPopular';
import { isMobile, libraryProgressPercent, libraryItemToMediaItem } from '../features/home/utils';
import { useAddonRows } from '../features/home/hooks/useAddonRows';
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
  const [heroTrailerId, setHeroTrailerId] = useState<string | null>(null);
  const [heroInLibrary, setHeroInLibrary] = useState(false);
  const { hero, heroMeta, heroPrev, heroPrevMeta, heroIsFading, heroFadeIn } = useNetflixHero(
    isNetflix,
    movieItems,
    seriesItems
  );

  useEffect(() => {
    if (!hero) {
      setHeroInLibrary(false);
      return;
    }
    if (!authKey) {
      setHeroInLibrary(isInLibraryStored({ type: hero.type, id: hero.id }));
      return;
    }
    let cancelled = false;
    datastoreGetLibraryItemById({ authKey, id: hero.id })
      .then((item) => {
        if (cancelled) return;
        setHeroInLibrary(Boolean(item && !item.removed));
      })
      .catch(() => {
        if (cancelled) return;
        setHeroInLibrary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authKey, hero]);

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

  const handleAddToLibrary = async () => {
    if (!hero) return;
    const name = heroMeta?.meta?.name ?? hero.title ?? '';
    if (!name) return;
    const poster = normalizeStremioImage(heroMeta?.meta?.poster) ?? hero.posterUrl ?? null;

    if (!authKey) {
      toggleLibrary({ type: hero.type, id: hero.id, name, poster: poster ?? undefined });
      setHeroInLibrary((prev) => !prev);
      return;
    }

    try {
      const existing = await datastoreGetLibraryItemById({ authKey, id: hero.id });
      const inLibrary =
        Boolean(existing && !existing.removed) ||
        isInLibraryStored({ type: hero.type, id: hero.id });
      if (inLibrary) {
        await removeFromLibraryItem({ authKey, id: hero.id });
        setHeroInLibrary(false);
      } else {
        await addToLibraryItem({
          authKey,
          id: hero.id,
          type: hero.type,
          name,
          poster: poster ?? null,
        });
        setHeroInLibrary(true);
      }
    } catch {
      // ignore
    }
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

  return (
    <div className="board-container ">
      <div className="board-content space-y-10">
        <NowPopular
          hero={hero ?? null}
          heroMeta={heroMeta}
          inLibrary={heroInLibrary}
          onWatch={() => {
            if (hero) navigate(`/detail/${hero.type}/${encodeURIComponent(hero.id)}`);
          }}
          onAddToList={handleAddToLibrary}
          onGenreClick={(g) => {
            if (!hero) return;
            const qs = new URLSearchParams({ genre: g });
            navigate(
              `/discover/${encodeURIComponent('https://v3-cinemeta.strem.io/manifest.json')}/${hero.type}/top?${qs.toString()}`
            );
          }}
        />

        {showRowsLoading ? (
          <div className="space-y-8">
            <SkeletonHomeRow />
            <SkeletonHomeRow />
            <SkeletonHomeRow />
          </div>
        ) : (
          rowsToRender.map((row) => (
            <ErrorBoundary key={row.id} fallback={<ErrorRow />}>
              <div className="board-row">
                {isMobile() ? (
                  <MediaRailMobile
                    title={row.title}
                    items={row.items}
                    onItemPress={(item) => navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`)}
                    onSeeAll={() => handleSeeAll(row)}
                    dimmed={homeRowPrefs.hidden.includes(row.id)}
                    actions={
                      homeEditMode ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full bg-white/10 text-foreground/70 text-xs px-2 py-1"
                          onPress={() => toggleVisibility(row.id)}
                        >
                          {homeRowPrefs.hidden.includes(row.id) ? 'Show' : 'Hide'}
                        </Button>
                      ) : null
                    }
                  />
                ) : (
                  <MediaRail
                    title={row.title}
                    items={row.items}
                    onItemPress={(item) => navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`)}
                    onSeeAll={() => handleSeeAll(row)}
                    dimmed={homeRowPrefs.hidden.includes(row.id)}
                    noScroll
                    className="board-row-poster"
                    actions={
                      homeEditMode ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full bg-white/10 text-foreground/70"
                          onPress={() => toggleVisibility(row.id)}
                        >
                          {homeRowPrefs.hidden.includes(row.id) ? 'Show' : 'Hide'}
                        </Button>
                      ) : null
                    }
                  />
                )}
              </div>
            </ErrorBoundary>
          ))
        )}
      </div>
    </div>
  );
}
