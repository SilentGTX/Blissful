// "The next N episodes are filler — are you sure?" Shown when Next (the button
// or the Up-Next auto-advance) would step from a canon episode INTO a filler
// run. Skip jumps past the run to the first canon episode; Watch continues
// into it and remembers the choice for the whole run. Escape / Stay does
// nothing — the player stays where it is.

import { useEffect } from 'react';
import { describeRun, type FillerRun } from '../../lib/fillerList';

export type FillerRunPromptProps = {
  run: FillerRun;
  showTitle?: string | null;
  onWatch: () => void;
  onSkip: () => void;
  onStay: () => void;
};

export function FillerRunPrompt({ run, showTitle, onWatch, onSkip, onStay }: FillerRunPromptProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onStay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStay]);

  const canSkip = run.resumeVideoId != null;
  const what = run.hasRecap ? 'filler/recap' : 'filler';
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="mx-4 w-[min(460px,92vw)] rounded-2xl border border-white/10 bg-[#121318] p-6 text-white shadow-2xl">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">Filler ahead</div>
        <h2 className="font-[Fraunces] text-2xl font-semibold leading-tight">
          {run.count === 1 ? `The next episode is ${what}` : `The next ${run.count} episodes are ${what}`}
        </h2>
        <p className="mt-3 text-sm text-white/70">
          {describeRun(run)}
          {showTitle ? ` of ${showTitle}` : ''}
          {canSkip ? `. The story continues at episode ${run.resumeEp}.` : '. There is no later canon episode in this list.'}
          {' '}Are you sure you want to watch?
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onStay}
            className="rounded-full px-4 py-2 text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white"
          >
            Stay here
          </button>
          <button
            type="button"
            onClick={onWatch}
            className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
          >
            Watch anyway
          </button>
          {canSkip ? (
            <button
              type="button"
              autoFocus
              onClick={onSkip}
              className="rounded-full bg-[var(--bliss-accent)] px-4 py-2 text-sm font-semibold text-[var(--bliss-ink,#05070a)] hover:brightness-110"
            >
              Skip to Ep {run.resumeEp}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
