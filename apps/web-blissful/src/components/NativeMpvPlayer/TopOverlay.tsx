// Top-of-player overlay row. Back-button pill on the left, HDR/4K/RD
// badges on the right. Slides in from above via translate-y transition.
// Matches OpenCode's BlissfulPlayer TopOverlay visual layout, adapted
// for the native mpv backend (our PlayerHdrBadges accept videoDwidth +
// streamTitle for 4K detection from mpv's decoded dimensions).

import type { ReactNode } from 'react';
import { PlayerControlIcon as StremioIcon } from '../PlayerControlIcons';
import { PlayerHdrBadges } from './PlayerHdrBadges';

export type TopOverlayProps = {
  showControls: boolean;
  headerPrimary: string;
  onBack: () => void;
  videoGamma: string | null;
  videoDwidth: number | null;
  streamTitle: string | null;
  streamUrl: string | null;
  error: string | null;
  /** Optional element rendered in the top-right area next to the HDR badges. */
  rightSlot?: ReactNode;
};

export function TopOverlay({
  showControls,
  headerPrimary,
  onBack,
  videoGamma,
  videoDwidth,
  streamTitle,
  streamUrl,
  error,
  rightSlot,
}: TopOverlayProps) {
  return (
    <div
      className={
        'bliss-player-top-slide-in pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 via-black/50 to-transparent px-6 pt-6 pb-4 transition-all duration-300 ' +
        (showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full')
      }
    >
      <div className="pointer-events-auto flex items-start justify-between gap-3">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/15"
          onClick={onBack}
        >
          <StremioIcon name="chevron-back" className="h-5 w-5" />
          <span className="max-w-[40vw] truncate">{headerPrimary}</span>
        </button>
        <div className="flex items-center gap-2">
          <PlayerHdrBadges
            videoGamma={videoGamma}
            videoDwidth={videoDwidth}
            streamTitle={streamTitle}
            streamUrl={streamUrl}
            error={error}
          />
          {rightSlot}
        </div>
      </div>
    </div>
  );
}
