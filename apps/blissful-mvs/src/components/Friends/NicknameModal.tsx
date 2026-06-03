// Lightweight modal for setting / clearing a per-viewer nickname on
// an accepted friend. Pre-fills with the current nickname if any.
// Empty submit clears the override; cancel discards.

import { Button, Input, Modal } from '@heroui/react';
import { useEffect, useState, type FormEvent } from 'react';
import type { FriendRecord } from '../../lib/friendsApi';

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
    <Modal>
      <Modal.Backdrop
        isOpen={true}
        onOpenChange={(open) => { if (!open) onClose(); }}
        variant="blur"
        className="bg-black/50"
      >
        <Modal.Container placement="center" size="md">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only">
              <Modal.Heading>Set nickname</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-0">
              <div className="solid-surface bliss-glass mx-auto w-full max-w-md rounded-[28px] p-6">
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
                  <Input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    type="text"
                    autoFocus
                    placeholder={friend.realName ?? friend.displayName}
                    className="w-full bg-white/10 rounded-xl px-4 py-2"
                    disabled={saving}
                  />

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="rounded-full bg-white/10"
                      onPress={onClose}
                      isDisabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="rounded-full bg-white text-black"
                      isPending={saving}
                    >
                      Save
                    </Button>
                  </div>
                </form>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
