// Host consent prompt for Watch Party v2 Layer B (host relay). When a guest asks
// the (desktop) host to relay its exact stream, the host sees this Share / Decline
// prompt — sharing costs host CPU + upload, so it's the host's explicit choice.
// The "always share" shortcut (alwaysShareHostStream player setting) bypasses this.
// Rendered over the player like the name / password prompts.

import { useState } from 'react';

export type WatchPartyShareConsentProps = {
  /** Who is asking. */
  from: { userId: string; displayName: string };
  /** `always` = the host ticked "always share" → persist the always-allow setting. */
  onShare: (always: boolean) => void;
  onDecline: () => void;
};

export function WatchPartyShareConsent({ from, onShare, onDecline }: WatchPartyShareConsentProps) {
  const [always, setAlways] = useState(false);
  return (
    <div className="absolute inset-0 z-[60] grid place-items-center bg-black/70 backdrop-blur-lg">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/85 p-6 text-white shadow-[0_18px_40px_rgba(0,0,0,0.5)]">
        <div className="text-lg font-semibold">Share your stream?</div>
        <div className="mt-2 text-sm text-white/70">
          <span className="font-semibold text-white">{from.displayName}</span> wants to watch
          your exact stream, frame-aligned. Your device will transcode and upload it to them
          (extra CPU + bandwidth) while you watch.
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-white/75">
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => setAlways(e.target.checked)}
            className="h-4 w-4 accent-[var(--bliss-accent)]"
          />
          Always share with guests (don't ask again)
        </label>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => onShare(always)}
            data-testid="wp-consent-share"
            className="flex-1 rounded-full bg-[var(--bliss-accent)] px-4 py-2 text-sm font-semibold text-black hover:brightness-95"
          >
            Share
          </button>
          <button
            type="button"
            onClick={onDecline}
            data-testid="wp-consent-decline"
            className="flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
