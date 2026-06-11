import StremioIcon from '../../../components/StremioIcon';
import { LibraryActionButton } from '../../../components/LibraryActionButton';

type ActionButtonsProps = {
  inLibrary: boolean;
  hasTrailer: boolean;
  onToggleLibrary: () => void;
  onOpenTrailer: () => void;
  onShare: () => void;
  /** When provided, renders a primary accent Play button in the row.
   *  Hidden otherwise (iOS, where the stream picker is the expected UX). */
  onPlay?: (() => void) | null;
  /** Library is per-user; for guests the button has nowhere to write.
   *  Hidden entirely (not just disabled) when not logged in. */
  isLoggedIn?: boolean;
};

export function MobileActionButtons({
  inLibrary,
  hasTrailer,
  onToggleLibrary,
  onOpenTrailer,
  onShare,
  onPlay,
  isLoggedIn = true,
}: ActionButtonsProps) {
  return (
    <div className="fixed right-4 top-4 z-50 flex items-center gap-2 lg:hidden">
      {onPlay ? (
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/95 text-[#05070a] transition-all duration-200 hover:bg-white hover:shadow-[0_0_20px_rgba(255,255,255,0.35)] active:scale-[0.98]"
          onClick={onPlay}
          aria-label="Play"
        >
          <svg
            className="h-5 w-5"
            fill="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {/* Centroid at (12,12) — a right-pointing triangle's mass
                concentrates near the base, so a bbox-centered triangle
                visually leans left. Aligning the centroid (not the
                bounding box) to the viewBox center is the standard
                "optically centered" fix. */}
            <polygon points="8,5 20,12 8,19" />
          </svg>
        </button>
      ) : null}
      {isLoggedIn ? (
        <button
          type="button"
          className={`grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/50 backdrop-blur transition-colors ${inLibrary ? 'text-[var(--bliss-accent)]' : 'text-white'}`}
          onClick={onToggleLibrary}
          aria-label={inLibrary ? 'Remove from library' : 'Add to library'}
        >
          <StremioIcon
            name={inLibrary ? 'remove-from-library' : 'add-to-library'}
            className="h-5 w-5"
          />
        </button>
      ) : null}

      <button
        type="button"
        className={`grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/50 backdrop-blur text-white transition-colors ${!hasTrailer ? 'opacity-40' : 'hover:bg-white/20'}`}
        onClick={onOpenTrailer}
        disabled={!hasTrailer}
        aria-label="Trailer"
      >
        <StremioIcon name="trailer" className="h-5 w-5" />
      </button>

      <button
        type="button"
        className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/50 backdrop-blur text-white transition-colors hover:bg-white/20"
        onClick={onShare}
        aria-label="Share"
      >
        <StremioIcon name="share" className="h-5 w-5" />
      </button>
    </div>
  );
}

export function DesktopActionButtons({
  inLibrary,
  hasTrailer,
  onToggleLibrary,
  onOpenTrailer,
  onShare,
  onPlay,
  isLoggedIn = true,
}: ActionButtonsProps) {
  return (
    <div className="hidden lg:block">
      <div className="action-buttons-container-Pn4hZ">
        <div className="label">Actions</div>

        {onPlay ? (
          <button
            type="button"
            className="action-button-Pn4hZ is-play"
            onClick={onPlay}
            aria-label="Play"
          >
            <StremioIcon name="play" className="icon" />
            <span className="text">Play</span>
          </button>
        ) : null}

        {isLoggedIn ? (
          <LibraryActionButton inLibrary={inLibrary} onToggleLibrary={onToggleLibrary} />
        ) : null}

        <button
          type="button"
          className={'action-button-Pn4hZ' + (!hasTrailer ? ' is-disabled' : '')}
          onClick={onOpenTrailer}
          aria-label="Trailer"
        >
          <StremioIcon name="trailer" className="icon" />
          <span className="text">Trailer</span>
        </button>

        <button type="button" className="action-button-Pn4hZ" onClick={onShare} aria-label="Share">
          <StremioIcon name="share" className="icon" />
          <span className="text">Share</span>
        </button>
      </div>
    </div>
  );
}
