// Floating "Skip Intro" / "Skip Recap" / "Skip Credits" button.
// Positioned bottom-right of the video area, above the controls bar.
// Memoised so the parent's currentTime ticks don't re-render it.
//
// Visibility is driven by the parent — when `useChapterSkipWeb`
// returns a non-null payload, render this; on null, render nothing.
// It stays visible while active regardless of the controls' auto-hide,
// and is layered ABOVE the controls (z-30), so it remains clickable even
// when the player chrome has faded out during playback.

import React, { useEffect, useState } from 'react';
import type { ChapterSkipKind } from '../useChapterSkipWeb';

export type SkipChapterButtonProps = {
  kind: ChapterSkipKind;
  label: string;
  onSkip: () => void;
};

export const SkipChapterButton = React.memo(function SkipChapterButton({
  label,
  onSkip,
}: SkipChapterButtonProps) {
  // Per-mount fade-in: button slides up + fades over 350 ms on first
  // paint so an intro/recap detection feels like a deliberate UI
  // affordance rather than a pop.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 16);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="pointer-events-none absolute right-6 bottom-28 z-30">
      <button
        type="button"
        onClick={onSkip}
        className={
          'pointer-events-auto inline-flex items-center gap-2 rounded-full ' +
          'border border-white/15 bg-black/70 px-5 py-2.5 text-sm font-semibold ' +
          'text-white shadow-2xl backdrop-blur transition-all duration-300 ' +
          'hover:bg-black/85 hover:scale-[1.02] active:scale-[0.98] ' +
          (mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3')
        }
      >
        <span>{label}</span>
        <span aria-hidden="true">&rarr;</span>
      </button>
    </div>
  );
});
