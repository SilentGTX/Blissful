// Shared modal -- surfaced when the user tries to play an episode that
// hasn't aired yet. Used by the in-player Episodes drawer
// (BlissfulPlayer) and (in the future) the detail page's episode
// panel, so the "episode isn't out yet" message is consistent across
// the app.
//
// Mirrors the visual language of ResumeOrStartOverModal (poster blur
// behind a solid card on desktop, slide-up sheet on mobile) so the
// player surface has a cohesive look across all action modals.

import { Modal } from '@heroui/react';
import { motion, type PanInfo } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from '../icons/CloseIcon';
import { useTvOverlay } from '../spatial/useTvOverlay';

export type UnreleasedEpisodeModalProps = {
  isOpen: boolean;
  /** Show title -- e.g., "From". */
  title: string;
  /** Episode label like "S04E11 - Title of Episode" -- optional. */
  episodeLabel?: string | null;
  /** Episode thumbnail (or show backdrop) used as the modal's blurred
   *  hero image. */
  poster?: string | null;
  /** ISO date string when the episode is scheduled to release. When
   *  omitted, the modal still surfaces but the date row is hidden. */
  releaseDate?: string | null;
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

function formatReleaseDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function UnreleasedEpisodeModal({
  isOpen,
  title,
  episodeLabel,
  poster,
  releaseDate,
  onClose,
}: UnreleasedEpisodeModalProps) {
  const isMobile = useIsMobile();
  // TV: drive the modal's button with the D-pad (auto-focus "Got it",
  // Back closes). Inert on desktop.
  const containerRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useTvOverlay({
    open: isOpen,
    containerRef,
    onClose,
    autoFocusSelector: '[data-autofocus]',
  });
  if (!isOpen) return null;

  const releaseLabel = formatReleaseDate(releaseDate);

  const bodyContent = (
    <>
      {poster ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${poster})` }}
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
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--bliss-accent)]/90">
          Not yet released
        </div>
        <div className="mt-1 line-clamp-2 text-2xl font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          {title}
        </div>
        {episodeLabel ? (
          <div className="mt-1 text-sm font-medium text-white/75">{episodeLabel}</div>
        ) : null}
        {releaseLabel ? (
          <div className="mt-2 text-[12px] text-white/65">
            Airs {releaseLabel}
          </div>
        ) : (
          <div className="mt-2 text-[12px] text-white/55">
            This episode hasn't aired yet.
          </div>
        )}

        <div className="mt-5">
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            className="w-full cursor-pointer rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white/85 ring-1 ring-white/10 transition hover:bg-white/15"
          >
            Got it
          </button>
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
          className="solid-surface bliss-glass pointer-events-auto relative w-full max-w-[520px] overflow-hidden rounded-t-[28px] text-white shadow-2xl"
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
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        variant="blur"
        className="bg-black/55"
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only">
              <Modal.Heading>Episode not released yet</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-0">
              <div
                ref={containerRef}
                onKeyDown={onKeyDown}
                className="solid-surface bliss-glass relative mx-auto max-h-[90vh] w-full max-w-[420px] overflow-hidden rounded-[20px]"
              >
                {bodyContent}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
