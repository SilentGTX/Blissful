import { useState } from 'react';
import { StremioIcon } from '../PlayerControlIcons';
import { volumeFillColor } from '../../lib/colorUtils';

// Stripped-down chrome for the mini-player window: play/pause, mute + volume
// slider, time, a seek scrubber, expand and close. The whole bar fades in on
// hover (like the full player), and every control stops pointer propagation so
// clicking it doesn't drag the window — the bare video surface is the drag
// handle (handled by MiniPlayerWindow).
type MiniControlsProps = {
  isPlaying: boolean;
  togglePlay: () => void;
  muted: boolean;
  toggleMute: () => void;
  volume: number;
  videoRef: { current: HTMLVideoElement | null };
  currentTime: number;
  duration: number;
  formattedTime: (seconds: number) => string;
  setCurrentTime: (t: number) => void;
  onUserSeek?: (t: number) => void;
  onExpand?: () => void;
  onClose?: () => void;
};

export function MiniControls(props: MiniControlsProps) {
  const {
    isPlaying, togglePlay, muted, toggleMute, volume, videoRef,
    currentTime, duration, formattedTime, setCurrentTime, onUserSeek, onExpand, onClose,
  } = props;

  const [scrubDragValue, setScrubDragValue] = useState<number | null>(null);
  const isScrubbing = scrubDragValue !== null;
  const displayedScrub = isScrubbing ? scrubDragValue : Math.min(currentTime, duration || 0);
  const v = muted ? 0 : volume;
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();
  const setVol = (next: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(next)) return;
    video.volume = next;
    video.muted = next === 0;
  };

  // Reveal-on-hover: invisible AND click-through until the cursor is over the
  // window, so the hidden controls never steal a drag.
  const reveal =
    'pointer-events-none opacity-0 transition-opacity duration-150 group-hover/mini:pointer-events-auto group-hover/mini:opacity-100';

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between">
      <div className={`flex justify-end gap-1 p-1.5 ${reveal}`}>
        <button type="button" aria-label="Expand" onPointerDown={stopDrag} onClick={onExpand}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/75">
          <StremioIcon name="maximize" className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label="Close player" onPointerDown={stopDrag} onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/75">
          <StremioIcon name="x" className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className={reveal}>
        {/* Inset from the very bottom/sides so the edge resize handles stay
            grabbable underneath. */}
        <div className="bg-gradient-to-t from-black/85 to-transparent px-3 pb-2.5 pt-6">
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onPointerDown={stopDrag} onClick={togglePlay}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15">
              <StremioIcon name={isPlaying ? 'pause' : 'play'} className="h-4 w-4" />
            </button>
            <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} onPointerDown={stopDrag} onClick={toggleMute}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15">
              <StremioIcon name={v === 0 ? 'volume-mute' : v < 0.3 ? 'volume-low' : v < 0.7 ? 'volume-medium' : 'volume-high'} className="h-4 w-4" />
            </button>
            <input
              className="bliss-player-volume h-1 w-14 shrink-0 cursor-pointer appearance-none rounded-full"
              type="range" min={0} max={1} step={0.01} value={v}
              style={{ ['--bliss-track-fill' as string]: `${v * 100}%`, ['--bliss-volume-fill' as string]: volumeFillColor(v) } as React.CSSProperties}
              onPointerDown={stopDrag}
              onChange={(e) => setVol(Number.parseFloat(e.target.value))}
              aria-label="Volume"
            />
            <span className="ml-auto truncate pl-1 text-[10px] tabular-nums text-white/70">{formattedTime(currentTime)}</span>
          </div>
          <input
            className="bliss-player-range mt-1.5 block h-1.5 w-full cursor-pointer appearance-none rounded-full"
            type="range" min={0} max={Math.max(0.1, duration)} step="any" value={displayedScrub}
            style={{
              ['--bliss-track-fill' as string]:
                duration > 0 ? `${Math.min(100, Math.max(0, (displayedScrub / duration) * 100))}%` : '0%',
            } as React.CSSProperties}
            onPointerDown={(e) => { e.stopPropagation(); setScrubDragValue(Math.min(currentTime, duration || 0)); }}
            onPointerUp={() => setScrubDragValue(null)}
            onPointerCancel={() => setScrubDragValue(null)}
            onChange={(e) => {
              const next = Number.parseFloat(e.target.value);
              if (!Number.isFinite(next)) return;
              const video = videoRef.current;
              if (!video) return;
              video.currentTime = next;
              setCurrentTime(next);
              onUserSeek?.(next);
              if (isScrubbing) setScrubDragValue(next);
            }}
            aria-label="Seek"
          />
        </div>
      </div>
    </div>
  );
}
