import { Button, Modal } from '@heroui/react';
import { useRef } from 'react';
import { useTvOverlay } from '../../../spatial/useTvOverlay';

type DetailModalsProps = {
  isTrailerOpen: boolean;
  onTrailerOpenChange: (open: boolean) => void;
  firstTrailerId: string | null;
  isShareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
};

export function DetailModals({
  isTrailerOpen,
  onTrailerOpenChange,
  firstTrailerId,
  isShareOpen,
  onShareOpenChange,
}: DetailModalsProps) {
  // TV: give each overlay D-pad control. The trailer is a YouTube iframe with
  // no buttons, so we focus its wrapper and rely on Back/Esc to close. The
  // share modal's copy/close buttons are driven 1-D. Inert on desktop.
  const trailerRef = useRef<HTMLDivElement>(null);
  const { onKeyDown: onTrailerKeyDown } = useTvOverlay({
    open: isTrailerOpen,
    containerRef: trailerRef,
    onClose: () => onTrailerOpenChange(false),
    autoFocusSelector: '[data-autofocus]',
  });
  const shareRef = useRef<HTMLDivElement>(null);
  const { onKeyDown: onShareKeyDown } = useTvOverlay({
    open: isShareOpen,
    containerRef: shareRef,
    onClose: () => onShareOpenChange(false),
    autoFocusSelector: '[data-autofocus]',
  });
  return (
    <>
      <Modal>
        <Modal.Backdrop
          isOpen={isTrailerOpen}
          onOpenChange={onTrailerOpenChange}
          variant="blur"
          className="bg-black/60"
        >
          <Modal.Container placement="center" size="cover">
            <Modal.Dialog className="bg-transparent shadow-none">
              <Modal.Header className="sr-only"><Modal.Heading>Trailer</Modal.Heading></Modal.Header>
              <Modal.Body className="px-0">
                <div
                  ref={trailerRef}
                  onKeyDown={onTrailerKeyDown}
                  data-autofocus
                  tabIndex={-1}
                  className="overflow-hidden rounded-[28px] bg-black"
                >
                  {firstTrailerId ? (
                    <iframe
                      title="Trailer"
                      className="h-[70vh] w-[min(1000px,92vw)]"
                      // playsinline=1 is required on the Android TV WebView:
                      // without it the YouTube embed plays in a fullscreen/
                      // overlay surface the (Wry) WebChromeClient doesn't
                      // composite, so you get audio with no visible video.
                      // fs=0 hides the fullscreen button (same trap on OK).
                      src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(firstTrailerId)}?autoplay=1&playsinline=1&fs=0&rel=0`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
                    />
                  ) : (
                    <div className="p-6 text-sm text-white/70">No trailer.</div>
                  )}
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal>
        <Modal.Backdrop
          isOpen={isShareOpen}
          onOpenChange={onShareOpenChange}
          variant="blur"
          className="bg-black/60"
        >
          <Modal.Container placement="center">
            <Modal.Dialog className="bg-transparent shadow-none">
              <Modal.Header className="sr-only"><Modal.Heading>Share</Modal.Heading></Modal.Header>
              <Modal.Body className="px-0">
                <div
                  ref={shareRef}
                  onKeyDown={onShareKeyDown}
                  className="solid-surface bliss-glass mx-auto w-[min(520px,92vw)] rounded-[28px] p-6"
                >
                  <div className="text-lg font-semibold text-white">Share</div>
                  <div className="mt-2 text-sm text-white/70">Copy a link to this title.</div>

                  <div className="mt-4 flex gap-2">
                    <Button
                      data-autofocus
                      className="rounded-full bg-white text-black"
                      onPress={async () => {
                        const href = window.location.href;
                        try {
                          await navigator.clipboard.writeText(href);
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      Copy page link
                    </Button>
                    <Button
                      variant="ghost"
                      className="rounded-full bg-white/10 text-white"
                      onPress={() => onShareOpenChange(false)}
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
