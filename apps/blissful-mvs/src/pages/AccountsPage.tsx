import { Avatar, Button, Input, Modal } from '@heroui/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PenIcon } from '../icons/PenIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { useAuth } from '../context/AuthProvider';
import { useModals } from '../context/ModalsProvider';
import { useStorage } from '../context/StorageProvider';
import { PRESET_PROFILE_AVATARS, renderProfileAvatar } from '../lib/profileAvatars';
import { notifyInfo } from '../lib/toastQueues';

export default function AccountsPage() {
  const { authKey, savedAccounts, switchAccount, removeAccount, updateSavedAccountProfile } =
    useAuth();
  const { updateUserProfile } = useStorage();
  const { openLogin } = useModals();
  const navigate = useNavigate();

  const hasAccounts = savedAccounts.length > 0;
  const currentAuthKey = authKey;

  const subtitle = useMemo(() => {
    if (!hasAccounts) return 'No saved accounts yet. Login once to add one.';
    return 'Switch and manage your accounts instantly.';
  }, [hasAccounts]);

  const [editingAuthKey, setEditingAuthKey] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftAvatar, setDraftAvatar] = useState<string | undefined>(undefined);
  const [pendingRemove, setPendingRemove] = useState<{ authKey: string; name: string } | null>(null);

  const beginEdit = (accountAuthKey: string, currentName: string, currentAvatar?: string) => {
    setEditingAuthKey(accountAuthKey);
    setDraftName(currentName);
    setDraftAvatar(currentAvatar);
  };

  return (
    <div className="mt-4 min-h-[calc(100vh-7rem)]">
      <div className="solid-surface rounded-[28px] bg-white/6 p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-[Fraunces] text-3xl font-semibold tracking-tight">Accounts</div>
            <div className="mt-1 text-sm text-foreground/60">{subtitle}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button className="rounded-full bg-white/10" variant="ghost" onPress={() => navigate(-1)}>
              Back
            </Button>
            <Button className="rounded-full bg-white text-black" onPress={openLogin}>
              Add account
            </Button>
          </div>
        </div>

        {!hasAccounts ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-foreground/70">
            No saved accounts.
          </div>
        ) : (
          <div className="mt-8 grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {savedAccounts.map((account) => {
              const isCurrent = account.authKey === currentAuthKey;
              const isEditing = editingAuthKey === account.authKey;
              const label = account.displayName ?? account.email;
              const avatarView = renderProfileAvatar(account.avatar, label.slice(0, 1).toUpperCase());

              return (
                <div
                  key={account.authKey}
                  className={
                    'self-start rounded-2xl border bg-white/5 p-4 ' +
                    (isCurrent ? 'border-[var(--bliss-teal)]' : 'border-white/10')
                  }
                >
                  {/* Plain expandable card — replaces HeroUI Accordion
                      which injected its own chevron indicator into the
                      header row and pushed our pencil pill outside the
                      card boundary. */}
                  <div className="flex w-full items-center gap-3">
                    <Avatar className="h-12 w-12 bg-transparent rounded-none">
                      {avatarView.kind === 'image' ? (
                        <Avatar.Image alt={label} src={avatarView.value} className="object-contain" />
                      ) : null}
                      <Avatar.Fallback className="border-none bg-transparent text-2xl">
                        {avatarView.kind === 'image' ? label.slice(0, 1).toUpperCase() : avatarView.value}
                      </Avatar.Fallback>
                    </Avatar>

                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-semibold text-white">{label}</div>
                      <div className="truncate text-xs text-foreground/60">{account.email}</div>
                    </div>

                    <button
                      type="button"
                      className="inline-flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                      aria-label={isEditing ? 'Cancel editing' : 'Edit profile'}
                      title={isEditing ? 'Cancel editing' : 'Edit profile'}
                      onClick={() => {
                        if (isEditing) {
                          setEditingAuthKey(null);
                          setDraftAvatar(undefined);
                        } else {
                          beginEdit(account.authKey, label, account.avatar);
                        }
                      }}
                    >
                      {isEditing ? <CloseIcon size={12} /> : <PenIcon />}
                    </button>
                  </div>

                  {isEditing ? (
                    <div className="px-1 pt-3 pb-2">
                          <div className="space-y-2">
                            <Input
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              className="w-full rounded-xl bg-white/10 px-3 py-2 focus-within:!border-[var(--bliss-teal)] focus-within:!ring-1 focus-within:!ring-[var(--bliss-teal)]"
                              placeholder="Profile name"
                            />

                            <div className="grid grid-cols-4 gap-2">
                              {PRESET_PROFILE_AVATARS.map((entry) => (
                                <button
                                  key={entry}
                                  type="button"
                                  className={
                                    'relative grid h-10 w-10 place-items-center overflow-hidden rounded-lg transition ' +
                                    (draftAvatar === entry
                                      ? 'scale-105 ring-2 ring-[#19f7d2] ring-offset-1 ring-offset-black/40'
                                      : 'opacity-90 hover:opacity-100')
                                  }
                                  onClick={() => {
                                    setDraftAvatar(entry);
                                  }}
                                >
                                  {renderProfileAvatar(entry, '?').kind === 'image' ? (
                                    <img src={entry} alt="Preset avatar" className="h-full w-full object-contain" />
                                  ) : (
                                    entry
                                  )}
                                  {draftAvatar === entry ? (
                                    <span className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#19f7d2] text-[9px] font-bold text-black">
                                      ✓
                                    </span>
                                  ) : null}
                                </button>
                              ))}
                            </div>

                            <div className="pt-2 flex items-center justify-between gap-2">
                              <div>
                                {isEditing ? (
                                  <Button
                                    className="rounded-full bg-white text-black"
                                    size="sm"
                                    onPress={async () => {
                                      const nextName = draftName.trim();
                                      if (!nextName) return;
                                      updateSavedAccountProfile(account.authKey, {
                                        displayName: nextName,
                                        avatar: draftAvatar,
                                      });
                                      if (isCurrent) {
                                        await updateUserProfile({
                                          displayName: nextName,
                                          avatar: draftAvatar,
                                        });
                                      } else {
                                        notifyInfo('Local update', 'Switched account profile updated locally.');
                                      }
                                      setEditingAuthKey(null);
                                      setDraftAvatar(undefined);
                                    }}
                                  >
                                    Save
                                  </Button>
                                ) : null}
                              </div>

                              <div className="flex items-center gap-2">
                                <Button
                                  className="rounded-full bg-white/10"
                                  variant="ghost"
                                  size="sm"
                                  onPress={() => setPendingRemove({ authKey: account.authKey, name: label })}
                                >
                                  Remove
                                </Button>
                                <Button
                                  className="rounded-full bg-white text-black"
                                  size="sm"
                                  isDisabled={isCurrent}
                                  onPress={async () => {
                                    await switchAccount(account.authKey);
                                  }}
                                >
                                  {isCurrent ? 'Current' : 'Switch'}
                                </Button>
                              </div>
                            </div>
                          </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal>
        <Modal.Backdrop
          isOpen={Boolean(pendingRemove)}
          onOpenChange={(open) => {
            if (!open) setPendingRemove(null);
          }}
          variant="blur"
          className="bg-black/55"
        >
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="bg-transparent shadow-none">
              <Modal.Header className="sr-only">
                <Modal.Heading>Confirm remove</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="px-0">
                <div className="solid-surface rounded-[24px] bg-white/10 p-5">
                  <div className="text-base font-semibold">Remove account?</div>
                  <div className="mt-1 text-sm text-foreground/70">
                    {pendingRemove ? `Are you sure you want to remove ${pendingRemove.name}?` : ''}
                  </div>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <Button
                      className="rounded-full bg-white/10"
                      variant="ghost"
                      onPress={() => setPendingRemove(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="rounded-full bg-white text-black"
                      onPress={() => {
                        if (pendingRemove) removeAccount(pendingRemove.authKey);
                        setPendingRemove(null);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
