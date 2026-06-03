import { Button, Input, Modal } from '@heroui/react';
import { useState } from 'react';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { PRESET_PROFILE_AVATARS, renderProfileAvatar } from '../../../lib/profileAvatars';
import { useTvFocusable } from '../../../spatial/useTvFocusable';
import { isTvMode } from '../../../lib/platform';

type ProfilePromptModalProps = {
  isOpen: boolean;
  initialName: string;
  onSave: (profile: { displayName: string; avatar?: string }) => Promise<void>;
};

// A single avatar tile. Extracted so it can host a TV focus node (hooks can't
// run inside a .map). On TV it becomes a Norigin focusable; on desktop the
// onClick still drives selection. Selecting is via D-pad OK (onPress).
type FocusAvatarProps = {
  entry: string;
  selected: boolean;
  autoFocus: boolean;
  onSelect: () => void;
};

function FocusAvatar({ entry, selected, autoFocus, onSelect }: FocusAvatarProps) {
  const { ref } = useTvFocusable({ onPress: onSelect, autoFocus });
  const rendered = renderProfileAvatar(entry, '?');
  return (
    <button
      ref={ref}
      type="button"
      className={
        'relative grid h-14 w-14 place-items-center overflow-hidden rounded-lg text-2xl transition ' +
        (selected
          ? 'scale-105 ring-2 ring-[#19f7d2] ring-offset-1 ring-offset-black/40'
          : 'opacity-90 hover:opacity-100')
      }
      onClick={onSelect}
    >
      {rendered.kind === 'image' ? (
        <img src={entry} alt="Preset avatar" className="h-full w-full object-contain" />
      ) : (
        entry
      )}
      {selected ? (
        <span className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#19f7d2] text-[9px] font-bold text-black">
          ✓
        </span>
      ) : null}
    </button>
  );
}

export function ProfilePromptModal({ isOpen, initialName, onSave }: ProfilePromptModalProps) {
  const [displayName, setDisplayName] = useState(initialName);
  const [avatar, setAvatar] = useState<string | undefined>(PRESET_PROFILE_AVATARS[0]);
  const [saving, setSaving] = useState(false);

  // TV: wrap the avatar grid in a Norigin focus boundary so the D-pad stays
  // inside it (geometry walks the 4-column grid). Inert on desktop.
  const tv = isTvMode();
  const { ref: gridRef, focusKey: gridFocusKey } = useFocusable({
    focusable: tv,
    isFocusBoundary: tv,
    focusBoundaryDirections: ['up', 'down', 'left', 'right'],
    saveLastFocusedChild: true,
    trackChildren: true,
  });

  const handleContinue = async () => {
    const name = displayName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await onSave({ displayName: name, avatar });
    } finally {
      setSaving(false);
    }
  };

  // Continue button as a TV focus node so the D-pad can move Down onto it from
  // the avatar grid and press it. Inert on desktop (onPress still fires on click).
  const { ref: continueRef } = useTvFocusable({ onPress: handleContinue });

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
              <div className="solid-surface bliss-glass mx-auto w-full max-w-xl rounded-[28px] p-6">
                <div className="font-[Fraunces] text-3xl font-semibold">Who's watching?</div>
                <div className="mt-1 text-sm text-foreground/70">Set your display name and avatar.</div>

                <div className="mt-4">
                  <label className="text-sm text-foreground/70">Username</label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-white/10 px-4 py-2 focus-within:!border-[var(--bliss-accent)] focus-within:!ring-1 focus-within:!ring-[var(--bliss-accent)]"
                    placeholder="Your profile name"
                  />
                </div>

                <FocusContext.Provider value={gridFocusKey}>
                  <div ref={gridRef}>
                    <div className="mt-4 grid grid-cols-4 gap-2">
                      {PRESET_PROFILE_AVATARS.map((entry, index) => (
                        <FocusAvatar
                          key={entry}
                          entry={entry}
                          selected={avatar === entry}
                          autoFocus={avatar === entry || (avatar === undefined && index === 0)}
                          onSelect={() => setAvatar(entry)}
                        />
                      ))}
                    </div>

                    <div className="mt-6">
                      <Button
                        ref={continueRef}
                        className="rounded-full bg-white text-black"
                        isPending={saving}
                        onPress={handleContinue}
                      >
                        Continue
                      </Button>
                    </div>
                  </div>
                </FocusContext.Provider>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
