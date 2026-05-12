import StremioIcon from '../../../components/StremioIcon';
import { LibraryActionButton } from '../../../components/LibraryActionButton';

type ActionButtonsProps = {
  inLibrary: boolean;
  hasTrailer: boolean;
  onToggleLibrary: () => void;
  onOpenTrailer: () => void;
  onShare: () => void;
};

export function MobileActionButtons({
  inLibrary,
  hasTrailer,
  onToggleLibrary,
  onOpenTrailer,
  onShare,
}: ActionButtonsProps) {
  return (
    <div className="fixed right-4 top-4 z-50 flex items-center gap-2 lg:hidden">
      <button
        type="button"
        className={`grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/50 backdrop-blur transition-colors ${inLibrary ? 'text-emerald-400' : 'text-white'}`}
        onClick={onToggleLibrary}
        aria-label={inLibrary ? 'Remove from library' : 'Add to library'}
      >
        <StremioIcon
          name={inLibrary ? 'remove-from-library' : 'add-to-library'}
          className="h-5 w-5"
        />
      </button>

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
}: ActionButtonsProps) {
  return (
    <div className="hidden lg:block">
      <div className="action-buttons-container-Pn4hZ">
        <div className="label">Actions</div>

        <LibraryActionButton inLibrary={inLibrary} onToggleLibrary={onToggleLibrary} />

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
