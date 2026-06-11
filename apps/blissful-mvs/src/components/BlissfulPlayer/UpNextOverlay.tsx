// "Up Next" auto-advance card — appears in the bottom-right ~10s
// before the end of an episode (or in the post-credits silence if no
// credits are detected). When bingeWatching is on, a countdown bar
// fills in for 10s and auto-fires `advanceToNextEpisode`; otherwise
// the user has to click Play Now manually. Cancel hides the card for
// the current episode (resets when a new episode loads).
//
// Suppressed entirely when the next episode hasn't aired yet, so we
// never advertise a "play next" button that silently does nothing.

import type { NextEpisodeInfo } from '../../pages/PlayerPage';
import type { PlayerSettings } from '../../lib/playerSettings';
import { proxiedImage } from '../../lib/imageProxy';

export type UpNextOverlayProps = {
  visible: boolean;
  nextEpisodeInfo: NextEpisodeInfo | null | undefined;
  countdown: number;
  playerSettings: PlayerSettings;
  onCancel: () => void;
  onAdvance: () => void;
};

export function UpNextOverlay({
  visible,
  nextEpisodeInfo,
  countdown,
  playerSettings,
  onCancel,
  onAdvance,
}: UpNextOverlayProps) {
  if (!visible || !nextEpisodeInfo) return null;
  // Don't surface the card when the next episode is in the future —
  // pressing Play Now would land on a 404.
  if (
    nextEpisodeInfo.nextReleased
    && Number.isFinite(Date.parse(nextEpisodeInfo.nextReleased))
    && Date.parse(nextEpisodeInfo.nextReleased) > Date.now()
  ) {
    return null;
  }
  return (
    <div className="absolute right-4 bottom-24 z-30 w-[min(340px,90vw)] overflow-hidden rounded-2xl border border-white/10 bg-black/80 text-white backdrop-blur sm:right-6 sm:bottom-28">
      {/* Episode thumbnail */}
      {nextEpisodeInfo.nextThumbnail ? (
        <div className="relative aspect-video w-full overflow-hidden">
          <img
            src={proxiedImage(nextEpisodeInfo.nextThumbnail)}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          <div className="absolute bottom-2 left-3 text-[10px] font-medium uppercase tracking-wider text-white/60">
            Up Next
          </div>
        </div>
      ) : (
        <div className="px-4 pt-4 text-[10px] font-medium uppercase tracking-wider text-white/50">
          Up Next
        </div>
      )}
      <div className="p-4 pt-2">
        <div className="mb-3 text-sm font-semibold leading-snug">
          {nextEpisodeInfo.nextEpisodeTitle}
        </div>
        {/* Countdown progress bar (only when binge-watching auto-advances) */}
        {playerSettings.bingeWatching ? (
          <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[var(--bliss-accent)] transition-all duration-1000 ease-linear"
              style={{ width: `${(countdown / 10) * 100}%` }}
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="cursor-pointer rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-full bg-[var(--bliss-accent)] px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-[#14dbb8]"
            onClick={onAdvance}
          >
            Play Now
          </button>
        </div>
        {playerSettings.bingeWatching ? (
          <div className="mt-2 text-center text-[10px] text-white/30">
            Playing in {countdown}s
          </div>
        ) : null}
      </div>
    </div>
  );
}
