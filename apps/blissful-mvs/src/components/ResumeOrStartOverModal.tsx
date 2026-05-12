// Shared modal — picks between "Resume from X" and "Start over" before
// navigating to the player. Used by both the sidebar's Continue Watching
// items and the stream picker's Continue Watching row, so the resume
// behavior is consistent across the app.

import { Modal } from '@heroui/react';
import { formatTimecode } from '../lib/progress';
import { CloseIcon } from '../icons/CloseIcon';

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
  onClose: () => void;
};

export function ResumeOrStartOverModal({
  isOpen,
  title,
  episodeLabel,
  subtitle,
  poster,
  resumeSeconds,
  onResume,
  onStartOver,
  onClose,
}: ResumeOrStartOverModalProps) {
  if (!isOpen) return null;
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
              <div className="solid-surface relative mx-auto max-h-[90vh] w-full max-w-[420px] overflow-hidden rounded-[20px] bg-[#101116]">
                {/* Backdrop poster fills the whole card, dimmed via a
                    gradient so the buttons at the bottom stay legible. */}
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

                {/* Top spacer reserves room for the backdrop to breathe.
                    Below it: solid-ish content block with title + actions. */}
                <div className="relative h-32" />

                <div className="relative px-5 pb-5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300/90">
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
                      onClick={() => {
                        onResume();
                        onClose();
                      }}
                      className="cursor-pointer rounded-xl bg-emerald-400/25 px-4 py-3 text-sm font-semibold text-emerald-100 ring-1 ring-emerald-400/40 transition hover:bg-emerald-400/40"
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
                  </div>
                </div>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
