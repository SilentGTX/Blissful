import { useState } from 'react';
import { BlissButton, BlissInput, BlissModal } from '../../../components/base';
import { PRESET_PROFILE_AVATARS, renderProfileAvatar } from '../../../lib/profileAvatars';

type ProfilePromptModalProps = {
  isOpen: boolean;
  initialName: string;
  onSave: (profile: { displayName: string; avatar?: string }) => Promise<void>;
  /** Dismiss without saving — leaves the existing profile untouched. */
  onCancel?: () => void;
};

export function ProfilePromptModal({ isOpen, initialName, onSave, onCancel }: ProfilePromptModalProps) {
  const [displayName, setDisplayName] = useState(initialName);
  const [avatar, setAvatar] = useState<string | undefined>(PRESET_PROFILE_AVATARS[0]);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  return (
    <BlissModal>
      <BlissModal.Backdrop isOpen={isOpen} className="bg-black/55" onOpenChange={() => {}}>
        <BlissModal.Container size="lg">
          <BlissModal.Dialog>
            <BlissModal.Header className="sr-only">
              <BlissModal.Heading>Profile setup</BlissModal.Heading>
            </BlissModal.Header>
            <BlissModal.Body className="px-0">
              <div className="solid-surface mx-auto w-full max-w-xl rounded-[28px] bg-white/10 p-6">
                <div className="font-[Instrument_Serif] text-3xl font-semibold">Who's watching?</div>
                <div className="mt-1 text-sm text-foreground/70">Set your display name and avatar.</div>

                <div className="mt-4">
                  <label className="text-sm text-foreground/70">Username</label>
                  <BlissInput
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="mt-1 w-full focus-within:!border-[var(--bliss-accent)] focus-within:!ring-1 focus-within:!ring-[var(--bliss-accent)]"
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
                          ? 'scale-105 ring-2 ring-[var(--bliss-accent)] ring-offset-1 ring-offset-black/40'
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
                        <span className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[var(--bliss-accent)] text-[9px] font-bold text-black">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                <div className="mt-6 flex items-center justify-end gap-2">
                  {onCancel ? (
                    <BlissButton
                      variant="ghost"
                      className="rounded-full bg-white/10 text-white hover:bg-white/15"
                      isDisabled={saving}
                      onPress={onCancel}
                    >
                      Cancel
                    </BlissButton>
                  ) : null}
                  <BlissButton
                    tone="solid"
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
