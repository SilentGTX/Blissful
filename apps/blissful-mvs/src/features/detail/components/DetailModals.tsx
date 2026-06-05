import { Button, Modal } from '@heroui/react';
import { useRef } from 'react';
import { useTvOverlay } from '../../../spatial/useTvOverlay';
import { isTvMode } from '../../../lib/platform';

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
  // playsinline=1 keeps the YouTube embed inline (Android TV WebView otherwise
  // plays it in a fullscreen/overlay surface the Wry WebChromeClient doesn't
  // composite — audio only). fs=0 hides the fullscreen button (same trap).
  const trailerSrc = firstTrailerId
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(firstTrailerId)}?autoplay=1&playsinline=1&fs=0&rel=0`
    : null;
  const trailerInner = (
    <div
      ref={trailerRef}
      onKeyDown={onTrailerKeyDown}
      className="relative overflow-hidden rounded-[28px] bg-black"
    >
      {/* Close button — focusable + autofocused so the D-pad starts HERE, not
          on the iframe. A YouTube iframe swallows key events (they don't bubble
          to the parent), so without a parent-side focusable there'd be no way
          to close it with the remote. OK on this closes; Back also closes via
          the overlay handler as long as focus hasn't entered the iframe. */}
      <button
        type="button"
        aria-label="Close trailer"
        data-autofocus
        onClick={() => onTrailerOpenChange(false)}
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white outline-none ring-2 ring-transparent backdrop-blur transition focus:ring-[var(--bliss-accent)] data-[focused=true]:ring-[var(--bliss-accent)] hover:bg-black/90"
      >
        <span aria-hidden>×</span> Close
      </button>
      {trailerSrc ? (
        <iframe
          title="Trailer"
          // tabIndex -1 so D-pad/Tab focus can't land inside the iframe (where
          // it would eat Back); YouTube still autoplays.
          tabIndex={-1}
          className="h-[70vh] w-[min(1000px,92vw)]"
          src={trailerSrc}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
        />
      ) : (
        <div className="p-6 text-sm text-white/70">No trailer.</div>
      )}
    </div>
  );

  return (
    <>
      {/* TV: own full-screen fixed backdrop (z-[70], above the player veil).
          HeroUI's <Modal.Backdrop> only dims/stacks a box inside the 1440px TV
          layout viewport, which left the iframe rendering BEHIND the detail
          page — "trailer plays in the background, audio only". */}
      {isTvMode() ? (
        isTrailerOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Trailer"
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => onTrailerOpenChange(false)}
          >
            <div onClick={(e) => e.stopPropagation()}>{trailerInner}</div>
          </div>
        ) : null
      ) : (
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
                <Modal.Body className="px-0">{trailerInner}</Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}

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
