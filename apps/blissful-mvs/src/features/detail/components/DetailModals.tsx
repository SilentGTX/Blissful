import { Button, Modal } from '@heroui/react';
import WhatToDoDrawer from '../../../components/WhatToDoDrawer';
import type { WhatToDoPrompt } from '../../../components/WhatToDoDrawer';
import { isElectronDesktopApp } from '../../../lib/platform';

type ExternalOpenPrompt = {
  title: string;
  url: string;
  reason: string;
  internalPlayerLink: string | null;
} | null;

type DetailModalsProps = {
  isTrailerOpen: boolean;
  onTrailerOpenChange: (open: boolean) => void;
  firstTrailerId: string | null;
  isShareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
  externalOpenPrompt: ExternalOpenPrompt;
  onCloseExternalPrompt: () => void;
  onOpenExternalPlayer: (url: string, title: string) => void;
  onTryWebPlayer: (playerLink: string | null) => void;
  iosPlayPrompt: WhatToDoPrompt;
  onCloseIosPrompt: () => void;
  onPlayIosVlc: (url: string, itemInfo?: { id: string; name: string; type: string; videoId?: string | null }) => void;
  onPlayIosWeb: (playerLink: string) => void;
};

export function DetailModals({
  isTrailerOpen,
  onTrailerOpenChange,
  firstTrailerId,
  isShareOpen,
  onShareOpenChange,
  externalOpenPrompt,
  onCloseExternalPrompt,
  onOpenExternalPlayer,
  onTryWebPlayer,
  iosPlayPrompt,
  onCloseIosPrompt,
  onPlayIosVlc,
  onPlayIosWeb,
}: DetailModalsProps) {
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
                <div className="overflow-hidden rounded-[28px] bg-black">
                  {firstTrailerId ? (
                    <iframe
                      title="Trailer"
                      className="h-[70vh] w-[min(1000px,92vw)]"
                      src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(firstTrailerId)}?autoplay=1`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
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
                <div className="solid-surface mx-auto w-[min(520px,92vw)] rounded-[28px] bg-white/10 p-6">
                  <div className="text-lg font-semibold text-white">Share</div>
                  <div className="mt-2 text-sm text-white/70">Copy a link to this title.</div>

                  <div className="mt-4 flex gap-2">
                    <Button
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

      {!isElectronDesktopApp() ? (
        <Modal>
          <Modal.Backdrop
            isOpen={Boolean(externalOpenPrompt)}
            onOpenChange={(open) => {
              if (!open) onCloseExternalPrompt();
            }}
            variant="blur"
            className="bg-black/60"
          >
            <Modal.Container placement="center" size="lg">
              <Modal.Dialog className="bg-[#0b0f14]/95 border border-white/10 shadow-2xl">
                <Modal.Header>
                  <Modal.Heading className="text-sm font-semibold text-white/90">
                    Open Externally?
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="pt-0">
                  {externalOpenPrompt ? (
                    <div className="space-y-3">
                      <div className="text-sm text-white/80 line-clamp-2" title={externalOpenPrompt.title}>
                        {externalOpenPrompt.title}
                      </div>
                      <div className="text-xs text-white/60">{externalOpenPrompt.reason}</div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="rounded-full bg-emerald-400/15 text-emerald-100"
                          onPress={() => onOpenExternalPlayer(externalOpenPrompt.url, externalOpenPrompt.title || 'stream')}
                        >
                          External Player
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full bg-white/10 text-white"
                          onPress={() => onTryWebPlayer(externalOpenPrompt.internalPlayerLink)}
                        >
                          Try Web Player
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      ) : null}

      <WhatToDoDrawer
        isOpen={Boolean(iosPlayPrompt)}
        prompt={iosPlayPrompt}
        onClose={onCloseIosPrompt}
        onPlayVlc={onPlayIosVlc}
        onPlayWeb={onPlayIosWeb}
      />
    </>
  );
}
