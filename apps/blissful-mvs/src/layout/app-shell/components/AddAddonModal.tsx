import { BlissButton, BlissInput, BlissModal } from '../../../components/base';

type AddAddonModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  addonUrlDraft: string;
  onAddonUrlDraftChange: (value: string) => void;
  addonsError: string | null;
  addonsLoading: boolean;
  onInstall: () => Promise<void>;
};

export function AddAddonModal({
  isOpen,
  onOpenChange,
  addonUrlDraft,
  onAddonUrlDraftChange,
  addonsError: _addonsError,
  addonsLoading,
  onInstall,
}: AddAddonModalProps) {
  return (
    <BlissModal>
      <BlissModal.Backdrop
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        className="bg-black/40"
      >
        <BlissModal.Container>
          <BlissModal.Dialog>
            <BlissModal.Header className="sr-only"><BlissModal.Heading>Add addon</BlissModal.Heading></BlissModal.Header>
            <BlissModal.Body className="px-0">
              <div className="solid-surface mx-auto w-full max-w-md rounded-[24px] bg-white/20 p-6">
                <div className="text-lg font-semibold">Add addon</div>
                <div className="mt-1 text-sm text-foreground/60">
                  Paste a manifest URL to install.
                </div>
                <div className="mt-4">
                  <BlissInput
                    value={addonUrlDraft}
                    onChange={(e) => onAddonUrlDraftChange(e.target.value)}
                    placeholder="https://.../manifest.json"
                  />
                </div>
                <div className="mt-5 flex gap-2">
                  <BlissButton
                    tone="solid"
                    isPending={addonsLoading}
                    onPress={onInstall}
                  >
                    Install
                  </BlissButton>
                  <BlissButton
                    variant="ghost"
                    tone="glass"
                    onPress={() => onOpenChange(false)}
                  >
                    Cancel
                  </BlissButton>
                </div>
              </div>
            </BlissModal.Body>
          </BlissModal.Dialog>
        </BlissModal.Container>
      </BlissModal.Backdrop>
    </BlissModal>
  );
}
