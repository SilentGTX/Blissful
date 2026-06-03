// Shared modal — picks between "Resume from X" and "Start over" before
// navigating to the player. Used by both the sidebar's Continue Watching
// items and the stream picker's Continue Watching row, so the resume
// behavior is consistent across the app.

import { Modal } from '@heroui/react';
import { motion, type PanInfo } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { formatTimecode } from '../lib/progress';
import { CloseIcon } from '../icons/CloseIcon';
import { useTvOverlay } from '../spatial/useTvOverlay';
import { isTvMode } from '../lib/platform';

export type ResumeOrStartOverModalProps = {
  isOpen: boolean;
  title: string;
  /** Episode label like "S04E01" for series; null/undefined for movies. */
  episodeLabel?: string | null;
  /** Stream filename or addon info, shown as a smaller subtitle line. */
  subtitle?: string | null;
  /** Already-normalized poster image URL. */
  poster?: string | null;
  resumeSeconds: number;
  onResume: () => void;
  onStartOver: () => void;
  /** Optional third action: open the show/movie's detail page instead of
   *  playing. When provided, a "Go to show" button is shown. */
  onGoToDetail?: () => void;
  onClose: () => void;
};

function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
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

export function ResumeOrStartOverModal({
  isOpen,
  title,
  episodeLabel,
  subtitle,
  poster,
  resumeSeconds,
  onResume,
  onStartOver,
  onGoToDetail,
  onClose,
}: ResumeOrStartOverModalProps) {
  const isMobile = useIsMobile();
  // TV: drive the modal's buttons with the D-pad (auto-focus Resume, Up/Down
  // between buttons, Back closes). Inert on desktop.
  const containerRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useTvOverlay({
    open: isOpen,
    containerRef,
    onClose,
    autoFocusSelector: '[data-autofocus]',
  });
  if (!isOpen) return null;

  // Shared body content used in both the centered desktop modal
  // and the mobile bottom-drawer variant.
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
          Continue watching
        </div>
        <div className="mt-1 line-clamp-2 text-2xl font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          {title}
        </div>
        {episodeLabel ? (
          <div className="mt-1 text-sm font-medium text-white/75">{episodeLabel}</div>
        ) : null}
        {subtitle ? (
          <div className="mt-2 truncate text-[11px] text-white/45">{subtitle}</div>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            data-autofocus
            onClick={() => {
              onResume();
              onClose();
            }}
            className="cursor-pointer rounded-xl bg-[var(--bliss-accent)]/25 px-4 py-3 text-sm font-semibold text-[var(--bliss-accent)] ring-1 ring-[var(--bliss-accent)]/40 transition hover:bg-[var(--bliss-accent)]/40"
          >
            Resume {formatTimecode(resumeSeconds)}
          </button>
          <button
            type="button"
            onClick={() => {
              onStartOver();
              onClose();
            }}
            className="cursor-pointer rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white/85 ring-1 ring-white/10 transition hover:bg-white/15"
          >
            Start from beginning
          </button>
          {onGoToDetail ? (
            <button
              type="button"
              onClick={() => {
                onGoToDetail();
                onClose();
              }}
              className="cursor-pointer rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white/85 ring-1 ring-white/10 transition hover:bg-white/15"
            >
              Go to show
            </button>
          ) : null}
        </div>
      </div>
    </>
  );

  // Mobile: slide-up bottom drawer with drag-down-to-close, same
  // pattern as the player's Settings / Episodes drawers and the
  // Continue Watching drawer in the sidebar.
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

  // TV: render our OWN full-screen fixed backdrop so the dim covers the WHOLE
  // screen. HeroUI's <Modal.Backdrop> only dimmed part of the 1440px TV viewport
  // (the user saw "half the screen" dimmed). Same D-pad wiring (containerRef +
  // onKeyDown) as the desktop path.
  if (isTvMode()) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          ref={containerRef}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="solid-surface bliss-glass relative w-full max-w-[440px] overflow-hidden rounded-[20px]"
        >
          {bodyContent}
        </div>
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
              <Modal.Heading>Continue watching</Modal.Heading>
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
