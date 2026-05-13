// Audio-track picker. Lists every audio track libmpv reported for the
// current file, highlights the one mpv has currently set as `aid`, and
// lets the user click another to switch. Extracted to a memoised
// child so parent re-renders (catalog refreshes, subtitle styling
// effects, etc.) don't repaint the popover.

import React from 'react';
import type { MpvTrack } from '../../lib/desktop';

export type AudioMenuPopoverProps = {
  tracks: MpvTrack[];
  audioId: number | string | null;
  selectAudio: (id: number | 'no') => void;
  onClose: () => void;
};

export const AudioMenuPopover = React.memo(function AudioMenuPopover({
  tracks,
  audioId,
  selectAudio,
  onClose,
}: AudioMenuPopoverProps) {
  const audioTracks = tracks.filter((t) => t.kind === 'audio');
  return (
    <div className="absolute inset-0 z-30" onClick={onClose}>
      <div
        className="absolute right-[7.5rem] bottom-32 w-[min(280px,92vw)] rounded-2xl border border-white/10 bg-black/85 p-2 text-sm text-white backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-white/70">
          Audio
        </div>
        <div className="max-h-[40vh] overflow-y-auto">
          {audioTracks.length === 0 ? (
            <div className="px-2 py-2 text-xs text-white/55">No audio tracks</div>
          ) : (
            audioTracks.map((t) => {
              const active = t.selected || audioId === t.id;
              const label = t.title ?? t.lang ?? t.codec ?? `Track ${t.id}`;
              const meta = [t.lang, t.codec].filter(Boolean).join(' · ');
              return (
                <button
                  key={`a-${t.id}`}
                  onClick={() => selectAudio(t.id)}
                  className={
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ' +
                    (active
                      ? 'bg-[#19f7d2]/20 font-semibold text-[#19f7d2]'
                      : 'text-white hover:bg-white/10')
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {meta ? (
                    <span className="flex-shrink-0 text-[10px] uppercase text-white/45">
                      {meta}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});
