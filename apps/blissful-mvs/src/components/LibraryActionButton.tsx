import StremioIcon from './StremioIcon';
import { useTvFocusable } from '../spatial/useTvFocusable';

type LibraryActionButtonProps = {
  inLibrary: boolean;
  onToggleLibrary: () => void;
  className?: string;
  /** Claim D-pad focus on mount (route-entry) on TV. */
  autoFocusTv?: boolean;
};

export function LibraryActionButton({ inLibrary, onToggleLibrary, className, autoFocusTv }: LibraryActionButtonProps) {
  const { ref } = useTvFocusable({ onPress: onToggleLibrary, autoFocus: autoFocusTv });
  return (
    <button
      ref={ref}
      type="button"
      className={`action-button-Pn4hZ${inLibrary ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onToggleLibrary}
      aria-label={inLibrary ? 'Remove from library' : 'Add to library'}
    >
      <StremioIcon name={inLibrary ? 'remove-from-library' : 'add-to-library'} className="icon" />
      <span className="text">{inLibrary ? 'Remove from library' : 'Add to library'}</span>
    </button>
  );
}
