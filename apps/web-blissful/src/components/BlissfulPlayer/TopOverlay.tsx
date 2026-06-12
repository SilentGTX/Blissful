// Top-of-player overlay row. Bitcine-style: back-button on the left,
// HDR/RD badges on the right, plus a slot for the watch-party
// controls (the start menu / chip / participants UI) that lives in
// the same row so it doesn't collide with the bottom controls.
//
// Slides in from above on mount via the `bliss-player-top-slide-in`
// keyframe (see index.css). After mount, show/hide toggles use
// `translate-y-0` ↔ `-translate-y-full` so the row slides up out
// of view instead of fading in place — matches the bottom controls'
// behaviour for a coherent feel when the user moves the mouse.

import type { ReactNode } from 'react';
import { StremioIcon } from '../PlayerControlIcons';
import { PlayerHdrBadges } from './PlayerHdrBadges';
import { isIos } from '../../lib/playerEnv';

export type TopOverlayProps = {
  showControls: boolean;
  instantHideControls: boolean;
  headerPrimary: string | null;
  onBack: () => void;
  videoInfo: {
    colorTransfer?: string | null;
    width?: number | null;
  } | null;
  streamUrl: string;
  error: string | null;
  /** Optional slot rendered between the back-button and the badge
   *  cluster — used by BlissfulPlayer to mount the Watch Party
   *  controls in the top-right corner. */
  rightSlot?: ReactNode;
};

export function TopOverlay({
  showControls,
  instantHideControls,
  headerPrimary,
  onBack,
  videoInfo,
  streamUrl,
  error,
  rightSlot,
}: TopOverlayProps) {
  const videoGamma =
    videoInfo?.colorTransfer === 'smpte2084'
      ? 'pq'
      : videoInfo?.colorTransfer === 'arib-std-b67'
        ? 'hlg'
        : null;
  // iOS Safari can't reliably emit pointer events when controls toggle,
  // so on iOS we keep the row visible at all times — the iOS layout
  // depends on tap-on-video to hide / show natively.
  const visible = showControls || isIos();
  return (
    <div
      className={
        'bliss-player-top-slide-in pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 via-black/50 to-transparent px-6 pt-6 pb-4 transition-all ' +
        (instantHideControls ? 'duration-0 ' : 'duration-300 ') +
        (visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full')
      }
    >
      <div className="pointer-events-auto flex items-start justify-between gap-3">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/15"
          onClick={onBack}
        >
          <StremioIcon name="chevron-back" className="h-5 w-5" />
          <span className="max-w-[40vw] truncate">{headerPrimary ?? 'Back'}</span>
        </button>
        <div className="flex items-center gap-2">
          <PlayerHdrBadges
            videoGamma={videoGamma}
            streamUrl={streamUrl}
            error={error}
          />
          {rightSlot}
        </div>
      </div>
    </div>
  );
}
