// Floating "Skip Intro" / "Skip Recap" / "Skip Credits" button.
// Positioned bottom-right of the video area, above the controls bar.
// Memoised so the parent's mpv time-pos ticks don't re-render it.
//
// Visibility is driven by the parent — when the active skip source
// returns a non-null payload, render this; on null, render nothing. The
// button stays visible for the WHOLE skip window regardless of whether
// the player controls are showing (it must always be reachable, like
// Netflix's Skip Intro), so it does NOT fade with the controls bar.

import React, { useEffect, useState } from 'react';
import type { ChapterSkipKind } from './useChapterSkip';

export type SkipChapterButtonProps = {
  kind: ChapterSkipKind;
  label: string;
  onSkip: () => void;
  /** TV: when true the button is "armed" — it shows a focus ring and OK on
   *  the remote fires onSkip (the player wires this). A hint is appended so
   *  the affordance is discoverable on a 10-foot UI. */
  focused?: boolean;
};

export const SkipChapterButton = React.memo(function SkipChapterButton({
  label,
  onSkip,
  focused,
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
    <div className="pointer-events-none absolute right-6 bottom-28 z-20">
      <button
        type="button"
        onClick={onSkip}
        className={
          'pointer-events-auto inline-flex items-center gap-2 rounded-full ' +
          'border bg-black/70 px-5 py-2.5 text-sm font-semibold ' +
          'text-white shadow-2xl backdrop-blur transition-all duration-300 ' +
          'hover:bg-black/85 hover:scale-[1.02] active:scale-[0.98] ' +
          (focused
            ? 'border-[var(--bliss-accent)] ring-2 ring-[var(--bliss-accent)] scale-[1.03] '
            : 'border-white/15 ') +
          (mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3')
        }
      >
        <span>{label}</span>
        {focused ? (
          <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide">OK</span>
        ) : (
          <span aria-hidden="true">&rarr;</span>
        )}
      </button>
    </div>
  );
});
