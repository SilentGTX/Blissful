// In-player password prompt. Used when a user lands on /player with
// `?room=CODE` and the room turns out to be password-protected
// (typical for invite-link joins where the JoinModal wasn't the
// entry point, so we couldn't stash a password upfront).
//
// Visually identical UX language to the JoinModal's password step
// but rendered as a centered card over the player rather than a
// HeroUI Modal — there's already enough framing on the player.

import { useEffect, useRef, useState } from 'react';
import { verifyWatchPartyPassword } from '../../lib/watchParty';

export type WatchPartyPasswordPromptProps = {
  roomCode: string;
  /** Called once the password has been verified. The parent should
   *  stash it for the hook to pick up. */
  onSubmit: (password: string) => void;
  /** Allow the user to back out of joining — clears `?room=` from
   *  the URL on the parent's side. */
  onCancel: () => void;
};

export function WatchPartyPasswordPrompt({
  roomCode,
  onSubmit,
  onCancel,
}: WatchPartyPasswordPromptProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await verifyWatchPartyPassword(roomCode, password.trim());
    if (result === 'ok') {
      onSubmit(password.trim());
      return;
    }
    if (result === 'wrong-password') setError('Incorrect password');
    else if (result === 'no-room') setError('Room expired or was closed');
    else setError('Failed to verify password');
    setBusy(false);
  };

  return (
    // Sits over the whole player area at the topmost z-level so the
    // buffering / pause overlays don't bleed through.
    <div className="absolute inset-0 z-[60] grid place-items-center bg-black/70 backdrop-blur-lg">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/85 p-6 text-white shadow-[0_18px_40px_rgba(0,0,0,0.5)]">
        <div className="text-lg font-semibold">Password required</div>
        <div className="mt-1 text-sm text-white/60">
          Room <span className="font-mono uppercase tracking-wider text-white/85">{roomCode}</span> is password-protected.
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="mt-4"
        >
          {/* Plain text — a room password is a shared access code,
              not a credential, and using type=password makes
              Bitwarden / 1Password offer to autofill saved logins
              over it. data-*-ignore is the belt-and-suspender
              against any leftover heuristic detection. */}
          <input
            ref={inputRef}
            type="text"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Room password"
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder:text-white/40 focus:border-[var(--bliss-accent)] focus:outline-none"
          />
          {error ? (
            <div className="mt-2 text-sm text-red-400">{error}</div>
          ) : null}
          <div className="mt-5 flex gap-2">
            <button
              type="submit"
              disabled={busy || !password.trim()}
              className="flex-1 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Join'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
