// Floating "this episode is filler" card, shared by both players (web
// BlissfulPlayer and the desktop NativeMpvPlayer). Bottom-left,
// above the controls bar — the mirror image of SkipChapterButton (bottom-
// right), so the two never collide when an intro skip and a filler notice
// are on screen together.
//
// The parent decides visibility (first seconds of the episode, then again
// whenever the controls are up, until dismissed). Skip is offered only when
// there is a canon episode to land on and the viewer is allowed to change
// episodes (watch-party guests are not).

import React, { useEffect, useState } from 'react';
import { describeFillerRun, type FillerKind, type FillerRun } from '../lib/animeFiller';
import { FillerBadge } from './FillerBadge';

export type FillerNoticeProps = {
  kind: FillerKind;
  run: FillerRun;
  /** "Skip to episode 109" — null hides the button. */
  skipLabel: string | null;
  onSkip: () => void;
  onDismiss: () => void;
};

export const FillerNotice = React.memo(function FillerNotice({
  kind,
  run,
  skipLabel,
  onSkip,
  onDismiss,
}: FillerNoticeProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 16);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="pointer-events-none absolute left-4 bottom-24 z-30 w-[min(360px,88vw)] sm:left-6 sm:bottom-28">
      <div
        className={
          'pointer-events-auto overflow-hidden rounded-2xl border border-white/10 bg-black/75 text-white shadow-2xl backdrop-blur transition-all duration-300 '
          + (mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3')
        }
        role="status"
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FillerBadge kind={kind} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-orange-300/90">
                {run.count > 1 ? `${run.count} episodes ahead` : 'This episode'}
              </span>
            </div>
            <div className="mt-1 text-[13px] leading-snug text-white/85">
              {describeFillerRun(run, kind, 'this')}
            </div>
            {skipLabel ? (
              <button
                type="button"
                onClick={onSkip}
                className="mt-2.5 inline-flex cursor-pointer items-center gap-2 rounded-full bg-orange-400 px-4 py-2 text-xs font-semibold text-black transition hover:bg-orange-300 active:scale-[0.98]"
              >
                <span>{skipLabel}</span>
                <span aria-hidden="true">&rarr;</span>
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});
