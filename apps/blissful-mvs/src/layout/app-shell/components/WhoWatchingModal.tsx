// "Who's watching?" splash. Originally a Netflix-style multi-profile
// picker; with Blissful's single-account auth it's now a one-tile
// confirmation screen + a "Sign out / Switch user" escape hatch, but
// preserves the original visual language so the home-page open still
// feels familiar.

import { Avatar, Button, Modal } from '@heroui/react';
import { useAuth } from '../../../context/AuthProvider';
import { renderProfileAvatar } from '../../../lib/profileAvatars';

type WhoWatchingModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persisted profile from blissful-storage (display name + avatar). */
  profileDisplayName?: string | null;
  profileAvatar?: string | null;
  /** Open the "Edit profile" flow — keeps modal logic colocated. */
  onEditProfile?: () => void;
  /** Sign out and go back to the login screen. */
  onSignOut?: () => void;
};

export function WhoWatchingModal({
  isOpen,
  onOpenChange,
  profileDisplayName,
  profileAvatar,
  onEditProfile,
  onSignOut,
}: WhoWatchingModalProps) {
  const { user, logout } = useAuth();
  if (!isOpen) return null;

  const label = (profileDisplayName ?? user?.displayName ?? user?.username ?? user?.email ?? 'Guest').trim() || 'Guest';
  const avatar = renderProfileAvatar(profileAvatar ?? user?.avatar ?? undefined, label.slice(0, 1).toUpperCase());

  const handleSignOut = () => {
    onOpenChange(false);
    if (onSignOut) onSignOut();
    else logout();
  };

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
                <div className="text-center font-[Instrument_Serif] text-4xl font-semibold tracking-tight">
                  Who's watching?
                </div>

                <div className="mt-8 flex flex-wrap items-start justify-center gap-x-8 gap-y-10">
                  {/* Current user tile — click closes the modal and lands in the app. */}
                  <button
                    type="button"
                    className="group flex w-[7rem] cursor-pointer flex-col items-center opacity-100 transition"
                    onClick={() => onOpenChange(false)}
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
                      <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--bliss-accent)] text-[11px] font-bold text-black">
                        ✓
                      </span>
                    </div>
                    <div className="mt-2 max-w-[7rem] min-h-[2.6rem] break-words text-center text-sm font-medium leading-tight text-white">
                      {label}
                    </div>
                  </button>

                  {/* Edit profile (display name + avatar). */}
                  {onEditProfile ? (
                    <button
                      type="button"
                      className="group flex w-[7rem] cursor-pointer flex-col items-center"
                      onClick={() => {
                        onOpenChange(false);
                        onEditProfile();
                      }}
                    >
                      <div className="grid h-16 w-16 place-items-center rounded-2xl border border-dashed border-white/35 bg-white/5 text-2xl text-white/80 shadow-[0_16px_35px_rgba(0,0,0,0.25)]">
                        ✎
                      </div>
                      <div className="mt-2 text-center text-xs text-white/70">Edit profile</div>
                    </button>
                  ) : null}
                </div>

                <div className="mt-8 flex justify-center">
                  <Button
                    variant="ghost"
                    className="rounded-full bg-white/10"
                    onPress={handleSignOut}
                  >
                    Sign out
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
