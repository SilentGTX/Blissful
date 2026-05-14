import type { MediaItem } from '../types/media';
import { Card, Chip } from '@heroui/react';
import { InfoIcon } from '../icons/InfoIcon';
import { ImdbIcon } from '../icons/ImdbIcon';
import { PlayIcon } from '../icons/PlayIcon';
import { useImdbRating } from '../lib/useImdbRating';

type MediaCardProps = {
  item: MediaItem;
  variant?: 'poster' | 'details';
  selected?: boolean;
  progress?: number | null;
  onPress?: () => void;
  showHoverActions?: boolean;
  onPlay?: () => void;
  onInfo?: () => void;
};

function formatRating(rating?: number) {
  if (rating === undefined || Number.isNaN(rating)) return null;
  return rating.toFixed(1);
}

export default function MediaCard({
  item,
  variant = 'details',
  selected = false,
  progress,
  onPress,
  showHoverActions = false,
  onPlay,
  onInfo,
}: MediaCardProps) {
  const imdbId = /^tt\d{5,}$/.test(item.id) ? item.id : null;
  const resolvedRating = useImdbRating(imdbId, item.rating ?? null);
  const rating = formatRating(resolvedRating ?? undefined);
  const subtitle = [item.year, item.runtime].filter(Boolean).join(' \u00b7 ');

  const handlePlay = () => {
    if (onPlay) {
      onPlay();
      return;
    }
    if (onPress) onPress();
  };

  const handleInfo = () => {
    if (onInfo) {
      onInfo();
      return;
    }
    if (onPress) onPress();
  };

  if (variant === 'poster') {
    const p = typeof progress === 'number' && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : null;
    return (
      <div className="group/poster w-full">
        <div
          className={
            'cursor-pointer touch-manipulation ' +
            (showHoverActions ? 'netflix-card-wrap' : '')
          }
          onClick={onPress}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
          }}
          onTouchEnd={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          role="button"
          tabIndex={onPress ? 0 : undefined}
          onKeyDown={onPress ? (e) => { if (e.key === 'Enter' || e.key === ' ') onPress(); } : undefined}
        >
          <Card
            className={
              'group rounded-2xl p-0 shadow-[0_18px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl border-0 ' +
              (showHoverActions ? ' netflix-card' : '') +
              (selected ? 'solid-surface bg-white/10' : '')
            }
          >
            <Card.Content className="p-0 overflow-hidden">
              <div className="relative poster-aspect overflow-hidden">
                {item.posterUrl ? (
                  <img
                    src={item.posterUrl}
                    alt={`${item.title} poster`}
                    className="h-full w-full rounded-2xl object-cover transition-transform duration-300 group-hover:scale-110"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center rounded-2xl bg-white/10 text-3xl font-semibold">
                    {item.title.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {rating ? (
                  <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-sm font-semibold text-white backdrop-blur">
                    <span>{rating}</span>
                    <ImdbIcon className="h-6 w-6 text-[#f5c518]" />
                  </div>
                ) : null}

                {showHoverActions ? (
                  <div className="netflix-card-overlay">
                    <div className="netflix-card-actions">
                      <button
                        type="button"
                        className="netflix-action-btn netflix-action-btn-play"
                        aria-label="Play"
                        onClick={(event) => {
                          event.stopPropagation();
                          handlePlay();
                        }}
                      >
                        <PlayIcon size={16} />
                        <span>Play</span>
                      </button>
                      <button
                        type="button"
                        className="netflix-action-btn netflix-action-btn-info"
                        aria-label="Info"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleInfo();
                        }}
                      >
                        <InfoIcon size={16} />
                        <span>Info</span>
                      </button>
                    </div>
                  </div>
                ) : null}

                {p !== null && p > 0 ? (
                  <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10">
                    <div className="relative h-1.5 overflow-hidden rounded-full">
                      <div className="absolute inset-0 bg-black/35" />
                      <div className="absolute inset-y-0 left-0 bg-emerald-400" style={{ width: `${p}%` }} />
                    </div>
                  </div>
                ) : null}
              </div>
            </Card.Content>
          </Card>
        </div>
        <div className="mt-3 text-center text-sm font-medium text-foreground/90 line-clamp-2 transition-colors duration-500 ease-out group-hover/poster:text-[var(--bliss-teal)]">
          {item.title}
        </div>
      </div>
    );
  }

  return (
    <div
      className={onPress ? 'cursor-pointer' : ''}
      onClick={onPress}
      role="button"
      tabIndex={onPress ? 0 : undefined}
      onKeyDown={onPress ? (e) => { if (e.key === 'Enter' || e.key === ' ') onPress(); } : undefined}
    >
      <Card
        className={
          'group rounded-2xl shadow-[0_18px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl border border-white/10 ' +
          'hover:border-white hover:shadow-[0_0_25px_rgba(255,255,255,0.3),0_0_50px_rgba(255,255,255,0.15),inset_0_0_20px_rgba(255,255,255,0.1)] hover:bg-white/10 ' +
          (selected
            ? 'solid-surface border-white shadow-[0_0_25px_rgba(255,255,255,0.3),0_0_50px_rgba(255,255,255,0.15),inset_0_0_20px_rgba(255,255,255,0.1)] bg-white/10'
            : '')
        }
      >
        <Card.Content className="p-3">
          <div className="relative overflow-hidden rounded-2xl">
            {item.posterUrl ? (
              <img
                src={item.posterUrl}
                alt={`${item.title} poster`}
                className="h-[260px] w-full object-cover transition-transform duration-300 group-hover:scale-110"
              />
            ) : (
              <div className="grid h-[260px] w-full place-items-center bg-white/10 text-3xl font-semibold">
                {item.title.slice(0, 1).toUpperCase()}
              </div>
            )}
            {rating ? (
              <div className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-sm font-semibold text-white backdrop-blur">
                <span>{rating}</span>
                <ImdbIcon className="h-6 w-6 text-[#f5c518]" />
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{item.title}</div>
              {subtitle ? <div className="mt-0.5 text-xs text-foreground/60">{subtitle}</div> : null}
            </div>
            <Chip size="sm" variant="soft" className="shrink-0 capitalize">
              {item.type}
            </Chip>
          </div>

          {item.blurb ? <div className="mt-2 line-clamp-2 text-xs text-foreground/75">{item.blurb}</div> : null}

          {item.genres && item.genres.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.genres.slice(0, 3).map((genre) => (
                <Chip key={`${item.id}-${genre}`} size="sm" variant="secondary">
                  {genre}
                </Chip>
              ))}
            </div>
          ) : null}
        </Card.Content>
      </Card>
    </div>
  );
}
