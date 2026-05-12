import { Avatar, Button, Modal } from '@heroui/react';
import type { SavedAccount } from '../../../lib/savedAccounts';
import { renderProfileAvatar } from '../../../lib/profileAvatars';

type WhoWatchingModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: SavedAccount[];
  currentAuthKey: string | null;
  onSwitchAccount: (authKey: string) => Promise<void>;
  onAddProfile: () => void;
  onManageAccounts: () => void;
};

export function WhoWatchingModal({
  isOpen,
  onOpenChange,
  accounts,
  currentAuthKey,
  onSwitchAccount,
  onAddProfile,
  onManageAccounts,
}: WhoWatchingModalProps) {
  if (!isOpen) return null;

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="blur" className="bg-black/60">
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="bg-transparent shadow-none">
            <Modal.Header className="sr-only">
              <Modal.Heading>Who's watching?</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-0">
              <div className="solid-surface mx-auto w-full max-w-3xl rounded-[28px] bg-white/10 p-6 md:p-8">
                <div className="text-center font-[Fraunces] text-4xl font-semibold tracking-tight">Who's watching?</div>
                <div className="mt-8 flex flex-wrap items-start justify-center gap-x-8 gap-y-10">
                  {accounts.map((account) => {
                    const avatar = renderProfileAvatar(account.avatar, account.displayName?.slice(0, 1).toUpperCase() ?? 'B');
                    const label = account.displayName ?? account.email;
                    const isCurrent = account.authKey === currentAuthKey;
                    return (
                      <button
                        key={account.authKey}
                        type="button"
                        className={'group relative flex w-[7rem] cursor-pointer flex-col items-center transition ' + (isCurrent ? 'opacity-100' : 'opacity-90 hover:opacity-100')}
                        onClick={async () => {
                          await onSwitchAccount(account.authKey);
                          onOpenChange(false);
                        }}
                      >
                        <div className="relative h-20 w-20">
                          <Avatar className="h-20 w-20 bg-transparent rounded-none text-3xl">
                            {avatar.kind === 'image' ? (
                              <Avatar.Image alt={label} src={avatar.value} className="object-contain" />
                            ) : null}
                            <Avatar.Fallback className="border-none bg-transparent text-3xl">
                              {avatar.kind === 'image' ? label.slice(0, 1).toUpperCase() : avatar.value}
                            </Avatar.Fallback>
                          </Avatar>
                          {isCurrent ? (
                            <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--bliss-teal)] text-[11px] font-bold text-black">
                              ✓
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 max-w-[7rem] min-h-[2.6rem] break-words text-center text-sm font-medium leading-tight text-white">
                          {label}
                        </div>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    className="group flex w-[7rem] cursor-pointer flex-col items-center"
                    onClick={() => {
                      onOpenChange(false);
                      onAddProfile();
                    }}
                  >
                    <div className="grid h-16 w-16 place-items-center rounded-2xl border border-dashed border-white/35 bg-white/5 text-4xl text-white/80 shadow-[0_16px_35px_rgba(0,0,0,0.25)]">
                      +
                    </div>
                  </button>
                </div>

                <div className="mt-8 flex justify-center">
                  <Button
                    variant="ghost"
                    className="rounded-full bg-white/10"
                    onPress={() => {
                      onOpenChange(false);
                      onManageAccounts();
                    }}
                  >
                    Manage accounts
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
