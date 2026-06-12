import StremioIcon from './StremioIcon';

type LibraryActionButtonProps = {
  inLibrary: boolean;
  onToggleLibrary: () => void;
  className?: string;
};

export function LibraryActionButton({ inLibrary, onToggleLibrary, className }: LibraryActionButtonProps) {
  return (
    <button
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
