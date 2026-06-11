// Lightweight modal for setting / clearing a per-viewer nickname on
// an accepted friend. Pre-fills with the current nickname if any.
// Empty submit clears the override; cancel discards.

import { useEffect, useState, type FormEvent } from 'react';
import type { FriendRecord } from '../../lib/friendsApi';
import { BlissButton, BlissInput, BlissModal } from '../base';

type Props = {
  friend: FriendRecord | null;
  onClose: () => void;
  onSave: (nickname: string | null) => Promise<void> | void;
};

export function NicknameModal({ friend, onClose, onSave }: Props) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (friend) {
      setValue(friend.nickname ?? '');
      setSaving(false);
    }
  }, [friend]);

  if (!friend) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const trimmed = value.trim();
    setSaving(true);
    try {
      await onSave(trimmed.length === 0 ? null : trimmed);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <BlissModal>
      <BlissModal.Backdrop
        isOpen={true}
        onOpenChange={(open) => { if (!open) onClose(); }}
        className="bg-black/50"
      >
        <BlissModal.Container size="md">
          <BlissModal.Dialog>
            <BlissModal.Header className="sr-only">
              <BlissModal.Heading>Set nickname</BlissModal.Heading>
            </BlissModal.Header>
            <BlissModal.Body className="px-0">
              <div className="solid-surface mx-auto w-full max-w-md rounded-[28px] bg-white/10 p-6">
                <div className="font-[Instrument_Serif] text-2xl font-semibold tracking-tight">
                  Nickname
                </div>
                <div className="mt-1 text-sm text-foreground/70">
                  Pick a name to display only in your friends list for{' '}
                  <span className="font-semibold text-white">
                    {friend.realName ?? friend.displayName}
                  </span>
                  . Leave empty to remove.
                </div>

                <form onSubmit={onSubmit} className="mt-5 space-y-4">
                  <BlissInput
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    type="text"
                    autoFocus
                    placeholder={friend.realName ?? friend.displayName}
                    className="w-full"
                    disabled={saving}
                  />

                  <div className="flex items-center justify-end gap-2">
                    <BlissButton
                      type="button"
                      variant="ghost"
                      tone="glass"
                      onPress={onClose}
                      isDisabled={saving}
                    >
                      Cancel
                    </BlissButton>
                    <BlissButton
                      type="submit"
                      tone="solid"
                      isPending={saving}
                    >
                      Save
                    </BlissButton>
                  </div>
                </form>
              </div>
            </BlissModal.Body>
          </BlissModal.Dialog>
        </BlissModal.Container>
      </BlissModal.Backdrop>
    </BlissModal>
  );
}
