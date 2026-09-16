// "Filler episode" pill, shown while a filler/recap episode plays.
// Bottom-LEFT of the video area, mirroring the Skip-Intro button's slot on the
// right, so the two never collide; above the controls bar and layered over it
// (z-30) like the skip button, so it stays clickable when the chrome fades.
// Dismissable per episode; the parent owns that state.

import React, { useEffect, useState } from 'react';
import { describeRun, type FillerRun } from '../../lib/fillerList';

export type FillerBannerProps = {
  run: FillerRun;
  onSkip: () => void;
  onDismiss: () => void;
};

export const FillerBanner = React.memo(function FillerBanner({ run, onSkip, onDismiss }: FillerBannerProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 16);
    return () => window.clearTimeout(t);
  }, []);
  const canSkip = run.resumeVideoId != null;
  return (
    <div className="pointer-events-none absolute left-6 bottom-28 z-30 max-w-[min(420px,80vw)]">
      <div
        className={
          'pointer-events-auto flex items-center gap-3 rounded-full border border-amber-300/25 ' +
          'bg-black/75 pl-4 pr-2 py-2 text-sm text-white shadow-2xl backdrop-blur ' +
          'transition-all duration-300 ' +
          (mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3')
        }
        role="status"
      >
        <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
          {run.hasRecap && run.count === 1 ? 'Recap' : 'Filler'}
        </span>
        <span className="truncate text-white/85">
          {describeRun(run)}
          {run.count > 1 ? ` · ${run.count} episodes` : ''}
        </span>
        {canSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 active:scale-[0.98]"
          >
            Skip to Ep {run.resumeEp} <span aria-hidden="true">&rarr;</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
});
