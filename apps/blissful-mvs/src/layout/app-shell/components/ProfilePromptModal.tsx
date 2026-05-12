import { Button, Input, Modal } from '@heroui/react';
import { useState } from 'react';
import { PRESET_PROFILE_AVATARS, renderProfileAvatar } from '../../../lib/profileAvatars';

type ProfilePromptModalProps = {
  isOpen: boolean;
  initialName: string;
  onSave: (profile: { displayName: string; avatar?: string }) => Promise<void>;
};

export function ProfilePromptModal({ isOpen, initialName, onSave }: ProfilePromptModalProps) {
  const [displayName, setDisplayName] = useState(initialName);
  const [avatar, setAvatar] = useState<string | undefined>(PRESET_PROFILE_AVATARS[0]);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} variant="blur" className="bg-black/55" onOpenChange={() => {}}>
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only">
              <Modal.Heading>Profile setup</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-0">
              <div className="solid-surface mx-auto w-full max-w-xl rounded-[28px] bg-white/10 p-6">
                <div className="font-[Fraunces] text-3xl font-semibold">Who's watching?</div>
                <div className="mt-1 text-sm text-foreground/70">Set your display name and avatar.</div>

                <div className="mt-4">
                  <label className="text-sm text-foreground/70">Username</label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-white/10 px-4 py-2 focus-within:!border-[var(--bliss-teal)] focus-within:!ring-1 focus-within:!ring-[var(--bliss-teal)]"
                    placeholder="Your profile name"
                  />
                </div>

                <div className="mt-4 grid grid-cols-4 gap-2">
                  {PRESET_PROFILE_AVATARS.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      className={
                        'relative grid h-14 w-14 place-items-center overflow-hidden rounded-lg text-2xl transition ' +
                        (avatar === entry
                          ? 'scale-105 ring-2 ring-[#19f7d2] ring-offset-1 ring-offset-black/40'
                          : 'opacity-90 hover:opacity-100')
                      }
                      onClick={() => setAvatar(entry)}
                    >
                      {renderProfileAvatar(entry, '?').kind === 'image' ? (
                        <img src={entry} alt="Preset avatar" className="h-full w-full object-contain" />
                      ) : (
                        entry
                      )}
                      {avatar === entry ? (
                        <span className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#19f7d2] text-[9px] font-bold text-black">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                <div className="mt-6">
                  <Button
                    className="rounded-full bg-white text-black"
                    isPending={saving}
                    onPress={async () => {
                      const name = displayName.trim();
                      if (!name) return;
                      setSaving(true);
                      try {
                        await onSave({ displayName: name, avatar });
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    Continue
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
