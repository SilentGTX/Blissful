// Centered buffering panel — shows the show's logo animated by the
// `bliss-buffer-fade` keyframe. Visible whenever the video element
// reports `isBuffering`, OR when the first frame hasn't painted yet
// (closes the gap where canplay/playing clear isBuffering before the
// first frame, which otherwise reads as a black flash between the
// buffer screen and the playing video).
//
// Logo only — no poster fallback, no text fallback. Titles without
// a meta logo just paint the black backdrop while buffering.
//
// This is the *internal* BlissfulPlayer buffer screen. The full-bleed
// "into the player" buffering veil lives in AppShell as a separate
// PlayerBufferingScreen component — see CLAUDE.md "Player Page
// Buffering" for the handoff.

import { proxiedImage } from '../../lib/imageProxy';

export type BufferingOverlayProps = {
  visible: boolean;
  logo?: string | null;
};

export function BufferingOverlay({ visible, logo }: BufferingOverlayProps) {
  if (!visible) return null;
  if (!logo) return null;
  return (
    <div data-testid="player-buffering" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="bliss-buffering-panel">
        <img className="bliss-buffering-loader" src={proxiedImage(logo)} alt=" " />
      </div>
    </div>
  );
}
