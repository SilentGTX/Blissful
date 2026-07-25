// "Who's watching?" splash — the Netflix-style multi-profile picker, now
// backed for real: every profile signed in on this device gets a tile, and
// clicking one switches to it instantly (no password). Mirrors the Android TV
// app's ProfileMenu switcher; see `lib/accounts.ts`.

import { BlissAvatar, BlissButton, BlissModal } from '../../../components/base';
import { useAuth } from '../../../context/AuthProvider';
import { useBlissfulAuth } from '../../../context/BlissfulAuthProvider';
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
  /** Open the login modal so another profile can be added alongside this one. */
  onAddAccount?: () => void;
};

export function WhoWatchingModal({
  isOpen,
  onOpenChange,
  profileDisplayName,
  profileAvatar,
  onEditProfile,
  onSignOut,
  onAddAccount,
}: WhoWatchingModalProps) {
  const { user, logout } = useAuth();
  const { accounts, token, switchAccount } = useBlissfulAuth();
  if (!isOpen) return null;

  // Saved profiles other than the active one. The active tile is rendered from
  // the live profile (storage display name/avatar), which is fresher than the
  // switcher's cached snapshot.
  const others = accounts.filter((a) => a.token !== token);

  const label = (profileDisplayName ?? user?.displayName ?? user?.username ?? user?.email ?? 'Guest').trim() || 'Guest';
  const avatar = renderProfileAvatar(profileAvatar ?? user?.avatar ?? undefined, label.slice(0, 1).toUpperCase());

  const handleSignOut = () => {
    onOpenChange(false);
    if (onSignOut) onSignOut();
    else logout();
  };

  return (
    <BlissModal>
      <BlissModal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} className="bg-black/60">
        <BlissModal.Container size="lg">
          <BlissModal.Dialog>
            <BlissModal.Header className="sr-only">
              <BlissModal.Heading>Who's watching?</BlissModal.Heading>
            </BlissModal.Header>
            <BlissModal.Body className="px-0">
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
                      <BlissAvatar className="h-20 w-20 text-3xl">
                        {avatar.kind === 'image' ? (
                          <BlissAvatar.Image alt={label} src={avatar.value} />
                        ) : null}
                        <BlissAvatar.Fallback className="text-3xl">
                          {avatar.kind === 'image' ? label.slice(0, 1).toUpperCase() : avatar.value}
                        </BlissAvatar.Fallback>
                      </BlissAvatar>
                      <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--bliss-accent)] text-[11px] font-bold text-black">
                        ✓
                      </span>
                    </div>
                    <div className="mt-2 max-w-[7rem] min-h-[2.6rem] break-words text-center text-sm font-medium leading-tight text-white">
                      {label}
                    </div>
                  </button>

                  {/* Every other profile signed in on this device — one click
                      swaps the active token; library, Continue Watching,
                      settings and friends all re-fetch for that profile. */}
                  {others.map((acc) => {
                    const otherLabel =
                      (acc.user.displayName ?? acc.user.username ?? acc.user.email ?? 'Profile').trim() || 'Profile';
                    const otherAvatar = renderProfileAvatar(
                      acc.user.avatar ?? undefined,
                      otherLabel.slice(0, 1).toUpperCase(),
                    );
                    return (
                      <button
                        key={acc.user.id}
                        type="button"
                        data-testid="who-watching-account"
                        className="group flex w-[7rem] cursor-pointer flex-col items-center opacity-70 transition hover:opacity-100"
                        onClick={() => {
                          switchAccount(acc.user.id);
                          onOpenChange(false);
                        }}
                      >
                        <BlissAvatar className="h-20 w-20 text-3xl transition group-hover:ring-2 group-hover:ring-[var(--bliss-accent)]">
                          {otherAvatar.kind === 'image' ? (
                            <BlissAvatar.Image alt={otherLabel} src={otherAvatar.value} />
                          ) : null}
                          <BlissAvatar.Fallback className="text-3xl">
                            {otherAvatar.kind === 'image' ? otherLabel.slice(0, 1).toUpperCase() : otherAvatar.value}
                          </BlissAvatar.Fallback>
                        </BlissAvatar>
                        <div className="mt-2 max-w-[7rem] min-h-[2.6rem] break-words text-center text-sm font-medium leading-tight text-white">
                          {otherLabel}
                        </div>
                      </button>
                    );
                  })}

                  {/* Add account — signing in does NOT sign the current profile
                      out; it joins the switcher alongside it. */}
                  {onAddAccount ? (
                    <button
                      type="button"
                      data-testid="who-watching-add-account"
                      className="group flex w-[7rem] cursor-pointer flex-col items-center"
                      onClick={() => {
                        onOpenChange(false);
                        onAddAccount();
                      }}
                    >
                      <div className="grid h-20 w-20 place-items-center rounded-full border border-dashed border-white/35 bg-white/5 text-3xl text-white/80 transition group-hover:border-[var(--bliss-accent)] group-hover:text-white">
                        +
                      </div>
                      <div className="mt-2 text-center text-xs text-white/70">Add account</div>
                    </button>
                  ) : null}

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
                  <BlissButton
                    variant="ghost"
                    tone="glass"
                    onPress={handleSignOut}
                  >
                    Sign out
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
