// The bottom controls strip for NativeMpvPlayer — extracted to a
// memoised subcomponent so a parent re-render (caused by anything OTHER
// than the controls' own state changing — track-list refresh, addon
// subtitle fetch, etc.) doesn't re-render the play/pause button or
// volume slider. The scrub bar inside is its own deeper memo and reads
// the live playback clock via `useSyncExternalStore`, so the slider
// stays smooth at mpv's full tick rate even while the strip itself
// re-renders only on volume / pause / track-menu open changes.

import React from 'react';
import { ScrubBar } from './ScrubBar';
import { PlayerControlIcon as StremioIcon } from '../PlayerControlIcons';

export type PlayerControlsBarProps = {
  // Scrub bar pass-throughs.
  scrubValue: number | null;
  duration: number;
  onScrubInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  commitScrub: () => void;
  onScrubKey: (e: React.KeyboardEvent) => void;

  // Play / pause.
  paused: boolean;
  togglePlay: () => void;

  // Volume.
  muted: boolean;
  toggleMute: () => void;
  volume01: number;
  volumeIcon: string;
  onVolumeChange: (next: number) => void;

  // Audio / subtitle pickers.
  audioDisabled: boolean;
  audioDisabledTitle: string;
  audioMenuOpen: boolean;
  setAudioMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  subMenuOpen: boolean;
  setSubMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  refreshTracks: () => Promise<void> | void;

  // Fullscreen.
  isFullscreen: boolean;
  onToggleFullscreen: () => void;

  // CSS class applied for the show/hide animation, computed by the
  // parent from the `controlsVisible` state.
  controlsOpacity: string;
};

export const PlayerControlsBar = React.memo(function PlayerControlsBar({
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
  audioDisabled,
  audioDisabledTitle,
  audioMenuOpen,
  setAudioMenuOpen,
  subMenuOpen,
  setSubMenuOpen,
  refreshTracks,
  isFullscreen,
  onToggleFullscreen,
  controlsOpacity,
}: PlayerControlsBarProps) {
  const volumePct = Math.max(0, Math.min(100, (volume01 / 2) * 100));
  const volumeFillStyle = {
    background: `linear-gradient(to right, var(--bliss-teal) 0%, var(--bliss-teal) ${volumePct}%, rgba(255,255,255,0.18) ${volumePct}%, rgba(255,255,255,0.18) 100%)`,
  };

  return (
    <div
      className={
        'pointer-events-none absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ' +
        controlsOpacity
      }
    >
      <ScrubBar
        scrubValue={scrubValue}
        duration={duration}
        onScrubInput={onScrubInput}
        commitScrub={commitScrub}
        onScrubKey={onScrubKey}
      />

      {/* Solid controls strip */}
      <div className="pointer-events-auto flex items-center justify-between gap-3 bg-black/85 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
            aria-label={paused ? 'Play' : 'Pause'}
          >
            {paused ? (
              <StremioIcon name="play" className="h-6 w-6" />
            ) : (
              <StremioIcon name="pause" className="h-6 w-6" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleMute}
            className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            <StremioIcon name={volumeIcon} className="h-5 w-5" />
          </button>
          <input
            type="range"
            className="bliss-player-range h-1 w-28 cursor-pointer appearance-none rounded-full"
            min={0}
            max={2}
            step={0.01}
            value={volume01}
            onChange={(e) => {
              const next = Number.parseFloat(e.target.value);
              if (Number.isFinite(next)) onVolumeChange(next);
            }}
            style={volumeFillStyle}
            aria-label="Volume"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={audioDisabled}
            onClick={() => {
              setSubMenuOpen(false);
              setAudioMenuOpen((v) => !v);
              if (!audioMenuOpen) void refreshTracks();
            }}
            className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Audio tracks"
            title={audioDisabledTitle}
          >
            <StremioIcon name="audio-tracks" className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setAudioMenuOpen(false);
              setSubMenuOpen((v) => !v);
              if (!subMenuOpen) void refreshTracks();
            }}
            className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
            aria-label="Subtitle tracks"
            title="Subtitles"
          >
            <StremioIcon name="subtitles" className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="bliss-player-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
            aria-label="Toggle fullscreen"
          >
            <StremioIcon name={isFullscreen ? 'minimize' : 'maximize'} className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
});
