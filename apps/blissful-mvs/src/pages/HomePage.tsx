import { Button, Modal } from '@heroui/react';
import { motion } from 'framer-motion';
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
import type { AddonDescriptor } from '../lib/mediaTypes';
import { normalizeStremioImage, type LibraryItem } from '../lib/mediaTypes';
import {
  fetchBlissfulLibrary,
  putBlissfulLibraryItem,
} from '../lib/blissfulAuthApi';
import { triggerStremioFullSync } from '../lib/stremioLinkApi';
import { isInLibrary as isInLibraryStored, toggleLibrary } from '../lib/libraryStore';
import {
  HOME_ROW_POPULAR_MOVIE,
  HOME_ROW_POPULAR_SERIES,
  resolveHomeRowOrder,
} from '../lib/homeRows';
import { NetflixRow } from '../features/home/components/NetflixRow';
import { NetflixHero } from '../features/home/components/NetflixHero';
import { NowPopular } from '../features/home/components/NowPopular';
import { ModernHomePage } from '../features/home/components/ModernHomePage';
import { isMobile, libraryProgressPercent, libraryItemToMediaItem } from '../features/home/utils';
import { isTvMode, isAndroidTv } from '../lib/platform';
import { useAddonRows } from '../features/home/hooks/useAddonRows';
import { useNetflixHero } from '../features/home/hooks/useNetflixHero';
import { useNetflixReveal } from '../features/home/hooks/useNetflixReveal';

/** Stable Norigin focusKey for the classic-TV hero "Watch now" button, so the
 *  top content rail can route D-pad UP back onto it (geometry alone lands on the
 *  wide pinned search bar instead). */
const HERO_WATCH_KEY = 'tv-hero-watch';

