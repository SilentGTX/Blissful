// Bottom controls overlay -- slides in from below via the
// `bliss-player-bottom-slide-in` keyframe. Two stacked strips:
//   1. Gradient scrub strip with timestamps + the seek slider
//   2. Solid black/85 transport strip with play/pause, mute, volume,
//      next-episode, episodes-drawer, subtitles, audio, and fullscreen
//
// Adapted from OpenCode's BlissfulPlayer BottomControls for our mpv
// backend: uses playbackClock external store for smooth slider,
// desktop.seek() via onSeek callback, and desktop.mpv volume via
// onVolumeChange callback instead of videoRef.

import { useState, useCallback, useRef, useSyncExternalStore } from 'react';
import { BlissTooltip } from '../BlissTooltip';
import { playbackClock } from './playbackClock';
import {
  PlayerControlIcon as StremioIcon,
  type StremioIconName,
} from '../PlayerControlIcons';
import type { NextEpisodeInfo } from '../../pages/PlayerPage';
import type { SettingsTab } from './SettingsPanel';
import { volumeFillColor } from '../../lib/colorUtils';

/** Subscribe to the live playback clock at mpv's full tick rate. */
function usePlaybackClock(): number {
  return useSyncExternalStore(playbackClock.subscribe, playbackClock.get);
}

function formatTime(secs: number | undefined, duration: number): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0 || duration <= 0) {
    return duration >= 3600 ? '--:--:--' : '--:--';
  }
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0 || duration >= 3600) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export type BottomControlsProps = {
  showControls: boolean;
  instantHideControls: boolean;

  // Scrub bar
  /** While dragging, holds the local drag position; null when idle. */
  scrubValue: number | null;
  duration: number;
  onScrubInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  commitScrub: () => void;
  onScrubKey: (e: React.KeyboardEvent) => void;

  // Transport
  paused: boolean;
  togglePlay: () => void;
  muted: boolean;
  toggleMute: () => void;
  /** mpv volume mapped to 0-2 (0 = silent, 1 = unity, 2 = 200% amp). */
  volume01: number;
  volumeIcon: StremioIconName;
  onVolumeChange: (v01: number) => void;

  // Right-side buttons
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  nextEpisodeInfo?: NextEpisodeInfo | null;
  advanceToNextEpisode: () => void;

  // Settings + Episodes drawer triggers
  openSettings: (tab: SettingsTab) => void;
  isSeriesLike?: boolean;
  toggleEpisodes?: () => void;
  /** In RD fallback mode, whether there are alternative torrents to switch
   *  between -- surfaces a "Releases" cloud icon that opens the Releases tab. */
  hasReleases?: boolean;
};

