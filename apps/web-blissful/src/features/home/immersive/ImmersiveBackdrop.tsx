import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rating } from '../../../components/Rating';
import { proxiedImage } from '../../../lib/imageProxy';
import { normalizeStremioImage } from '../../../lib/mediaTypes';
import { metahubPosterToBackdrop } from '../../../lib/transitionPoster';
import type { MediaItem } from '../../../types/media';
import { formatDate } from '../../detail/utils';
import type { Meta } from './useHoveredMeta';

const IMDB_RE = /^tt\d{5,}$/;

/** Best-effort landscape art from a poster url (TV: homeData.landscapeArt) —
 *  metahub posters have a matching background at a predictable path. */
export function landscapeArt(poster: string | null | undefined): string | undefined {
  const p = normalizeStremioImage(poster);
  return metahubPosterToBackdrop(p) ?? p ?? undefined;
}

/** Full-bleed art of the hovered item + the legibility scrim stack.
 *  Port of the TV app's `Backdrop` (components/home/HomeHero.tsx). */
export const ImmersiveBackdrop = memo(function ImmersiveBackdrop({
  item,
  meta,
  fixed,
}: {
  item: MediaItem | null;
  meta: Meta | null;
  /** Pin to the viewport so the art stays full-bleed while the page scrolls
   *  (the Home usage). `.bliss-content` is `position:absolute` with no
   *  transform, so a fixed child escapes both its padding and its clipping. */
  fixed?: boolean;
}) {
  // Sources best-first, same as the TV and the desktop detail page. Some
  // fanart.tv backgrounds 404 or refuse a direct fetch, so a load error
  // ADVANCES to the next candidate instead of leaving a black frame.
  const candidates = useMemo(
    () =>
      Array.from(
        new Set(
          [normalizeStremioImage(meta?.background), normalizeStremioImage(meta?.poster)].filter(
            (u): u is string => Boolean(u)
          )
        )
      ),
    [meta?.background, meta?.poster]
  );
  const candKey = candidates.join('|');
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [candKey]);

  const real = candidates[idx];
  // Hold the PREVIOUS real backdrop while a newly-hovered title's meta is still
  // resolving, so the panel never flashes a low-quality poster in between.
  const lastRealRef = useRef<string | undefined>(undefined);
  if (real) lastRealRef.current = real;
  const art = real ?? lastRealRef.current ?? landscapeArt(item?.posterUrl);

  // Swap only once the NEW art has decoded, and keep painting the old one until
  // then. Rendering `art` straight into the <img> (worse: with `key={art}`, which
  // remounts it) blanked the layer for a frame on every change — sweeping the
  // pointer across a rail strobed the whole screen.
  const [shownArt, setShownArt] = useState<string | undefined>(art);
  useEffect(() => {
    if (!art) {
      setShownArt(undefined);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.src = proxiedImage(art);
    const commit = () => {
      if (!cancelled) setShownArt(art);
    };
    // decode() resolves once the bitmap is ready to paint; onload is the fallback
    // for browsers/images where decode rejects (e.g. some SVG or CORS cases).
    img.decode().then(commit, () => {
      if (img.complete) commit();
      else img.onload = commit;
    });
    return () => {
      cancelled = true;
    };
  }, [art]);

  return (
    <div className={fixed ? 'bliss-backdrop bliss-backdrop--fixed' : 'bliss-backdrop'} aria-hidden>
      {shownArt ? (
        <img
          src={proxiedImage(shownArt)}
          alt=""
          className="bliss-backdrop-art"
          draggable={false}
          onError={() => setIdx((i) => i + 1)}
        />
      ) : null}
      {shownArt ? <div className="bliss-backdrop-wash" /> : null}
      <div className="bliss-backdrop-scrims" />
    </div>
  );
});

/** Large featured metadata for the hovered item — port of the TV app's
 *  `InfoPanel`. Genre pills open Discover pre-filtered, as on the TV. */
export const ImmersiveInfoPanel = memo(function ImmersiveInfoPanel({
  item,
  meta,
}: {
  item: MediaItem | null;
  meta: Meta | null;
}) {
  const navigate = useNavigate();
  if (!item) return null;

  const runtime = meta?.runtime ?? '';
  // Full release date, like the TV's InfoPanel (formatFullDate) and the detail
  // page — a bare year reads as much less information at this size.
  const released =
    formatDate(meta?.released) ??
    meta?.releaseInfo ??
    (meta?.year != null ? String(meta.year) : item.year ? String(item.year) : '');
  const genres = (meta?.genres ?? meta?.genre ?? []).slice(0, 4);
  const blurb = meta?.description ?? item.blurb ?? '';
  const rating = meta?.imdbRating ?? item.rating;
  const imdbId = IMDB_RE.test(item.id)
    ? item.id
    : (meta as { imdb_id?: string } | null)?.imdb_id ?? null;
  const bits = [runtime, released].filter(Boolean) as string[];

  return (
    <div className="pointer-events-none max-w-[52rem]">
      <h1 className="bliss-info-title line-clamp-2">{meta?.name ?? item.title}</h1>

      {/* runtime · release · IMDb — same order as the detail page. */}
      <div className="bliss-info-meta mt-4 flex flex-wrap items-center gap-3">
        {bits.map((bit, i) => (
          <span key={bit} className="flex items-center gap-3">
            {i > 0 ? <span className="text-white/40">·</span> : null}
            <span>{bit}</span>
          </span>
        ))}
        {rating || imdbId ? (
          <span className="flex items-center gap-3">
            {bits.length ? <span className="text-white/40">·</span> : null}
            <Rating imdbId={imdbId} initialRating={rating} iconClassName="h-[1.3em] w-[1.3em]" />
          </span>
        ) : null}
      </div>

      {genres.length ? (
        <div className="pointer-events-auto mt-4 flex flex-wrap gap-2">
          {genres.map((genre) => (
            <button
              key={genre}
              type="button"
              className="bliss-chip"
              onClick={() =>
                navigate(`/discover?type=${encodeURIComponent(item.type)}&genre=${encodeURIComponent(genre)}`)
              }
            >
              {genre}
            </button>
          ))}
        </div>
      ) : null}

      {blurb ? <p className="bliss-info-blurb mt-4">{blurb}</p> : null}
    </div>
  );
});
