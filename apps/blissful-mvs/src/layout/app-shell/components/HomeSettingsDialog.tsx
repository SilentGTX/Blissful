import { Modal } from '@heroui/react';
import { HomeSettingsModal } from './HomeSettingsModal';

type HomeSettingsDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settingsKey: string;
};

export function HomeSettingsDialog({ isOpen, onOpenChange, settingsKey }: HomeSettingsDialogProps) {
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
            <Modal.Header className="sr-only"><Modal.Heading>Customize Home</Modal.Heading></Modal.Header>
            <Modal.Body className="px-0">
              <HomeSettingsModal key={settingsKey} onClose={() => onOpenChange(false)} />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