export function BottomControls(props: BottomControlsProps) {
  const {
    showControls,
    instantHideControls,
    scrubValue,
    duration,
    onScrubInput,
    commitScrub,
    onScrubKey,
    paused,
    togglePlay,
    muted,
    toggleMute,
    volume01,
    volumeIcon,
    onVolumeChange,
    isFullscreen,
    onToggleFullscreen,
    nextEpisodeInfo,
    advanceToNextEpisode,
    openSettings,
    isSeriesLike,
    toggleEpisodes,
    hasReleases,
  } = props;

  const livePos = usePlaybackClock();
  const currentTime = scrubValue != null ? scrubValue : livePos;

  // While the user is actively dragging the scrub thumb, the
  // controlled `value` prop fights mpv's time-pos updates (each
  // one re-renders the slider and snaps its value back to the
  // playhead). Track local drag state + drag value so the slider
  // reads `dragValue` until pointer up.
  const [scrubDragValue, setScrubDragValue] = useState<number | null>(null);
  const isScrubbing = scrubDragValue !== null;
  const displayedScrubValue = isScrubbing
    ? scrubDragValue
    : Math.min(currentTime, duration || 0);

  // Hover tooltip for scrub bar
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
      const clampedX = Math.max(HALF_THUMB, Math.min(rect.width - HALF_THUMB, rawX));
      const pct = (clampedX - HALF_THUMB) / trackInnerWidth;
      setHoverPx(rawX);
      setHoverTime(Math.round(pct * duration));
    },
    [duration],
  );

  // While dragging, anchor tooltip to drag value
  const tooltipTime = scrubValue != null ? scrubValue : hoverTime;
  let tooltipPx: number | null = hoverPx;
  if (scrubValue != null && sliderRef.current && duration > 0) {
    const w = sliderRef.current.getBoundingClientRect().width;
    if (w > 2 * HALF_THUMB) {
      tooltipPx = HALF_THUMB + (scrubValue / duration) * (w - 2 * HALF_THUMB);
    }
  }

  return (
    <div
      className={
        'bliss-player-bottom-slide-in pointer-events-none absolute inset-x-0 bottom-0 z-20 transition-all ' +
        (instantHideControls ? 'duration-0 ' : 'duration-300 ') +
        (showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full')
      }
    >
      <div className="pointer-events-auto flex items-center gap-4 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-5 pb-1.5 pt-10 text-xs font-mono tabular-nums text-white">
        <span className="min-w-[56px] text-left">{formatTime(currentTime, duration)}</span>
        <div className="relative flex-1">
          {tooltipTime != null && tooltipPx != null ? (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2"
              style={{ left: `${tooltipPx}px`, bottom: '24px' }}
            >
              <div className="rounded-md border border-white/15 bg-black/85 px-2 py-1 text-xs font-mono tabular-nums text-white shadow-lg backdrop-blur">
                {formatTime(tooltipTime, duration)}
              </div>
            </div>
          ) : null}
          <input
            ref={sliderRef}
            className="bliss-player-range h-1 w-full cursor-pointer appearance-none rounded-full"
            type="range"
            min={0}
            max={Math.max(0.1, duration)}
            step={1}
            value={displayedScrubValue}
            style={{
              ['--bliss-track-fill' as string]:
                duration > 0
                  ? `${Math.min(100, Math.max(0, (displayedScrubValue / duration) * 100))}%`
                  : '0%',
            } as React.CSSProperties}
            onPointerDown={() => {
              // Freeze the controlled value at the current playhead
              // so the user can drag without time-pos snap-back.
              setScrubDragValue(Math.min(currentTime, duration || 0));
            }}
            onPointerUp={() => {
              setScrubDragValue(null);
            }}
            onPointerCancel={() => {
              setScrubDragValue(null);
            }}
            onChange={(event) => {
              const next = Number.parseFloat(event.target.value);
              if (!Number.isFinite(next)) return;
              onScrubInput(event);
              // Only mirror into the drag-frozen value while a drag is
              // in progress (i.e. scrubDragValue is non-null);
              // otherwise the next click-to-seek would leave the
              // local drag state stuck at the click position.
              if (isScrubbing) setScrubDragValue(next);
            }}
            onMouseUp={commitScrub}
            onTouchEnd={commitScrub}
            onMouseMove={(e) => computeHoverFromEvent(e.clientX)}
            onMouseLeave={() => {
              setHoverPx(null);
              setHoverTime(null);
            }}
            onKeyDown={onScrubKey}
            aria-label="Seek"
          />
        </div>
        <span className="min-w-[56px] text-right">{formatTime(duration, duration)}</span>
      </div>

      <div className="pointer-events-auto flex items-center justify-between gap-3 bg-black/85 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
            onClick={togglePlay}
            aria-label={paused ? 'Play' : 'Pause'}
          >
            {paused ? <StremioIcon name="play" className="h-6 w-6" /> : <StremioIcon name="pause" className="h-6 w-6" />}
          </button>
          <button
            type="button"
            className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            <StremioIcon name={volumeIcon} className="h-5 w-5" />
          </button>
          <input
            className="bliss-player-volume h-1 w-28 cursor-pointer appearance-none rounded-full"
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={muted ? 0 : volume01}
            style={{
              ['--bliss-track-fill' as string]: `${(muted ? 0 : volume01 / 2) * 100}%`,
              ['--bliss-volume-fill' as string]: volumeFillColor(muted ? 0 : volume01 / 2),
            } as React.CSSProperties}
            onChange={(event) => {
              const next = Number.parseFloat(event.target.value);
              if (!Number.isFinite(next)) return;
              onVolumeChange(next);
            }}
            aria-label="Volume"
          />
        </div>
        <div className="flex items-center gap-1">
          {/* Next-episode (series only) -- instant jump to next ep. When
              the next episode hasn't aired, render disabled with a
              tooltip explaining why. */}
          {(() => {
            if (!nextEpisodeInfo) return null;
            const releaseMs = nextEpisodeInfo.nextReleased ? Date.parse(nextEpisodeInfo.nextReleased) : NaN;
            const isUnreleased = Number.isFinite(releaseMs) && releaseMs > Date.now();
            const releaseDateLabel = isUnreleased
              ? new Date(releaseMs).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : null;
            const isDisabled = isUnreleased;
            const tooltipText = isDisabled
              ? releaseDateLabel
                ? `Next episode airs ${releaseDateLabel}`
                : 'Next episode hasn\'t aired yet'
              : 'Next episode';
            return (
              <BlissTooltip content={tooltipText} placement="top">
                <button
                  type="button"
                  className={
                    'bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full' +
                    (isDisabled ? ' cursor-not-allowed opacity-40' : '')
                  }
                  onClick={isDisabled ? undefined : advanceToNextEpisode}
                  aria-label="Next episode"
                  aria-disabled={isDisabled || undefined}
                  disabled={isDisabled}
                >
                  <StremioIcon name="skip-forward" className="h-5 w-5" />
                </button>
              </BlissTooltip>
            );
          })()}
          {/* Episodes drawer (series only). */}
          {isSeriesLike && toggleEpisodes ? (
            <button
              type="button"
              className="bliss-player-icon-btn flex h-10 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium"
              onClick={toggleEpisodes}
              aria-label="Episodes"
              title="Episodes"
            >
              <StremioIcon name="episodes" className="h-5 w-5" />
              <span className="hidden md:inline">Episodes</span>
            </button>
          ) : null}
          <BlissTooltip content="Subtitles" placement="top">
            <button
              type="button"
              className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
              onClick={() => openSettings('subtitles')}
              aria-label="Subtitles"
            >
              <StremioIcon name="subtitles" className="h-5 w-5" />
            </button>
          </BlissTooltip>
          <BlissTooltip content="Audio tracks" placement="top">
            <button
              type="button"
              className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
              onClick={() => openSettings('audio')}
              aria-label="Audio tracks"
            >
              <StremioIcon name="audio-tracks" className="h-5 w-5" />
            </button>
          </BlissTooltip>
          {/* Releases (Real-Debrid fallback) -- opens the unified menu on the
              Releases tab to switch the played torrent. Only shown when the RD
              fallback resolved alternative releases. */}
          {hasReleases ? (
            <BlissTooltip content="Releases" placement="top">
              <button
                type="button"
                className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
                onClick={() => openSettings('releases')}
                aria-label="Releases"
              >
                <StremioIcon name="cloud" className="h-5 w-5" />
              </button>
            </BlissTooltip>
          ) : null}
          <BlissTooltip
            content={isFullscreen ? 'Exit full screen mode' : 'Enter full screen mode'}
            placement="top"
          >
            <button
              type="button"
              className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? 'Exit full screen mode' : 'Enter full screen mode'}
            >
              {isFullscreen ? (
                <StremioIcon name="minimize" className="h-5 w-5" />
              ) : (
                <StremioIcon name="maximize" className="h-5 w-5" />
              )}
            </button>
          </BlissTooltip>
        </div>
      </div>
    </div>
  );
}
