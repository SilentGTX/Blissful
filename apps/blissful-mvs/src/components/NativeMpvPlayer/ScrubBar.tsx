// The scrub bar — extracted from NativeMpvPlayer so it can subscribe
// to the live playback clock independently of the parent's render
// cadence. mpv ticks `time-pos` at ~10 Hz; before this extraction the
// whole 2,800-line player re-rendered on every tick. Now only the
// scrub bar redraws on a tick, the surrounding controls only redraw on
// pause/volume/track changes.

import React, {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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

  // Hover position tracking — drives the floating text-time tooltip
  // above the cursor. While dragging (scrubValue != null) we anchor
  // the tooltip to the drag position so the user always sees where
  // the release would land.
  //
  // `<input type="range">` positions its thumb so the CENTER of the
  // 18-px-wide thumb (see .bliss-player-range::*-slider-thumb in
  // index.css) lands at the click X. So the value math the browser
  // uses isn't `clickX / trackWidth × max`; it's
  //   value = (clickX − halfThumb) / (trackWidth − 2·halfThumb) × max
  // A naive `clickX / trackWidth` reading is off by up to
  // `halfThumb × (max / trackWidth)` seconds — at ~1100 px track and
  // ~52 min duration that's a ~6-second drift, exactly what the
  // tooltip-vs-seek mismatch reported. Mirror the browser's math so
  // the tooltip's timestamp matches the value the click will commit.
  const HALF_THUMB = 9;
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const [hoverPx, setHoverPx] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const computeHoverFromEvent = useCallback(
    (clientX: number) => {
      const el = sliderRef.current;
      if (!el || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 2 * HALF_THUMB) return;
      const rawX = clientX - rect.left;
      const trackInnerWidth = rect.width - 2 * HALF_THUMB;
      const clampedX = Math.max(
        HALF_THUMB,
        Math.min(rect.width - HALF_THUMB, rawX),
      );
      const pct = (clampedX - HALF_THUMB) / trackInnerWidth;
      // Round to the same integer second the range input will commit
      // on click — `step={1}` makes the browser snap to the nearest
      // integer, while `formatTime` truncates with `Math.floor`. The
      // mismatch produced a 1-second drift between the tooltip's
      // displayed timestamp and the actual seek target.
      setHoverPx(rawX);
      setHoverTime(Math.round(pct * duration));
    },
    [duration],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      computeHoverFromEvent(e.clientX);
    },
    [computeHoverFromEvent],
  );

  const onMouseLeave = useCallback(() => {
    setHoverPx(null);
    setHoverTime(null);
  }, []);

  // While dragging, prefer the drag value over the hover position so
  // the tooltip tracks the slider thumb, not the cursor. Use the
  // same value→pixel math as the browser so the tooltip stays
  // exactly above the thumb's center.
  const tooltipTime = scrubValue != null ? scrubValue : hoverTime;
  let tooltipPx: number | null = hoverPx;
  if (scrubValue != null && sliderRef.current && duration > 0) {
    const w = sliderRef.current.getBoundingClientRect().width;
    if (w > 2 * HALF_THUMB) {
      tooltipPx = HALF_THUMB + (scrubValue / duration) * (w - 2 * HALF_THUMB);
    }
  }

  return (
    <div className="pointer-events-auto flex items-center gap-4 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-5 pb-1.5 pt-10 text-xs font-mono tabular-nums text-white">
      <span className="min-w-[56px] text-left">{formatTime(currentTime)}</span>
      <div className="relative flex-1">
        {tooltipTime != null && tooltipPx != null ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2"
            style={{ left: `${tooltipPx}px`, bottom: '24px' }}
          >
            <div className="rounded-md border border-white/15 bg-black/85 px-2 py-1 text-xs font-mono tabular-nums text-white shadow-lg backdrop-blur">
              {formatTime(tooltipTime)}
            </div>
          </div>
        ) : null}
        <input
          ref={sliderRef}
          type="range"
          className="bliss-player-range h-1 w-full cursor-pointer appearance-none rounded-full"
          min={0}
          max={Math.max(0.1, duration)}
          step={1}
          value={Math.min(currentTime, duration > 0 ? duration : currentTime)}
          onChange={onScrubInput}
          onMouseUp={commitScrub}
          onTouchEnd={commitScrub}
          onPointerUp={commitScrub}
          onKeyDown={onScrubKey}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          style={fillStyle}
          aria-label="Seek"
        />
      </div>
      <span className="min-w-[56px] text-right">{formatTime(duration)}</span>
    </div>
  );
});
