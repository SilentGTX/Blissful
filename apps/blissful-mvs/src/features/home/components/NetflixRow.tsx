import { Modal } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FocusContext,
  useFocusable,
  pause,
  resume,
  getCurrentFocusKey,
} from '@noriginmedia/norigin-spatial-navigation';
import type { MediaItem } from '../../../types/media';
import type { StremioMetaDetail } from '../../../lib/stremioAddon';
import { fetchMeta } from '../../../lib/stremioAddon';
import { isTvMode, isAndroidTv } from '../../../lib/platform';
import { ChevronLeftIcon } from '../../../icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../../../icons/ChevronRightIcon';
import { Rating } from '../../../components/Rating';
import { InfoIcon } from '../../../icons/InfoIcon';
import { PlayIcon } from '../../../icons/PlayIcon';

type NetflixRowProps = {
  title: string;
  items: MediaItem[];
  progressById?: Record<string, number>;
  onItemPress: (item: MediaItem) => void;
};

type NetflixCardProps = {
  item: MediaItem;
  index: number;
  progress?: number;
  isFocused: boolean;
  metaParts: string[];
  trailerId: string | null;
  onItemPress: (item: MediaItem) => void;
  onFocusItem: (id: string) => void;
  onOpenTrailer: (ytId: string) => void;
};

