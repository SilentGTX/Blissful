import { Button, Modal } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import { PRESET_PROFILE_AVATARS, renderProfileAvatar } from '../../../lib/profileAvatars';
import { isTvMode } from '../../../lib/platform';
import { CloseIcon } from '../../../icons/CloseIcon';

type ProfilePromptModalProps = {
  isOpen: boolean;
  initialName: string;
  onSave: (profile: { displayName: string; avatar?: string }) => Promise<void>;
  /** Dismiss without saving. When provided, a close (X) button is shown and
   *  the backdrop becomes dismissable — used when re-opened to change the
   *  avatar later (vs the forced onboarding prompt after first login). */
  onClose?: () => void;
};

const COLS = 4;
// Logical D-pad focus targets, in vertical order: close, the avatar grid
// (av0..avN), then the Save button. No text field => no IME on TV.
type FocusKey = 'close' | 'save' | `av${number}`;

export function ProfilePromptModal({ isOpen, initialName, onSave, onClose }: ProfilePromptModalProps) {
  const [avatar, setAvatar] = useState<string | undefined>(PRESET_PROFILE_AVATARS[0]);
  const [saving, setSaving] = useState(false);

  const tv = isTvMode();
  const [focusKey, setFocusKey] = useState<FocusKey>('av0');
  const focusKeyRef = useRef(focusKey);
  focusKeyRef.current = focusKey;

  // Seed the cursor on the currently-selected avatar each open; pause Norigin
  // for the modal's lifetime (TV).
  useEffect(() => {
    if (!isOpen || !tv) return;
    const idx = Math.max(0, PRESET_PROFILE_AVATARS.indexOf(avatar ?? ''));
    setFocusKey(`av${idx}`);
    pause();
    return () => resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tv]);

  const handleSave = async () => {
    // Display name is unchanged here — this is an avatar-only picker. Keep
    // whatever the account already had (passed in as initialName).
    setSaving(true);
    try {
      await onSave({ displayName: initialName.trim(), avatar });
    } finally {
      setSaving(false);
    }
  };
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  // TV 2D grid navigation. Capture-phase on document (fires for the portaled
  // modal); scoped here because Norigin is paused. Up/Down move by a row,
  // Left/Right within a row, OK selects an avatar / activates a button, Back
  // closes.
  useEffect(() => {
    if (!isOpen || !tv) return;
    const total = PRESET_PROFILE_AVATARS.length;
    const handler = (e: KeyboardEvent) => {
      const k = e.key;
      const isBack = k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || e.keyCode === 10009;
      const isOk = k === 'Enter' || k === ' ' || k === 'Spacebar' || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66;
      const isUp = k === 'ArrowUp' || e.keyCode === 19;
      const isDown = k === 'ArrowDown' || e.keyCode === 20;
      const isLeft = k === 'ArrowLeft' || e.keyCode === 21;
      const isRight = k === 'ArrowRight' || e.keyCode === 22;

      if (isBack) {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        return;
      }

      const cur = focusKeyRef.current;
      const set = (next: FocusKey) => {
        e.preventDefault();
        e.stopPropagation();
        setFocusKey(next);
      };

      if (cur === 'close') {
        if (isDown) set('av0');
        else if (isOk) { e.preventDefault(); e.stopPropagation(); onClose?.(); }
        return;
      }
      if (cur === 'save') {
        if (isUp) set(`av${Math.min(total - 1, COLS)}`); // up to bottom row
        else if (isOk) { e.preventDefault(); e.stopPropagation(); void handleSaveRef.current(); }
        return;
      }
      // Avatar grid.
      const idx = Number(cur.slice(2));
      const row = Math.floor(idx / COLS);
      const col = idx % COLS;
      if (isLeft) { if (col > 0) set(`av${idx - 1}`); else e.preventDefault(); }
      else if (isRight) { if (col < COLS - 1 && idx + 1 < total) set(`av${idx + 1}`); else e.preventDefault(); }
      else if (isUp) { if (row > 0) set(`av${idx - COLS}`); else if (onClose) set('close'); else e.preventDefault(); }
      else if (isDown) { const below = idx + COLS; if (below < total) set(`av${below}`); else set('save'); }
      else if (isOk) {
        e.preventDefault();
        e.stopPropagation();
        setAvatar(PRESET_PROFILE_AVATARS[idx]);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tv, onClose]);

  if (!isOpen) return null;

  const ring = (key: FocusKey) =>
    tv && focusKey === key
      ? ' outline-none ring-2 ring-[var(--bliss-accent)] ring-offset-2 ring-offset-black/40'
      : '';

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        variant="blur"
        className="bg-black/55"
        onOpenChange={(open) => { if (!open) onClose?.(); }}
      >
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only">
              <Modal.Heading>Choose avatar</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-0">
              <div className="solid-surface bliss-glass relative mx-auto w-full max-w-md rounded-[28px] p-6">
                {onClose ? (
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={onClose}
                    className={
                      'absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white/80 transition hover:bg-black/60 hover:text-white' +
                      ring('close')
                    }
                  >
                    <CloseIcon size={16} />
                  </button>
                ) : null}

                <div className="font-[Fraunces] text-2xl font-semibold">Choose your avatar</div>

                <div className="mt-5 grid grid-cols-4 gap-3">
                  {PRESET_PROFILE_AVATARS.map((entry, index) => {
                    const rendered = renderProfileAvatar(entry, '?');
                    const selected = avatar === entry;
                    return (
                      <button
                        key={entry}
                        type="button"
                        onClick={() => setAvatar(entry)}
                        onMouseEnter={() => tv && setFocusKey(`av${index}`)}
                        className={
                          'relative grid aspect-square w-full place-items-center overflow-hidden rounded-xl text-2xl transition ' +
                          (selected ? 'ring-2 ring-[var(--bliss-accent)]' : 'opacity-90 hover:opacity-100') +
                          ring(`av${index}`)
                        }
                      >
                        {rendered.kind === 'image' ? (
                          <img src={entry} alt="Preset avatar" className="h-full w-full object-cover" />
                        ) : (
                          entry
                        )}
                        {selected ? (
                          <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-[var(--bliss-accent)] text-[10px] font-bold text-black">
                            ✓
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6">
                  <Button
                    className={'rounded-full bg-white text-black' + ring('save')}
                    isPending={saving}
                    onPress={handleSave}
                  >
                    Save
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
