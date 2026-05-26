// In-player name prompt for users without a usable display name
// (Stremio "Guest" fallback or no login at all). Rendered over the
// player just like the password prompt — blocking until they pick
// something, since the chosen name is what appears in the participant
// list and chat.

import { useEffect, useRef, useState } from 'react';

export type WatchPartyNamePromptProps = {
  /** Optional initial value — e.g. the user's email local-part or
   *  whatever displayName guess we already have. */
  initialName?: string | null;
  onSubmit: (name: string) => void;
  /** Lets the user back out — typically clears `?room=` from the URL
   *  so the player resumes solo playback. */
  onCancel: () => void;
};

export function WatchPartyNamePrompt({
  initialName,
  onSubmit,
  onCancel,
}: WatchPartyNamePromptProps) {
  const [name, setName] = useState(initialName?.trim() ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const canSubmit = name.trim().length >= 1 && name.trim().length <= 32;

  return (
    <div className="absolute inset-0 z-[60] grid place-items-center bg-black/70 backdrop-blur-lg">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/85 p-6 text-white shadow-[0_18px_40px_rgba(0,0,0,0.5)]">
        <div className="text-lg font-semibold">What should we call you?</div>
        <div className="mt-1 text-sm text-white/60">
          This is the name everyone in the party will see in the
          participant list and chat.
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSubmit(name.trim());
          }}
          className="mt-4"
        >
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={32}
            autoComplete="nickname"
            className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-base text-white placeholder:text-white/40 focus:border-[var(--bliss-accent)] focus:outline-none"
          />
          <div className="mt-5 flex gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              Join party
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
