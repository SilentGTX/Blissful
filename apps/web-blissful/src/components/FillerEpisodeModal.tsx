// Shared "this is filler — watch or skip?" prompt. Surfaced by the player
// (next-episode button, Up Next, episodes drawer) and the detail page's
// episode list whenever the viewer is about to start a run of filler / recap
// episodes they have not already waved through.
//
// Same visual language as ResumeOrStartOverModal / UnreleasedEpisodeModal
// (blurred episode still behind a solid card; slide-up sheet on phones).

import { BlissModal } from './base';
import { motion, type PanInfo } from 'framer-motion';
import { useEffect, useState } from 'react';
import { CloseIcon } from '../icons/CloseIcon';
import { proxiedImage } from '../lib/imageProxy';
import { describeFillerRun, type FillerKind, type FillerRun } from '../lib/animeFiller';
import { FillerBadge } from './FillerBadge';

export type FillerSkipTarget = {
  episode: number;
  title: string | null;
};

export type FillerEpisodeModalProps = {
  isOpen: boolean;
  /** Show title. */
  title: string;
  /** "Episode 64 · Title" — the episode about to play. */
  episodeLabel?: string | null;
  /** Episode still (or show backdrop) for the blurred hero. */
  poster?: string | null;
  kind: FillerKind;
  run: FillerRun;
  /** Whether `run` starts at the episode being decided on ("this") or at the
   *  one after it ("next", the Up Next / next-button case). */
  position: 'this' | 'next';
  /** The canon episode Skip lands on. Null hides the Skip button (the run
   *  reaches the end of what is listed, or the addon has no such episode). */
  skipTarget: FillerSkipTarget | null;
  onWatch: () => void;
  onSkip: () => void;
  onClose: () => void;
};

function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

export function FillerEpisodeModal({
  isOpen,
  title,
  episodeLabel,
  poster,
  kind,
  run,
  position,
  skipTarget,
  onWatch,
  onSkip,
  onClose,
}: FillerEpisodeModalProps) {
  const isMobile = useIsMobile();
  if (!isOpen) return null;

  const skipLabel = skipTarget
    ? `Skip to episode ${skipTarget.episode}${skipTarget.title ? ` · ${skipTarget.title}` : ''}`
    : null;

  const bodyContent = (
    <>
      {poster ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${proxiedImage(poster)})` }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/75 to-[#101116]" />
        </>
      ) : null}

      <button
        type="button"
        className="absolute right-3 top-3 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur hover:bg-black/65"
        aria-label="Close"
        onClick={onClose}
      >
        <CloseIcon className="block" size={14} />
      </button>

      <div className="relative h-32" />

      <div className="relative px-5 pb-5">
        <div className="flex items-center gap-2">
          <FillerBadge kind={kind} />
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-orange-300/90">
            {run.count === 1 ? 'Skippable episode' : `${run.count} skippable episodes`}
          </div>
        </div>
        <div className="mt-1 line-clamp-2 text-2xl font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          {title}
        </div>
        {episodeLabel ? (
          <div className="mt-1 text-sm font-medium text-white/75">{episodeLabel}</div>
        ) : null}
        <div className="mt-3 text-[13px] leading-snug text-white/80">
          {describeFillerRun(run, kind, position)}
          {' '}
          {skipTarget
            ? `The story continues at episode ${skipTarget.episode}.`
            : 'No canon episode is listed after it yet.'}
        </div>
        <div className="mt-1 text-[13px] font-medium text-white/90">
          Are you sure you want to watch?
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {skipLabel ? (
            <button
              type="button"
              onClick={() => {
                onSkip();
                onClose();
              }}
              className="cursor-pointer rounded-xl bg-orange-400 px-4 py-3 text-sm font-semibold text-black transition hover:bg-orange-300"
            >
              {skipLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onWatch();
              onClose();
            }}
            className="cursor-pointer rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white/85 ring-1 ring-white/10 transition hover:bg-white/15"
          >
            {run.count === 1 ? 'Watch anyway' : `Watch anyway (${run.count} episodes)`}
          </button>
        </div>
        <div className="mt-3 text-center text-[10px] text-white/35">
          Filler data from MyAnimeList
        </div>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 backdrop-blur"
        onClick={onClose}
      >
        <motion.div
          drag="y"
          dragDirectionLock
          dragConstraints={{ top: 0, bottom: 260 }}
          dragElastic={0}
          dragMomentum={false}
          onDragEnd={(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
            if (info.offset.y > 95 || info.velocity.y > 700) onClose();
          }}
          initial={{ y: 180, opacity: 0.94 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24, mass: 0.85 }}
          className="solid-surface pointer-events-auto relative w-full max-w-[520px] overflow-hidden rounded-t-[28px] bg-[#101116] text-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          style={{ touchAction: 'none' }}
        >
          <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-white/15" />
          {bodyContent}
        </motion.div>
      </div>
    );
  }

  return (
    <BlissModal>
      <BlissModal.Backdrop
        isOpen={isOpen}
        className="bg-black/55"
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <BlissModal.Container size="sm">
          <BlissModal.Dialog>
            <BlissModal.Header className="sr-only">
              <BlissModal.Heading>Filler episode</BlissModal.Heading>
            </BlissModal.Header>
            <BlissModal.Body className="px-0">
              <div className="solid-surface relative mx-auto max-h-[90vh] w-full max-w-[420px] overflow-hidden rounded-[20px] bg-[#101116]">
                {bodyContent}
              </div>
            </BlissModal.Body>
          </BlissModal.Dialog>
        </BlissModal.Container>
      </BlissModal.Backdrop>
    </BlissModal>
  );
}
