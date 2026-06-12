import { BlissModal } from '../../../components/base';
import { HomeSettingsModal } from './HomeSettingsModal';

type HomeSettingsDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settingsKey: string;
};

export function HomeSettingsDialog({ isOpen, onOpenChange, settingsKey }: HomeSettingsDialogProps) {
  return (
    <BlissModal>
      <BlissModal.Backdrop
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        className="bg-black/40"
      >
        <BlissModal.Container>
          <BlissModal.Dialog>
            <BlissModal.Header className="sr-only"><BlissModal.Heading>Customize Home</BlissModal.Heading></BlissModal.Header>
            <BlissModal.Body className="px-0">
              <HomeSettingsModal key={settingsKey} onClose={() => onOpenChange(false)} />
            </BlissModal.Body>
          </BlissModal.Dialog>
        </BlissModal.Container>
      </BlissModal.Backdrop>
    </BlissModal>
  );
}
