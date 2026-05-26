// Global listener for the two party-invite push events:
//
//   - party:invite-request: friend asked to watch with us. Renders
//     a small bottom-right "Accept" pill that creates the room. The
//     host stays on their current /player URL — we just append
//     `?room=<code>` so the player joins the freshly-created room.
//   - party:invite-accepted: friend created a room from our request.
//     Renders a "Join" pill that navigates straight to /player with
//     the room context (no landing page in between).
//
// The banner is a single floating element — visible from anywhere
// (player, library, home), styled to be subtle so it doesn't compete
// with whatever the user is doing.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import {
  useUserSocketEvent,
  type PartyInviteAccepted,
  type PartyInviteRequest,
} from '../context/UserSocketProvider';
import { acceptPartyInvite } from '../lib/blissfulAuthApi';
import { buildRoomPlayerUrl } from '../lib/watchParty';
import { notifyWarning } from '../lib/toastQueues';

const DISMISS_AFTER_MS = 60_000;

export function PartyInviteListener() {
  const { authKey } = useAuth();
  const navigate = useNavigate();
  const [inbound, setInbound] = useState<PartyInviteRequest | null>(null);
  const [accepted, setAccepted] = useState<PartyInviteAccepted | null>(null);
  const [busy, setBusy] = useState(false);

  // Auto-clear after a minute so an old invite doesn't linger
  // forever.
  useEffect(() => {
    if (!inbound) return;
    const id = window.setTimeout(() => setInbound(null), DISMISS_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [inbound]);
  useEffect(() => {
    if (!accepted) return;
    const id = window.setTimeout(() => setAccepted(null), DISMISS_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [accepted]);

  useUserSocketEvent('party:invite-request', (msg) => {
    setInbound(msg);
  });
  useUserSocketEvent('party:invite-accepted', (msg) => {
    setAccepted(msg);
  });

  if (!inbound && !accepted) return null;

  const onAccept = async () => {
    if (!authKey || !inbound || busy) return;
    setBusy(true);
    try {
      const result = await acceptPartyInvite(authKey, {
        requesterUserId: inbound.from.userId,
        type: inbound.activity.type,
        imdbId: inbound.activity.id,
        videoId: inbound.activity.videoId,
      });
      setInbound(null);
      // Host is already in the player — that's exactly why we got
      // the invite request. Don't navigate away; just append the
      // new room code to the current URL so SimplePlayer picks it
      // up reactively and connects to the party socket.
      const here = new URL(window.location.href);
      here.searchParams.set('room', result.code);
      navigate(`${here.pathname}${here.search}`, { replace: true });
    } catch (err: unknown) {
      notifyWarning('Failed to start party', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    if (!accepted) return;
    const target = accepted;
    setAccepted(null);
    try {
      // Skip the /invite landing — we already have everything we
      // need (type/imdbId/videoId/code) to build the player URL
      // directly. Cinemeta lookup inside buildRoomPlayerUrl is
      // best-effort and won't block the navigation.
      const url = await buildRoomPlayerUrl({
        code: target.code,
        type: target.type,
        imdbId: target.imdbId,
        videoId: target.videoId,
      });
      navigate(url);
    } catch (err: unknown) {
      notifyWarning('Failed to join party', err instanceof Error ? err.message : 'Try again');
    }
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[80] flex flex-col items-end gap-2">
      {inbound ? (
        <div className="pointer-events-auto flex max-w-[320px] items-center gap-3 rounded-2xl border border-white/10 bg-[#101116]/95 px-3 py-2 text-sm text-white shadow-2xl backdrop-blur-md">
          <div className="flex flex-col gap-0.5">
            <div className="text-xs uppercase tracking-wide text-white/55">
              {inbound.from.displayName} wants to watch with you
            </div>
            <div className="truncate text-sm font-medium">
              {inbound.activity.name ?? 'this'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onAccept}
              disabled={busy}
              className="cursor-pointer rounded-full bg-[var(--bliss-accent)] px-3 py-1 text-xs font-semibold text-black hover:brightness-95 disabled:opacity-50"
            >
              {busy ? '...' : 'Accept'}
            </button>
            <button
              type="button"
              onClick={() => setInbound(null)}
              className="cursor-pointer rounded-full bg-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/20"
              aria-label="Dismiss"
            >
              X
            </button>
          </div>
        </div>
      ) : null}

      {accepted ? (
        <div className="pointer-events-auto flex max-w-[320px] items-center gap-3 rounded-2xl border border-white/10 bg-[#101116]/95 px-3 py-2 text-sm text-white shadow-2xl backdrop-blur-md">
          <div className="flex flex-col gap-0.5">
            <div className="text-xs uppercase tracking-wide text-white/55">
              {accepted.host.displayName} started a party
            </div>
            <div className="truncate text-sm font-medium text-[var(--bliss-accent)]">
              Tap Join to watch together
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onJoin}
              className="cursor-pointer rounded-full bg-[var(--bliss-accent)] px-3 py-1 text-xs font-semibold text-black hover:brightness-95"
            >
              Join
            </button>
            <button
              type="button"
              onClick={() => setAccepted(null)}
              className="cursor-pointer rounded-full bg-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/20"
              aria-label="Dismiss"
            >
              X
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
