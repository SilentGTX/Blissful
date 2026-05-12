// Surfaced when the stored Continue Watching stream URL turns out to be
// a debrid DMCA placeholder. Sits over whatever screen the user was on
// (sidebar, home, anywhere) — no navigation until they hit "Pick a
// different stream", which takes them to the detail page's stream
// picker for this specific item.

import { Modal } from '@heroui/react';
import { CloseIcon } from '../icons/CloseIcon';

export type StreamUnavailableModalProps = {
  isOpen: boolean;
  title: string;
  episodeLabel?: string | null;
  poster?: string | null;
  onPickAnother: () => void;
  onClose: () => void;
};

export function StreamUnavailableModal({
  isOpen,
  title,
  episodeLabel,
  poster,
  onPickAnother,
  onClose,
}: StreamUnavailableModalProps) {
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
              <Modal.Heading>Stream unavailable</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-0">
              <div className="solid-surface relative mx-auto max-h-[90vh] w-full max-w-[420px] overflow-hidden rounded-[20px] bg-[#101116]">
                {poster ? (
                  <>
                    <div
                      className="pointer-events-none absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url(${poster})` }}
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-black/80 to-[#101116]" />
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
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300/90">
                    Stream unavailable
                  </div>
                  <div className="mt-1 line-clamp-2 text-2xl font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                    {title}
                  </div>
                  {episodeLabel ? (
                    <div className="mt-1 text-sm font-medium text-white/75">{episodeLabel}</div>
                  ) : null}
                  <div className="mt-3 text-sm leading-snug text-white/65">
                    This file was removed from the debrid service. Most other
                    variants from the same release usually still work.
                  </div>

                  <div className="mt-5 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onPickAnother();
                        onClose();
                      }}
                      className="cursor-pointer rounded-xl bg-emerald-400/25 px-4 py-3 text-sm font-semibold text-emerald-100 ring-1 ring-emerald-400/40 transition hover:bg-emerald-400/40"
                    >
                      Pick a different stream
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
