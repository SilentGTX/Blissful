import { Button, Input, Modal } from '@heroui/react';
import { useRef, useState } from 'react';
import { PRESET_PROFILE_AVATARS, renderProfileAvatar } from '../../../lib/profileAvatars';
import { useTvOverlay } from '../../../spatial/useTvOverlay';
import { isTvMode } from '../../../lib/platform';
import { CloseIcon } from '../../../icons/CloseIcon';

type ProfilePromptModalProps = {
  isOpen: boolean;
  initialName: string;
  onSave: (profile: { displayName: string; avatar?: string }) => Promise<void>;
  /** Dismiss without saving. When provided, a close (X) button is shown and
   *  the backdrop becomes dismissable — used when re-opened to edit the
   *  avatar later (vs the forced onboarding prompt after first login). */
  onClose?: () => void;
};

// A single avatar tile. Plain <button> — TV D-pad navigation is driven by the
// modal's useTvOverlay (it walks every focusable button/input in DOM order),
// so no per-tile focus hook is needed. The selected tile carries
// `data-autofocus` so the overlay lands focus on it when the modal opens.
type AvatarTileProps = {
  entry: string;
  selected: boolean;
  autoFocus: boolean;
  onSelect: () => void;
};

function AvatarTile({ entry, selected, autoFocus, onSelect }: AvatarTileProps) {
  const rendered = renderProfileAvatar(entry, '?');
  return (
    <button
      type="button"
      data-autofocus={autoFocus || undefined}
      className={
        'relative grid h-14 w-14 place-items-center overflow-hidden rounded-lg text-2xl transition ' +
        (selected
          ? 'scale-105 ring-2 ring-[var(--bliss-accent)] ring-offset-1 ring-offset-black/40'
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
        <span className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[var(--bliss-accent)] text-[9px] font-bold text-black">
          ✓
        </span>
      ) : null}
    </button>
  );
}

export function ProfilePromptModal({ isOpen, initialName, onSave, onClose }: ProfilePromptModalProps) {
  const [displayName, setDisplayName] = useState(initialName);
  const [avatar, setAvatar] = useState<string | undefined>(PRESET_PROFILE_AVATARS[0]);
  const [saving, setSaving] = useState(false);

  // TV: drive the whole modal with the shared overlay primitive — same pattern
  // as LoginModal / ResumeOrStartOverModal (pauses Norigin, captures D-pad on
  // document, walks the modal's focusables with Up/Down/Left/Right, OK clicks,
  // Back closes). The earlier Norigin-focusable approach didn't register the
  // portaled grid reliably, so the D-pad couldn't move inside the modal.
  // Inert off-TV. autoFocus lands on the currently-selected avatar.
  const containerRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useTvOverlay({
    open: isOpen,
    containerRef,
    // Back during onboarding (no onClose) is a no-op — the user must pick.
    onClose: onClose ?? (() => {}),
    autoFocusSelector: '[data-autofocus]',
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

  if (!isOpen) return null;

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        variant="blur"
        className="bg-black/55"
        onOpenChange={(open) => { if (!open) onClose?.(); }}
      >
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only">
              <Modal.Heading>Profile setup</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-0">
              <div
                ref={containerRef}
                onKeyDown={onKeyDown}
                className="solid-surface bliss-glass relative mx-auto w-full max-w-xl rounded-[28px] p-6"
              >
                {onClose ? (
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={onClose}
                    className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white/80 transition hover:bg-black/60 hover:text-white"
                  >
                    <CloseIcon size={16} />
                  </button>
                ) : null}
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

                <div className="mt-4 grid grid-cols-4 gap-2">
                  {PRESET_PROFILE_AVATARS.map((entry, index) => (
                    <AvatarTile
                      key={entry}
                      entry={entry}
                      selected={avatar === entry}
                      autoFocus={
                        isTvMode() &&
                        (avatar === entry || (avatar === undefined && index === 0))
                      }
                      onSelect={() => setAvatar(entry)}
                    />
                  ))}
                </div>

                <div className="mt-6">
                  <Button
                    className="rounded-full bg-white text-black"
                    isPending={saving}
                    onPress={handleContinue}
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