// One card claims initial focus on a fresh TV screen: the first card whose
// effect runs while nothing else is focused (the first row's first card, since
// effects run top-to-bottom). Re-claims after a navigation that left focus empty.
function NetflixCard({
  item,
  index,
  progress,
  isFocused,
  metaParts,
  trailerId,
  onItemPress,
  onFocusItem,
  onOpenTrailer,
}: NetflixCardProps) {
  const tv = isTvMode();
  const { ref, focusSelf } = useFocusable({
    focusable: tv,
    onEnterPress: () => onItemPress(item),
    onFocus: () => {
      onFocusItem(item.id);
      // Bring the focused card into view. scroll-snap is softened to proximity
      // on TV (index.css) so this lands smoothly instead of being overridden.
      ref.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: isAndroidTv() ? 'instant' : 'smooth' });
    },
  });

  useEffect(() => {
    if (tv && index === 0 && !getCurrentFocusKey()) focusSelf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      className={`netflix-landscape-card ${isFocused ? 'is-focused' : ''}`}
      onMouseEnter={() => onFocusItem(item.id)}
      onFocus={() => onFocusItem(item.id)}
      onClick={() => onItemPress(item)}
      onKeyDown={(event) => {
        // On TV, Enter is handled by Norigin's onEnterPress — don't double-fire.
        if (!tv && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onItemPress(item);
        }
      }}
    >
      <div className="netflix-landscape-frame">
        {item.posterUrl ? (
          <img src={item.posterUrl} alt="" className="netflix-landscape-img" />
        ) : (
          <div className="netflix-landscape-fallback">{item.title.slice(0, 1)}</div>
        )}
        {typeof progress === 'number' ? (
          <div className="netflix-progress">
            <div className="netflix-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        {isFocused ? (
          <div className="netflix-landscape-overlay">
            <div className="netflix-overlay-actions">
              <span className="netflix-overlay-title">{item.title}</span>
              {metaParts.length > 0 ? (
                <div className="netflix-overlay-meta">{metaParts.join(' · ')}</div>
              ) : null}
              <div className="netflix-overlay-buttons">
                <div className="netflix-overlay-buttons-left">
                  <button
                    type="button"
                    className="netflix-overlay-btn netflix-overlay-btn-play"
                    onClick={(event) => {
                      event.stopPropagation();
                      onItemPress(item);
                    }}
                  >
                    <PlayIcon size={14} />
                    Play
                  </button>
                  <button
                    type="button"
                    className="netflix-overlay-btn netflix-overlay-btn-info"
                    onClick={(event) => {
                      event.stopPropagation();
                      onItemPress(item);
                    }}
                  >
                    <InfoIcon size={14} />
                    Info
                  </button>
                </div>
                {trailerId ? (
                  <button
                    type="button"
                    className="netflix-overlay-btn netflix-overlay-btn-trailer"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenTrailer(trailerId);
                    }}
                  >
                    Trailer
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function NetflixRow({ title, items, progressById, onItemPress }: NetflixRowProps) {
  const tv = isTvMode();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(items[0]?.id ?? null);
  const [focusedMeta, setFocusedMeta] = useState<StremioMetaDetail | null>(null);
  const [trailerOpenId, setTrailerOpenId] = useState<string | null>(null);
  const metaCacheRef = useRef<Map<string, StremioMetaDetail>>(new Map());
  const userInteractedRef = useRef(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hasUserScrolled, setHasUserScrolled] = useState(false);

  // Row is a Norigin focus boundary so D-pad Up/Down moves between rows and
  // Left/Right stays within the rail. Inert in non-TV mode (focusable:false).
  const { ref: rowRef, focusKey } = useFocusable({
    focusable: tv,
    trackChildren: true,
    saveLastFocusedChild: true,
  });

  useEffect(() => {
    setFocusedId(items[0]?.id ?? null);
    userInteractedRef.current = false;
    setHasUserScrolled(false);
  }, [items]);

  useEffect(() => {
    const focusedItem = items.find((item) => item.id === focusedId) ?? null;
    if (!focusedItem) {
      setFocusedMeta(null);
      return;
    }
    const cached = metaCacheRef.current.get(focusedItem.id);
    if (cached) {
      setFocusedMeta(cached);
      return;
    }

    let cancelled = false;
    const run = () => {
      fetchMeta({ type: focusedItem.type, id: focusedItem.id })
        .then((resp) => {
          if (cancelled) return;
          metaCacheRef.current.set(focusedItem.id, resp);
          setFocusedMeta(resp);
        })
        .catch(() => {
          if (cancelled) return;
          setFocusedMeta(null);
        });
    };
    // Debounce on TV so rapid D-pad card-to-card moves don't fire a meta fetch
    // per card; resolve immediately on desktop (hover is deliberate).
    const timer = setTimeout(run, tv ? 250 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [focusedId, items, tv]);

  // While the trailer modal is open, pause Norigin — HeroUI v3 modals trap focus
  // and `inert` the background themselves, so a live spatial tree fights them.
  useEffect(() => {
    if (!tv) return;
    if (trailerOpenId) pause();
    else resume();
    return () => {
      if (tv) resume();
    };
  }, [trailerOpenId, tv]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const update = () => {
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      const current = Math.max(0, scroller.scrollLeft);
      const leftActive = current > 4;
      setCanScrollLeft(leftActive);
      setCanScrollRight(current < maxScroll - 16);
      if (userInteractedRef.current && leftActive) {
        setHasUserScrolled(true);
      }
    };

    const markInteracted = () => {
      userInteractedRef.current = true;
    };

    scroller.scrollLeft = 0;
    update();
    scroller.addEventListener('scroll', update);
    scroller.addEventListener('wheel', markInteracted, { passive: true });
    scroller.addEventListener('touchstart', markInteracted, { passive: true });
    scroller.addEventListener('mousedown', markInteracted);
    const observer = new ResizeObserver(update);
    observer.observe(scroller);

    return () => {
      scroller.removeEventListener('scroll', update);
      scroller.removeEventListener('wheel', markInteracted);
      scroller.removeEventListener('touchstart', markInteracted);
      scroller.removeEventListener('mousedown', markInteracted);
      observer.disconnect();
    };
  }, []);

  const scrollByAmount = (direction: 'left' | 'right') => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    userInteractedRef.current = true;
    const delta = Math.max(240, Math.floor(scroller.clientWidth * 0.8));
    scroller.scrollBy({ left: direction === 'left' ? -delta : delta, behavior: 'smooth' });
  };

  if (items.length === 0) return null;

  const focusedItem = items.find((item) => item.id === focusedId) ?? items[0];
  const meta = focusedMeta?.meta;
  const metaGenres = meta?.genres ?? focusedItem.genres ?? [];
  const metaYear = meta?.year ?? focusedItem.year;
  const metaRuntime = meta?.runtime ?? focusedItem.runtime;
  const metaParts = [
    metaGenres[0],
    metaYear ? String(metaYear) : null,
    metaRuntime ?? null,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  const cast = meta?.cast?.slice(0, 4) ?? [];
  const trailerId = meta?.trailerStreams?.find((t) => t?.ytId)?.ytId ?? null;

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={rowRef} className="netflix-row netflix-reveal">
        <div className="netflix-row-title">{title}</div>
        <div className="netflix-rail-wrapper">
          <button
            type="button"
            className={`netflix-rail-arrow netflix-rail-arrow-left ${canScrollLeft && hasUserScrolled ? '' : 'is-hidden'}`}
            aria-label="Scroll left"
            onClick={() => scrollByAmount('left')}
          >
            <ChevronLeftIcon className="h-[18px] w-[18px]" />
          </button>
          <div ref={scrollRef} className="netflix-rail netflix-rail-landscape hide-scrollbar">
            {items.map((item, i) => (
              <NetflixCard
                key={item.id}
                item={item}
                index={i}
                progress={progressById?.[item.id]}
                isFocused={focusedId === item.id}
                metaParts={metaParts}
                trailerId={trailerId}
                onItemPress={onItemPress}
                onFocusItem={setFocusedId}
                onOpenTrailer={setTrailerOpenId}
              />
            ))}
          </div>
          <button
            type="button"
            className={`netflix-rail-arrow netflix-rail-arrow-right ${canScrollRight ? '' : 'is-hidden'}`}
            aria-label="Scroll right"
            onClick={() => scrollByAmount('right')}
          >
            <ChevronRightIcon className="h-[18px] w-[18px]" />
          </button>
        </div>

        {focusedItem ? (
          <div key={focusedItem.id} className="netflix-row-details">
            <div className="netflix-row-meta">
              <div className="netflix-row-meta-line">{metaParts.length > 0 ? metaParts.join(' · ') : ' '}</div>
              <Rating
                initialRating={focusedItem.rating ?? null}
                className="netflix-imdb"
                iconClassName="netflix-imdb-icon"
              />
            </div>
            {focusedItem.blurb ? <div className="netflix-row-desc">{focusedItem.blurb}</div> : null}
            {cast.length > 0 ? (
              <div className="netflix-row-cast">
                <div className="netflix-row-cast-label">Cast</div>
                <div className="netflix-row-cast-list">
                  {cast.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="netflix-row-cast-pill"
                      onClick={() => {
                        navigate(`/search?search=${encodeURIComponent(name)}`);
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <Modal>
          <Modal.Backdrop
            isOpen={Boolean(trailerOpenId)}
            onOpenChange={(open) => {
              if (!open) setTrailerOpenId(null);
            }}
            variant="blur"
            className="bg-black/60"
          >
            <Modal.Container placement="center" size="cover">
              <Modal.Dialog className="bg-transparent shadow-none">
                <Modal.Header className="sr-only"><Modal.Heading>Trailer</Modal.Heading></Modal.Header>
                <Modal.Body className="px-0">
                  <div className="overflow-hidden rounded-[28px] bg-black">
                    {trailerOpenId ? (
                      <iframe
                        title="Trailer"
                        className="h-[70vh] w-[min(1000px,92vw)]"
                        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailerOpenId)}?autoplay=1`}
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
      </section>
    </FocusContext.Provider>
  );
}