export default function HomePage() {
  const maxRowItems = 10;
  // TV vertical row-windowing: keep only the focused row ±OVERSCAN catalog rows
  // mounted so off-screen rows cost no layout/paint (the remaining vertical-move
  // cost). UNMOUNT windowing — NOT content-visibility — is the Norigin-SAFE
  // choice: Norigin measures focusables via an offsetParent/offsetTop walk
  // (verified in its source), which reads 0 for a content-visibility-skipped
  // subtree and would break Down/Up navigation; a *mounted* row always has real
  // offset geometry. OVERSCAN=2 keeps the next move's target mounted+measured
  // ahead of Norigin's ~100ms keydown throttle. Spacer divs (real row height)
  // hold .board-content's total height + each mounted row's offsetTop constant
  // so the focused card never jumps as the window slides. Inert off-TV.
  const OVERSCAN = 2;
  const DEFAULT_ROW_H = 420;
  const windowed = isTvMode();
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const [rowH, setRowH] = useState(0);
  const rowHMeasuredRef = useRef(false);
  const measureRow = useCallback((el: HTMLDivElement | null) => {
    if (el && !rowHMeasuredRef.current && el.offsetHeight > 0) {
      rowHMeasuredRef.current = true;
      setRowH(el.offsetHeight);
    }
  }, []);
  const spacerH = rowH || DEFAULT_ROW_H;
  const { addons, addonsLoading } = useAddons();
  const { authKey } = useAuth();
  const { uiStyle, homeEditMode } = useUI();
  const { homeRowPrefs, setHomeRowPrefs } = useStorage();
  const { movieItems, seriesItems, loading, homeRowOptions, saveHomeRowPrefs } =
    useHomeCatalogContext();
  const { continueWatching, onOpenContinueItem } = useContinueWatchingContext();
  const navigate = useNavigate();
  const isNetflix = uiStyle === 'netflix';
  const isModern = uiStyle === 'modern';
  const revealRootRef = useRef<HTMLDivElement | null>(null);

  // Stremio sync trigger: every time the home page mounts, kick off a
  // full sync so Continue Watching reflects progress made elsewhere
  // (Stremio app, another device). Fire-and-forget; module-level
  // cooldown in stremioLinkApi (60 s) coalesces rapid navigations.
  useEffect(() => {
    triggerStremioFullSync(authKey ?? null);
  }, [authKey]);
  const [heroTrailerId, setHeroTrailerId] = useState<string | null>(null);
  const [heroInLibrary, setHeroInLibrary] = useState(false);
  // The rotating-hero behaviour (auto-cycle every ~11s + crossfade) is shared by
  // the Netflix theme AND the classic TV billboard. Disable it on REAL Android TV
  // hardware: every rotation remounts the full-screen hero layer and decodes a
  // fresh ~1080p background JPEG, which on a low-end GLES2 TV (software
  // compositing) is a recurring CPU + memory spike. Still rotates in Netflix mode
  // (desktop) and in ?tv=1 browser testing (isAndroidTv() === false there).
  const heroRotates = isNetflix || (isTvMode() && !isAndroidTv());
  const { hero, heroMeta, heroPrev, heroPrevMeta, heroIsFading, heroFadeIn } = useNetflixHero(
    heroRotates,
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
    fetchBlissfulLibrary<LibraryItem>(authKey)
      .then((items) => {
        if (cancelled) return;
        const item = items.find((it) => it._id === hero.id);
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
        // TV: bound the rail to maxRowItems like the addon rails — Popular
        // otherwise renders the full Cinemeta page (dozens of live MediaCards)
        // which inflates the DOM/poster cost on low-end TVs.
        result.push({ id, title: 'Popular - Movie', items: isTvMode() ? movieItems.slice(0, maxRowItems) : movieItems });
        return;
      }
      if (id === HOME_ROW_POPULAR_SERIES) {
        result.push({ id, title: 'Popular - Series', items: isTvMode() ? seriesItems.slice(0, maxRowItems) : seriesItems });
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
      const items = await fetchBlissfulLibrary<LibraryItem>(authKey);
      const existing = items.find((it) => it._id === hero.id);
      const inLibrary =
        Boolean(existing && !existing.removed)
        || isInLibraryStored({ type: hero.type, id: hero.id });
      // Soft-toggle by upserting `removed`: progress survives if the
      // user re-adds later. New items get a minimal stub doc.
      const base: Partial<LibraryItem> & { _id: string } = existing
        ? { ...existing }
        : { _id: hero.id, type: hero.type, name, poster: poster ?? null, state: {} };
      base.removed = inLibrary;
      await putBlissfulLibraryItem(authKey, hero.id, base);
      setHeroInLibrary(!inLibrary);
    } catch {
      // ignore
    }
  };

  if (isModern) {
    return (
      <ModernHomePage
        rows={rowsToRender}
        continueItems={continueItems}
        onItemClick={(item) => navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`)}
      />
    );
  }

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

  // The top content rail on TV is Continue Watching when present, else the
  // first catalog row. Only that rail routes UP onto the hero.
  const cwIsTopRail = isTvMode() && continueItems.length > 0;

  return (
    <div className="board-container ">
      <div className="board-content space-y-10">
        <NowPopular
          hero={hero ?? null}
          heroMeta={heroMeta}
          watchFocusKey={HERO_WATCH_KEY}
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

        {/* Continue Watching as a first-class home rail on TV (instead of the
            sidebar accordion, which doesn't belong on a 10-foot UI). */}
        {isTvMode() && continueItems.length > 0 ? (
          <MediaRail
            title="Continue Watching"
            // TV: cap the rail — Continue Watching is otherwise uncapped (can be
            // 20-40+ live cards) while every other rail caps at maxRowItems. The
            // full `continueWatching` list is still used for the lookup below.
            items={continueItems.slice(0, 14)}
            onItemPress={(item) => {
              // TV: match desktop — defer to the shared continue-watching
              // flow so items with saved progress pop the
              // ResumeOrStartOverModal first (and only navigate/play after
              // the user's choice). `continueItems` are derived from
              // `continueWatching` so MediaItem.id === LibraryItem._id.
              const libItem = continueWatching.find((cw) => cw._id === item.id);
              if (libItem) {
                onOpenContinueItem(libItem);
                return;
              }
              navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`);
            }}
            noScroll
            className="board-row-poster"
            autoFocusFirst={false}
            upFocusKey={HERO_WATCH_KEY}
            // CW is the always-mounted top rail; when focus is here, anchor the
            // catalog-row window to the top so Down lands on row 0 (not a stale
            // window that would skip the first rows).
            onRowFocus={() => setFocusedRowIndex(0)}
          />
        ) : null}

        {showRowsLoading ? (
          <div className="space-y-8">
            <SkeletonHomeRow />
            <SkeletonHomeRow />
            <SkeletonHomeRow />
          </div>
        ) : (
          rowsToRender.map((row, rowIndex) => {
            // TV: render only the focused row ±OVERSCAN; replace the rest with a
            // same-height spacer so scroll geometry (and Norigin's offsetTop
            // walk) stays correct. Off-TV `windowed` is false → render all rows.
            const inWindow =
              !windowed ||
              (rowIndex >= focusedRowIndex - OVERSCAN &&
                rowIndex <= focusedRowIndex + OVERSCAN);
            if (!inWindow) {
              return (
                <div
                  key={row.id}
                  className="board-row-spacer"
                  style={{ height: spacerH }}
                  aria-hidden
                />
              );
            }
            return (
            <ErrorBoundary key={row.id} fallback={<ErrorRow />}>
              <motion.div
                ref={windowed ? measureRow : undefined}
                className="board-row"
                // TV: skip the staggered enter animation. Framer drives these on
                // the JS main thread via rAF; ~7 rows animating at once while
                // posters decode + Norigin registers focusables is a mount-time
                // jank spike on every home return. initial={false} renders at the
                // final state immediately (no animation) on TV; desktop keeps it.
                initial={isTvMode() ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  isTvMode()
                    ? { duration: 0 }
                    : {
                        duration: 0.32,
                        delay: Math.min(rowIndex, 6) * 0.06,
                        ease: [0.4, 0, 0.2, 1],
                      }
                }
              >
                {/* Android TV reports a mobile UA (the WebView UA contains
                    "Android"), so isMobile() is true on the TV — but the TV
                    must use the desktop MediaRail (the larger board-row-poster
                    cards) to match the Continue Watching rail above. Without
                    the !isTvMode() guard the catalog rows rendered the small
                    MediaRailMobile cards while CW stayed large. */}
                {isMobile() && !isTvMode() ? (
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
                    autoFocusFirst={false}
                    upFocusKey={!cwIsTopRail && rowIndex === 0 ? HERO_WATCH_KEY : undefined}
                    onRowFocus={() => setFocusedRowIndex(rowIndex)}
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
              </motion.div>
            </ErrorBoundary>
            );
          })
        )}
      </div>
    </div>
  );
}
