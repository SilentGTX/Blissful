// Watch-party activity toast — surfaces pause / play / seek /
// join / leave / host-change events AND chat messages at the top
// of the player. Built on HeroUI's <Toast> + <ToastQueue>, which
// gives us a properly stacked pile (newest in front, older ones
// receding behind with a small scale-down) and spring slide-in
// animations out of the box.
//
// One queue per mount — when the user leaves the room and rejoins
// we get a fresh queue/state, which is what we want.

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Toast, ToastQueue } from '@heroui/react';
import type { WatchPartyActivity } from '../../lib/useWatchParty';
import type { WatchPartyChatMessage } from '../../lib/watchParty';

export type WatchPartyActivityToastProps = {
  activity: WatchPartyActivity[];
  chat: WatchPartyChatMessage[];
  selfUserId: string | null;
};

type ToastPayload = {
  icon: ReactNode;
  text: ReactNode;
};

const TOAST_TIMEOUT_MS = 3500;
const CHAT_PREVIEW_MAX = 60;

function formatTime(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function describeActivity(item: WatchPartyActivity): { icon: string; text: string } {
  const who = item.who.displayName || 'Someone';
  switch (item.kind) {
    case 'pause':
      return {
        icon: '||',
        text: `${who} paused${item.currentTime != null ? ` at ${formatTime(item.currentTime)}` : ''}`,
      };
    case 'play':
      return { icon: '>', text: `${who} resumed playback` };
    case 'seek':
      return { icon: '>>', text: `${who} jumped to ${formatTime(item.currentTime)}` };
    case 'joined':
      return { icon: '+', text: `${who} joined the party` };
    case 'left':
      return { icon: '-', text: `${who} left the party` };
    case 'host-changed':
      return { icon: '*', text: `${who} is now the host` };
    default:
      return { icon: '*', text: who };
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '...';
}

function activityShouldShow(item: WatchPartyActivity, selfUserId: string | null): boolean {
  // Skip our own play/pause/seek — we know we did it. Presence
  // events fall through naturally (they're about other people).
  if (
    (item.kind === 'play' || item.kind === 'pause' || item.kind === 'seek')
    && selfUserId
    && item.who.userId === selfUserId
  ) {
    return false;
  }
  return true;
}

export function WatchPartyActivityToast({
  activity,
  chat,
  selfUserId,
}: WatchPartyActivityToastProps) {
  const queue = useMemo(() => new ToastQueue<ToastPayload>({ maxVisibleToasts: 3 }), []);

  // Track the last-toasted IDs/keys so we only emit a toast when
  // a *new* item is appended — not when the parent re-renders or
  // when history is hydrated on connect. The chat ref also
  // snapshots the backlog length on first mount so the join
  // replay doesn't get blasted as N toasts.
  const lastActivityIdRef = useRef<string | null>(null);
  const lastChatKeyRef = useRef<string | null>(null);
  const chatInitRef = useRef(false);

  // Activity -> queue.
  useEffect(() => {
    if (activity.length === 0) return;
    const latest = activity[activity.length - 1]!;
    if (lastActivityIdRef.current === latest.id) return;
    lastActivityIdRef.current = latest.id;
    if (!activityShouldShow(latest, selfUserId)) return;
    const { icon, text } = describeActivity(latest);
    queue.add(
      { icon, text },
      { timeout: TOAST_TIMEOUT_MS },
    );
  }, [activity, selfUserId, queue]);

  // Chat -> queue (skip our own messages — we know what we sent).
  useEffect(() => {
    if (chat.length === 0) return;
    const latest = chat[chat.length - 1]!;
    const key = `${latest.from.userId}-${latest.at}`;
    if (!chatInitRef.current) {
      // First hydration after mount/connect — backlog is history,
      // not a new message worth toasting.
      chatInitRef.current = true;
      lastChatKeyRef.current = key;
      return;
    }
    if (lastChatKeyRef.current === key) return;
    lastChatKeyRef.current = key;
    if (selfUserId && latest.from.userId === selfUserId) return;
    const preview = truncate(latest.text.replace(/\s+/g, ' ').trim(), CHAT_PREVIEW_MAX);
    const author = latest.from.displayName || 'Someone';
    queue.add(
      {
        icon: 'chat',
        text: (
          <>
            <span className="font-semibold">{author}:</span>{' '}
            <span className="text-white/85">{preview}</span>
          </>
        ),
      },
      { timeout: TOAST_TIMEOUT_MS },
    );
  }, [chat, selfUserId, queue]);

  return (
    <Toast.Provider
      placement="top"
      queue={queue}
      gap={6}
      scaleFactor={0.06}
      width={360}
      className="pointer-events-none"
    >
      {({ toast: toastItem }) => {
        const payload = toastItem.content as ToastPayload;
        return (
          <Toast
            toast={toastItem}
            // pointer-events-none across the board so the toast
            // never intercepts clicks/hovers on the player below.
            // (HeroUI's base `.toast` is pointer-events-auto.)
            className="!pointer-events-none flex w-full items-center gap-2 rounded-full border border-white/15 bg-black/65 px-4 py-2 text-sm font-medium text-white shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          >
            {payload.icon ? <span className="shrink-0 leading-none">{payload.icon}</span> : null}
            <span className="min-w-0 flex-1 truncate">{payload.text}</span>
          </Toast>
        );
      }}
    </Toast.Provider>
  );
}
