import { Modal } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MediaItem } from '../../../types/media';
import type { StremioMetaDetail } from '../../../lib/stremioAddon';
import { fetchMeta } from '../../../lib/stremioAddon';
import { ChevronLeftIcon } from '../../../icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../../../icons/ChevronRightIcon';
import { ImdbIcon } from '../../../icons/ImdbIcon';
import { InfoIcon } from '../../../icons/InfoIcon';
import { PlayIcon } from '../../../icons/PlayIcon';

type NetflixRowProps = {
  title: string;
  items: MediaItem[];
  progressById?: Record<string, number>;
  onItemPress: (item: MediaItem) => void;
};

export function NetflixRow({ title, items, progressById, onItemPress }: NetflixRowProps) {
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

    return () => {
      cancelled = true;
    };
  }, [focusedId, items]);

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
  const imdbRating = focusedItem.rating ? focusedItem.rating.toFixed(1) : null;
  const cast = meta?.cast?.slice(0, 4) ?? [];
  const trailerId = meta?.trailerStreams?.find((t) => t?.ytId)?.ytId ?? null;

  return (
    <section className="netflix-row netflix-reveal">
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
          {items.map((item) => {
            const progress = progressById?.[item.id];
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                className={`netflix-landscape-card ${focusedId === item.id ? 'is-focused' : ''}`}
                onMouseEnter={() => setFocusedId(item.id)}
                onFocus={() => setFocusedId(item.id)}
                onClick={() => onItemPress(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
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
                  {focusedId === item.id ? (
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
                                setTrailerOpenId(trailerId);
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
          })}
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
            {imdbRating ? (
              <div className="netflix-imdb">
                <ImdbIcon className="netflix-imdb-icon" />
                <span className="netflix-imdb-score">{imdbRating}</span>
              </div>
            ) : null}
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
  );
}
