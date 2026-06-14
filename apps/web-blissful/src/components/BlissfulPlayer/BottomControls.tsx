// Bottom controls overlay — slides in from below via the
// `bliss-player-bottom-slide-in` keyframe. Two stacked strips:
//   1. Gradient scrub strip with timestamps + the seek slider
//   2. Solid black/85 transport strip with play/pause, mute, volume,
//      next-episode, episodes-drawer, subtitles, quality, servers,
//      and fullscreen
//
// Hover-time tooltip floats above the scrub bar at the cursor x; the
// scrub slider's track fill is driven by `--bliss-track-fill` (set
// inline based on currentTime / duration). The HOM next-episode
// button shows a tooltip with the air date when the episode hasn't
// released yet (otherwise instant-advance).

import { useState, type Ref } from 'react';
import { BlissTooltip } from '../base/BlissTooltip';
import { StremioIcon } from '../PlayerControlIcons';
import type { NextEpisodeInfo } from '../../pages/PlayerPage';
import type { SettingsTab } from './SettingsPanel';
import { volumeFillColor } from '../../lib/colorUtils';
import { MiniControls } from './MiniControls';

export type BottomControlsProps = {
  showControls: boolean;
  instantHideControls: boolean;

  // Scrub bar
  currentTime: number;
  duration: number;
  setCurrentTime: (n: number) => void;
  scrubBarSliderRef: Ref<HTMLInputElement>;
  scrubHoverPx: number | null;
  setScrubHoverPx: (px: number | null) => void;
  scrubHoverTime: number | null;
  setScrubHoverTime: (t: number | null) => void;
  formattedTime: (value: number) => string;

  // Transport
  isPlaying: boolean;
  togglePlay: () => void;
  muted: boolean;
  toggleMute: () => void;
  volume: number;
  videoRef: Ref<HTMLVideoElement>;
  /** Called whenever the user actively seeks via the scrub bar.
   *  The watch-party hook uses this to broadcast the seek to the
   *  room — relying on the DOM `seeked` event was fragile (it
   *  fires for drift correction, applyHostEvent, HLS internals
   *  etc., not just user scrubs). */
  onUserSeek?: (currentTime: number) => void;

  // Right-side buttons
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  // Mini-player. `compact` renders a stripped-down control bar; the callbacks
  // drive minimize (full → mini), expand (mini → full), and close.
  compact?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
  onClosePlayer?: () => void;
  nextEpisodeInfo?: NextEpisodeInfo | null;
  advanceToNextEpisode: () => void;
  /** Watch-party gate — when true (= guest in a room), the
   *  next-episode button is rendered disabled with a tooltip
   *  explaining only the host can change episodes. */
  episodeChangeDisabled?: boolean;
  type: string | null;
  hasVideos: boolean;
  qualityOptions?: { label: string; quality: string }[];
  selectedQuality?: string | null;
  audioTracks?: { i: number; lang: string | null }[];
  selectedAudioTrack?: number;
  hideServerPicker?: boolean;
  /** In RD fallback mode, whether there are alternative torrents to switch
   *  between — surfaces a "Releases" cloud icon in place of the Servers one. */
  hasReleases?: boolean;
  /** Watch-party gate — when true (= guest in a room) the source/servers/releases
   *  control is rendered DISABLED with a tooltip (the guest watches the host's exact
   *  stream and can't switch it), instead of silently rendering nothing. */
  sourceChangeDisabled?: boolean;

  // Settings + Episodes drawer triggers
  openSettings: (tab: SettingsTab) => void;
  toggleEpisodes: () => void;

  // Seek step for the slider's `step` attr
  seekShortTimeDurationMs: number;
};

