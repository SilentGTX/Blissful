import { Button, Input, Modal } from '@heroui/react';

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
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="blur"
        className="bg-black/40"
      >
        <Modal.Container placement="center">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only"><Modal.Heading>Add addon</Modal.Heading></Modal.Header>
            <Modal.Body className="px-0">
              <div className="solid-surface mx-auto w-full max-w-md rounded-[24px] bg-white/20 p-6">
                <div className="text-lg font-semibold">Add addon</div>
                <div className="mt-1 text-sm text-foreground/60">
                  Paste a manifest URL to install.
                </div>
                <div className="mt-4">
                  <Input
                    value={addonUrlDraft}
                    onChange={(e) => onAddonUrlDraftChange(e.target.value)}
                    placeholder="https://.../manifest.json"
                    className="bg-white/10 rounded-xl px-4 py-2"
                  />
                </div>
                <div className="mt-5 flex gap-2">
                  <Button
                    className="rounded-full bg-white text-black"
                    isPending={addonsLoading}
                    onPress={onInstall}
                  >
                    Install
                  </Button>
                  <Button
                    variant="ghost"
                    className="rounded-full bg-white/10"
                    onPress={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
