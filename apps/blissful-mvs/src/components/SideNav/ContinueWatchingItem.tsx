import { normalizeStremioImage } from '../../lib/stremioApi';
import type { LibraryItem } from '../../lib/stremioApi';
import { getContinueSubtitle } from './utils';
import { CloseIcon } from '../../icons/CloseIcon';
import { TruncatedText } from '../TruncatedText';


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

  // Padding clamps with viewport so on tall screens each card has
  // visibly more chrome (bigger touch target, more breathing room)
  // and on short screens it stays dense. The non-compact variant
  // (used in side drawers) keeps its original sizing.
  const paddingClass = compact ? 'p-[clamp(0.375rem,1vh,0.625rem)] pr-[clamp(1.25rem,2.5vh,1.75rem)]' : 'p-3 pr-8';
  const iconSize = compact ? 12 : 14;

  return (
    <div
      key={item._id}
      className={`relative w-full shrink-0 snap-start cursor-pointer rounded-2xl bg-white/6 ${paddingClass} text-left hover:bg-white/10`}
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

      <div className={`flex items-center ${compact ? 'gap-[clamp(0.5rem,1vh,0.75rem)]' : 'gap-3'}`}>
        <div className={`shrink-0 overflow-hidden bg-white/10 ${compact ? 'h-[clamp(2rem,4.5vh,3rem)] w-[clamp(2rem,4.5vh,3rem)] rounded-xl' : 'h-10 w-10 rounded-xl'}`}>
          {poster ? <img src={poster} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <TruncatedText content={item.name} placement="right" className={`truncate font-medium text-foreground/90 ${compact ? 'text-[clamp(12px,1.6vh,15px)] leading-tight' : 'text-sm'}`} />
          <div className={`${compact ? 'mt-[clamp(0.125rem,0.5vh,0.375rem)] text-[clamp(10px,1.3vh,12px)]' : 'mt-1 text-xs'} flex items-center gap-1.5 min-w-0`}>
            {subtitle.epLabel && (
              <span className="text-foreground/80 shrink-0">{subtitle.epLabel} · </span>
            )}
            <span className={`truncate ${subtitle.isExternal ? 'text-orange-400 font-semibold' : 'text-foreground/60'}`}>
              {subtitle.text}
            </span>
            {subtitle.source === 'stremio' ? (
              <>
                <span className="text-foreground/80 shrink-0">·</span>
                <span className="shrink-0 rounded bg-purple-600 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>STREM</span>
              </>
            ) : subtitle.source === 'web' ? (
              <>
                <span className="text-foreground/80 shrink-0">·</span>
                <span className="shrink-0 rounded bg-blue-500 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>WEB</span>
              </>
            ) : subtitle.source === 'app' ? (
              <>
                <span className="text-foreground/80 shrink-0">·</span>
                <span className="shrink-0 rounded bg-yellow-600 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>APP</span>
              </>
            ) : null}
          </div>
          {progress !== null ? (
            <div className={`overflow-hidden rounded-full bg-white/10 ${compact ? 'mt-[clamp(0.25rem,0.7vh,0.5rem)] h-[clamp(3px,0.6vh,6px)]' : 'mt-2 h-1.5'}`}>
              <div className="h-full bg-[var(--bliss-accent)]" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
