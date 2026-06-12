import { BlissButton, BlissModal } from '../../../components/base';

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
}: DetailModalsProps) {
  return (
    <>
      <BlissModal>
        <BlissModal.Backdrop
          isOpen={isTrailerOpen}
          onOpenChange={onTrailerOpenChange}
          className="bg-black/60"
        >
          <BlissModal.Container size="cover">
            <BlissModal.Dialog>
              <BlissModal.Header className="sr-only"><BlissModal.Heading>Trailer</BlissModal.Heading></BlissModal.Header>
              <BlissModal.Body className="px-0">
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
              </BlissModal.Body>
            </BlissModal.Dialog>
          </BlissModal.Container>
        </BlissModal.Backdrop>
      </BlissModal>

      <BlissModal>
        <BlissModal.Backdrop
          isOpen={isShareOpen}
          onOpenChange={onShareOpenChange}
          className="bg-black/60"
        >
          <BlissModal.Container>
            <BlissModal.Dialog>
              <BlissModal.Header className="sr-only"><BlissModal.Heading>Share</BlissModal.Heading></BlissModal.Header>
              <BlissModal.Body className="px-0">
                <div className="solid-surface mx-auto w-[min(520px,92vw)] rounded-[28px] bg-white/10 p-6">
                  <div className="text-lg font-semibold text-white">Share</div>
                  <div className="mt-2 text-sm text-white/70">Copy a link to this title.</div>

                  <div className="mt-4 flex gap-2">
                    <BlissButton
                      tone="solid"
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
                    </BlissButton>
                    <BlissButton
                      variant="ghost"
                      className="rounded-full bg-white/10 text-white"
                      onPress={() => onShareOpenChange(false)}
                    >
                      Close
                    </BlissButton>
                  </div>
                </div>
              </BlissModal.Body>
            </BlissModal.Dialog>
          </BlissModal.Container>
        </BlissModal.Backdrop>
      </BlissModal>

      <BlissModal>
          <BlissModal.Backdrop
            isOpen={Boolean(externalOpenPrompt)}
            onOpenChange={(open) => {
              if (!open) onCloseExternalPrompt();
            }}
            className="bg-black/60"
          >
            <BlissModal.Container size="lg">
              <BlissModal.Dialog className="bg-[#0b0f14]/95 border border-white/10 shadow-2xl">
                <BlissModal.Header>
                  <BlissModal.Heading className="text-sm font-semibold text-white/90">
                    Open Externally?
                  </BlissModal.Heading>
                </BlissModal.Header>
                <BlissModal.Body className="pt-0">
                  {externalOpenPrompt ? (
                    <div className="space-y-3">
                      <div className="text-sm text-white/80 line-clamp-2" title={externalOpenPrompt.title}>
                        {externalOpenPrompt.title}
                      </div>
                      <div className="text-xs text-white/60">{externalOpenPrompt.reason}</div>
                      <div className="flex flex-wrap gap-2">
                        <BlissButton
                          size="sm"
                          className="rounded-full bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]"
                          onPress={() => onOpenExternalPlayer(externalOpenPrompt.url, externalOpenPrompt.title || 'stream')}
                        >
                          External Player
                        </BlissButton>
                        <BlissButton
                          size="sm"
                          variant="ghost"
                          className="rounded-full bg-white/10 text-white"
                          onPress={() => onTryWebPlayer(externalOpenPrompt.internalPlayerLink)}
                        >
                          Try Web Player
                        </BlissButton>
                      </div>
                    </div>
                  ) : null}
                </BlissModal.Body>
              </BlissModal.Dialog>
            </BlissModal.Container>
          </BlissModal.Backdrop>
        </BlissModal>

    </>
  );
}
