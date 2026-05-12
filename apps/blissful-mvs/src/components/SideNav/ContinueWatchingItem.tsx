import { normalizeStremioImage } from '../../lib/stremioApi';
import type { LibraryItem } from '../../lib/stremioApi';
import { getContinueSubtitle } from './utils';
import { CloseIcon } from '../../icons/CloseIcon';

export type ContinueWatchingItemProps = {
  item: LibraryItem;
  // The parent decides whether to prompt for resume/start-over via a
  // modal or open immediately. We just signal "user clicked me" and let
  // the parent open the shared ResumeOrStartOverModal.
  onOpen: () => void;
  onRemove: (e: React.MouseEvent) => void;
  compact?: boolean;
};

export function ContinueWatchingItem({ item, onOpen, onRemove, compact = false }: ContinueWatchingItemProps) {
  const poster = normalizeStremioImage(item.poster);
  const progress = item.state?.duration
    ? Math.min(100, Math.max(0, ((item.state?.timeOffset ?? 0) / item.state.duration) * 100))
    : null;
  const subtitle = getContinueSubtitle(item);

  const paddingClass = compact ? 'p-2 pr-7' : 'p-3 pr-8';
  const iconSize = compact ? 12 : 14;

  return (
    <div
      key={item._id}
      className={`relative w-full cursor-pointer rounded-2xl bg-white/6 ${paddingClass} text-left hover:bg-white/10`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <button
        type="button"
        className="absolute right-2 top-2 cursor-pointer text-foreground/45 hover:text-foreground/80"
        aria-label="Remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(e);
        }}
      >
        <CloseIcon size={iconSize} />
      </button>

      <div className="flex items-center gap-3">
        <div className="h-10 w-10 overflow-hidden rounded-xl bg-white/10">
          {poster ? <img src={poster} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground/90">{item.name}</div>
          <div className="mt-1 text-xs">
            {subtitle.epLabel && (
              <span className="text-foreground/80">{subtitle.epLabel} · </span>
            )}
            <span className={subtitle.isExternal ? 'text-orange-400 font-semibold' : 'text-foreground/60'}>
              {subtitle.text}
            </span>
          </div>
          {progress !== null ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-emerald-400" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
