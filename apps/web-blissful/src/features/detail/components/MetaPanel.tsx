import { SkeletonBox, SkeletonText } from '../../../components/Skeleton';
import { AnimatePresence, motion } from 'framer-motion';
import { Rating } from '../../../components/Rating';
import { proxiedImage } from '../../../lib/imageProxy';
import { GenreChips } from './GenreChips';

type MetaPanelProps = {
  logo: string | null;
  logoTitle: string;
  logoFailed: boolean;
  onLogoError: () => void;
  runtime: string | null;
  released: string | null;
  releaseInfo: string | null;
  imdbRating: number | null;
  genres: string[];
  onGenreClick: (genre: string) => void;
  cast: string[];
  onCastClick: (name: string) => void;
  description: string | null;
  isLoading?: boolean;
};

// Logo and meta-info row crossfade. Pure opacity — no y translate — so
// it reads as a genuine fade-in instead of an upward slide.
const fadeProps = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
};

// Section-level stagger for genres / cast / summary. No `delayChildren`
// so they fade in alongside the runtime/IMDB row instead of after it.
// A small `staggerChildren` keeps a subtle cascade so they don't all
// snap on at exactly the same instant.
const sectionStagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0 } },
};

const sectionItem = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] } },
};

export function MetaPanel({
  logo,
  logoTitle,
  logoFailed,
  onLogoError,
  runtime,
  released,
  releaseInfo,
  imdbRating,
  genres,
  onGenreClick,
  cast,
  onCastClick,
  description,
  isLoading = false,
}: MetaPanelProps) {
  return (
    <div data-testid="detail-meta-panel" className="meta-preview-container-o22hc animation-fade-in">
      <div className="meta-preview-ES0h3">
        <div className="meta-info-container-ub8AH">
          {/* Fixed-height logo slot sized to the (smaller) clamped
              logo's max + margin (7rem + 1.5rem = 8.5rem), so the row
              below never shifts whether the logo is loading, loaded, or
              missing entirely. `items-end` keeps the logo flush with the
              meta-info row that follows, regardless of its native
              aspect ratio. */}
          <div className="hidden lg:flex lg:h-[8.5rem] lg:items-end">
            <AnimatePresence mode="wait" initial={false}>
              {isLoading ? (
                <motion.div key="logo-skeleton" {...fadeProps}>
                  <SkeletonBox className="h-36 w-80" />
                </motion.div>
              ) : logo && !logoFailed ? (
                <motion.img
                  key="logo-img"
                  title={logoTitle}
                  className="logo-X3hTV"
                  src={proxiedImage(logo)}
                  alt=" "
                  loading="lazy"
                  onError={onLogoError}
                  {...fadeProps}
                />
              ) : null}
            </AnimatePresence>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {isLoading ? (
              <motion.div
                key="meta-row-skeleton"
                className="runtime-release-info-container-9tY8q"
                {...fadeProps}
              >
                <SkeletonText width="5rem" height="1.25rem" />
                <SkeletonText width="7rem" height="1.25rem" />
                <SkeletonText width="3.5rem" height="1.25rem" />
              </motion.div>
            ) : (
              <motion.div
                key="meta-row-content"
                className="runtime-release-info-container-9tY8q"
                {...fadeProps}
              >
                {runtime ? <div className="runtime-label-ywyh7">{runtime}</div> : null}
                {released ? (
                  <div className="release-info-label-ywyh7">{released}</div>
                ) : releaseInfo ? (
                  <div className="release-info-label-ywyh7">{releaseInfo}</div>
                ) : null}
                <Rating
                  initialRating={imdbRating}
                  className="imdb-button-container-hTq0g"
                  iconClassName="icon-N_uIU"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            variants={sectionStagger}
            initial="hidden"
            animate={isLoading ? 'hidden' : 'show'}
          >
            {genres.length ? (
              <motion.div className="mt-6" variants={sectionItem}>
                <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Genres</div>
                <GenreChips
                  genres={genres}
                  onGenreClick={onGenreClick}
                  className="mt-3 flex flex-wrap gap-3"
                />
              </motion.div>
            ) : null}

            {cast.length ? (
              <motion.div className="mt-6" variants={sectionItem}>
                <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Cast</div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {cast.slice(0, 12).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 transition-transform hover:bg-white/15 active:scale-95"
                      onClick={() => onCastClick(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : null}

            {description ? (
              <motion.div className="mt-6 max-w-3xl" variants={sectionItem}>
                <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Summary</div>
                <p className="mt-2 text-sm leading-relaxed text-white/80">{description}</p>
              </motion.div>
            ) : null}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