export function BottomControls(props: BottomControlsProps) {
  const {
    showControls,
    instantHideControls,
    currentTime,
    duration,
    setCurrentTime,
    scrubBarSliderRef,
    scrubHoverPx,
    setScrubHoverPx,
    scrubHoverTime,
    setScrubHoverTime,
    formattedTime,
    isPlaying,
    togglePlay,
    muted,
    toggleMute,
    volume,
    videoRef,
    onUserSeek,
    isFullscreen,
    toggleFullscreen,
    compact,
    onMinimize,
    onExpand,
    onClosePlayer,
    nextEpisodeInfo,
    advanceToNextEpisode,
    episodeChangeDisabled,
    type,
    hasVideos,
    qualityOptions,
    selectedQuality,
    audioTracks,
    selectedAudioTrack,
    hideServerPicker,
    hasReleases,
    sourceChangeDisabled,
    openSettings,
    toggleEpisodes,
    seekShortTimeDurationMs,
  } = props;

  // While the user is actively dragging the scrub thumb, the
  // controlled `value` prop fights `timeupdate` event firings (each
  // one re-renders the slider and snaps its value back to the
  // playhead). Track local drag state + drag value so the slider
  // reads `dragValue` until pointer up.
  const [scrubDragValue, setScrubDragValue] = useState<number | null>(null);
  const isScrubbing = scrubDragValue !== null;
  const displayedScrubValue = isScrubbing
    ? scrubDragValue
    : Math.min(currentTime, duration || 0);

  // Mini-player chrome lives in its own component.
  if (compact) {
    return (
      <MiniControls
        isPlaying={isPlaying}
        togglePlay={togglePlay}
        muted={muted}
        toggleMute={toggleMute}
        volume={volume}
        videoRef={videoRef as { current: HTMLVideoElement | null }}
        currentTime={currentTime}
        duration={duration}
        formattedTime={formattedTime}
        setCurrentTime={setCurrentTime}
        onUserSeek={onUserSeek}
        onExpand={onExpand}
        onClose={onClosePlayer}
      />
    );
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
        <span className="min-w-[56px] text-left">{formattedTime(currentTime)}</span>
        <div className="relative flex-1">
          {scrubHoverTime != null && scrubHoverPx != null ? (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2"
              style={{ left: `${scrubHoverPx}px`, bottom: '24px' }}
            >
              <div className="rounded-md border border-white/15 bg-black/85 px-2 py-1 text-xs font-mono tabular-nums text-white shadow-lg backdrop-blur">
                {formattedTime(scrubHoverTime)}
              </div>
            </div>
          ) : null}
          <input
            ref={scrubBarSliderRef}
            className="bliss-player-range h-1 w-full cursor-pointer appearance-none rounded-full"
            type="range"
            min={0}
            max={Math.max(0.1, duration)}
            step={Math.max(1, Math.round(seekShortTimeDurationMs / 1000))}
            value={displayedScrubValue}
            style={{
              ['--bliss-track-fill' as string]:
                duration > 0
                  ? `${Math.min(100, Math.max(0, (displayedScrubValue / duration) * 100))}%`
                  : '0%',
            } as React.CSSProperties}
            onPointerDown={() => {
              // Freeze the controlled value at the current playhead
              // so the user can drag without `timeupdate` snap-back.
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
              const video = (videoRef as { current: HTMLVideoElement | null }).current;
              if (!video) return;
              video.currentTime = next;
              setCurrentTime(next);
              // Watch-party broadcast — explicit UI signal so the
              // hook doesn't have to guess from DOM `seeked` events
              // whether this came from the user or from a remote
              // apply / drift correction.
              onUserSeek?.(next);
              // Only mirror into the drag-frozen value while a drag is
              // in progress (i.e. setScrubDragValue is non-null);
              // otherwise the next click-to-seek would leave the
              // local drag state stuck at the click position.
              if (isScrubbing) setScrubDragValue(next);
            }}
            onMouseMove={(e) => {
              // Account for the 18-px thumb so the tooltip's
              // timestamp matches the seek target (off by up to
              // halfThumb × max/trackWidth seconds otherwise).
              const HALF_THUMB = 9;
              const el = (scrubBarSliderRef as { current: HTMLInputElement | null }).current;
              if (!el || duration <= 0) return;
              const rect = el.getBoundingClientRect();
              if (rect.width <= 2 * HALF_THUMB) return;
              const rawX = e.clientX - rect.left;
              const trackInnerWidth = rect.width - 2 * HALF_THUMB;
              const clampedX = Math.max(HALF_THUMB, Math.min(rect.width - HALF_THUMB, rawX));
              const pct = (clampedX - HALF_THUMB) / trackInnerWidth;
              setScrubHoverPx(rawX);
              setScrubHoverTime(Math.round(pct * duration));
            }}
            onMouseLeave={() => {
              setScrubHoverPx(null);
              setScrubHoverTime(null);
            }}
          />
        </div>
        <span className="min-w-[56px] text-right">{formattedTime(duration)}</span>
      </div>

      <div className="pointer-events-auto flex items-center justify-between gap-3 bg-black/85 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <StremioIcon name="pause" className="h-6 w-6" /> : <StremioIcon name="play" className="h-6 w-6" />}
          </button>
          {/* Mute + volume slider — desktop only. Mobile relies on
              the device's hardware volume keys. */}
          <button
            type="button"
            className="bliss-player-icon-btn hidden h-10 w-10 items-center justify-center rounded-full md:flex"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            <StremioIcon
              name={
                muted || volume === 0
                  ? 'volume-mute'
                  : !Number.isFinite(volume)
                    ? 'volume-off'
                    : volume < 0.3
                      ? 'volume-low'
                      : volume < 0.7
                        ? 'volume-medium'
                        : 'volume-high'
              }
              className="h-5 w-5"
            />
          </button>
          <input
            className="bliss-player-volume hidden h-1 w-28 cursor-pointer appearance-none rounded-full md:inline-block"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            style={{
              ['--bliss-track-fill' as string]: `${(muted ? 0 : volume) * 100}%`,
              ['--bliss-volume-fill' as string]: volumeFillColor(muted ? 0 : volume),
            } as React.CSSProperties}
            onChange={(event) => {
              const next = Number.parseFloat(event.target.value);
              const video = (videoRef as { current: HTMLVideoElement | null }).current;
              if (!video || !Number.isFinite(next)) return;
              video.volume = next;
              video.muted = next === 0;
            }}
            aria-label="Volume"
          />
        </div>
        <div className="flex items-center gap-1">
          {/* Next-episode (series only) — instant jump to next ep. When
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
            // Party-non-host takes priority over the unreleased
            // gate — both are "you can't click this" states, the
            // tooltip should just explain the right reason.
            const isDisabled = isUnreleased || !!episodeChangeDisabled;
            const tooltipText = episodeChangeDisabled
              ? 'Only the host can change episodes'
              : releaseDateLabel
                ? `Next episode airs ${releaseDateLabel}`
                : 'Next episode hasn’t aired yet';
            const button = (
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
            );
            // Tooltip on both states: the action label when enabled, the
            // reason it's blocked when disabled (unreleased / party guest).
            return (
              <BlissTooltip content={isDisabled ? tooltipText : 'Next episode'} placement="top">
                {button}
              </BlissTooltip>
            );
          })()}
          {/* Episodes drawer (series only). */}
          {type === 'series' && hasVideos ? (
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
          {/* Audio track picker (transcoded RD streams with >1 track) — shows
              the selected track's language code, opens the Audio tab. */}
          {audioTracks && audioTracks.length > 1 ? (
            <BlissTooltip content="Audio" placement="top">
              <button
                type="button"
                className="bliss-player-icon-btn flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-xs font-semibold uppercase tracking-wide"
                onClick={() => openSettings('audio')}
                aria-label="Audio"
              >
                {((audioTracks.find((t) => t.i === (selectedAudioTrack ?? 0)) ?? audioTracks[0])?.lang || 'AUD').slice(0, 3)}
              </button>
            </BlissTooltip>
          ) : null}
          {/* Quality picker — shows the active label (e.g. "1080P",
              "4K") instead of a gear icon so the current quality is
              legible at a glance. Falls back to the first available
              option when no selection has been made yet. */}
          {qualityOptions && qualityOptions.length > 1 ? (
            <button
              type="button"
              className="bliss-player-icon-btn flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-xs font-semibold uppercase tracking-wide"
              onClick={() => openSettings('quality')}
              aria-label="Quality"
              title="Quality"
            >
              {selectedQuality
                ?? qualityOptions.find((q) => q.quality)?.label
                ?? 'Auto'}
            </button>
          ) : null}
          {/* Servers (Videasy) — opens the unified menu on the Servers tab.
              In Real-Debrid fallback mode there are no Videasy servers, so
              the same cloud icon instead opens the "Releases" tab to switch
              the torrent. */}
          {sourceChangeDisabled ? (
            <BlissTooltip content="Only the host can change the stream" placement="top">
              <button
                type="button"
                className="bliss-player-icon-btn flex h-10 w-10 cursor-not-allowed items-center justify-center rounded-full opacity-40"
                aria-label="Change source (host only)"
                aria-disabled
                disabled
              >
                <StremioIcon name="cloud" className="h-5 w-5" />
              </button>
            </BlissTooltip>
          ) : hideServerPicker ? (
            hasReleases ? (
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
            ) : null
          ) : (
            <BlissTooltip content="Servers" placement="top">
              <button
                type="button"
                className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
                onClick={() => openSettings('servers')}
                aria-label="Servers"
              >
                <StremioIcon name="cloud" className="h-5 w-5" />
              </button>
            </BlissTooltip>
          )}
          {/* PiP — shrinks the player into the floating mini-window and drops
              you back into the app; keeps playing. Click the mini window (or
              expand) to come back. */}
          {onMinimize ? (
            <BlissTooltip content="PiP" placement="top">
              <button
                type="button"
                className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
                onClick={onMinimize}
                aria-label="Picture-in-Picture"
              >
                <StremioIcon name="picture-in-picture" className="h-5 w-5" />
              </button>
            </BlissTooltip>
          ) : null}
          <button
            type="button"
            className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
            onClick={toggleFullscreen}
            aria-label="Toggle fullscreen"
          >
            {isFullscreen ? (
              <StremioIcon name="minimize" className="h-5 w-5" />
            ) : (
              <StremioIcon name="maximize" className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
