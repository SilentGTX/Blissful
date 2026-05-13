// The scrub bar — extracted from NativeMpvPlayer so it can subscribe
// to the live playback clock independently of the parent's render
// cadence. mpv ticks `time-pos` at ~10 Hz; before this extraction the
// whole 2,800-line player re-rendered on every tick. Now only the
// scrub bar redraws on a tick, the surrounding controls only redraw on
// pause/volume/track changes.

import React, { useSyncExternalStore } from 'react';
import { playbackClock } from './playbackClock';

/** Subscribe to the live playback clock — fires at mpv's full tick rate. */
function usePlaybackClock(): number {
  return useSyncExternalStore(playbackClock.subscribe, playbackClock.get);
}

function formatTime(secs: number | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0) return '0:00';
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export type ScrubBarProps = {
  scrubValue: number | null;
  duration: number;
  onScrubInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  commitScrub: () => void;
  onScrubKey: (e: React.KeyboardEvent) => void;
};

export const ScrubBar = React.memo(function ScrubBar({
  scrubValue,
  duration,
  onScrubInput,
  commitScrub,
  onScrubKey,
}: ScrubBarProps) {
  const livePos = usePlaybackClock();
  const currentTime = scrubValue != null ? scrubValue : livePos;
  const progressPct =
    duration > 0
      ? Math.max(0, Math.min(100, (currentTime / duration) * 100))
      : 0;
  const fillStyle = {
    background: `linear-gradient(to right, var(--bliss-teal) 0%, var(--bliss-teal) ${progressPct}%, rgba(255,255,255,0.18) ${progressPct}%, rgba(255,255,255,0.18) 100%)`,
  };
  return (
    <div className="pointer-events-auto flex items-center gap-4 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-5 pb-1.5 pt-10 text-xs font-mono tabular-nums text-white">
      <span className="min-w-[56px] text-left">{formatTime(currentTime)}</span>
      <input
        type="range"
        className="bliss-player-range h-1 flex-1 cursor-pointer appearance-none rounded-full"
        min={0}
        max={Math.max(0.1, duration)}
        step={1}
        value={Math.min(currentTime, duration > 0 ? duration : currentTime)}
        onChange={onScrubInput}
        onMouseUp={commitScrub}
        onTouchEnd={commitScrub}
        onPointerUp={commitScrub}
        onKeyDown={onScrubKey}
        style={fillStyle}
        aria-label="Seek"
      />
      <span className="min-w-[56px] text-right">{formatTime(duration)}</span>
    </div>
  );
});
