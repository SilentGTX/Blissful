// One row in the sidebar Friends list. Renders avatar (with online
// dot), name, and a status line — either "watching <title>" when the
// friend has an active player session, "online" when they're around
// but idle, or "last seen N ago" when they're away.
//
// In the requests subview the same row shape is reused, but actions
// (Accept / Decline / Cancel / Remove) replace the status line.

import { FriendAvatar } from './FriendAvatar';
import { formatRelativeTime } from './relativeTime';
import { activityLabel } from './activityLabel';
import type { FriendRecord } from '../../lib/friendsApi';
import type { PresenceRecord } from '../../lib/blissfulAuthApi';

type Props = {
  record: FriendRecord;
  presence?: PresenceRecord | null;
  unread?: number;
  /** Click anywhere on the body to open a DM thread (only when the
   *  record is an accepted friend). Requests use the action buttons
   *  instead. */
  onOpenChat?: (record: FriendRecord) => void;
  onAccept?: (id: string) => void;
  onRemove?: (id: string) => void;
};

function statusText(record: FriendRecord, presence?: PresenceRecord | null): string {
  if (record.status === 'pending') {
    return record.direction === 'incoming' ? 'wants to be friends' : 'request sent';
  }
  if (!presence) return 'offline';
  if (presence.online && presence.activity?.name) {
    const label = activityLabel(presence.activity);
    return label ?? 'online';
  }
  if (presence.online) return 'online';
  if (presence.lastSeenAt) return `last seen ${formatRelativeTime(presence.lastSeenAt)}`;
  return 'offline';
}

export function FriendRow({ record, presence, unread, onOpenChat, onAccept, onRemove }: Props) {
  const isAccepted = record.status === 'accepted';
  const isPending = record.status === 'pending';
  const status = statusText(record, presence);
  const online = Boolean(presence?.online);

  const body = (
    <>
      <FriendAvatar displayName={record.displayName} online={online} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{record.displayName}</div>
        <div className="truncate text-[11px] text-white/55">{status}</div>
      </div>
    </>
  );

  if (isAccepted && onOpenChat) {
    return (
      <button
        type="button"
        onClick={() => onOpenChat(record)}
        className="group flex w-full items-center gap-2 rounded-xl bg-white/5 px-2 py-1.5 text-left hover:bg-white/10"
      >
        {body}
        {unread && unread > 0 ? (
          <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bliss-accent)] px-1.5 text-[10px] font-bold leading-none text-black">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    // @container scopes container queries to the row's own width.
    // Narrow rows (e.g., inside the sidebar drawer) get tight
    // circular icon-only action buttons; wider rows show the text
    // labels. The breakpoint @sm (≥384px) is a comfortable cutoff
    // between "sidebar drawer" and "settings/full-width" surfaces.
    <div className="@container flex w-full items-center gap-2 rounded-xl bg-white/5 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">{body}</div>
      {isPending ? (
        <div className="flex shrink-0 items-center gap-1">
          {record.direction === 'incoming' && onAccept ? (
            <button
              type="button"
              onClick={() => onAccept(record.id)}
              title="Accept"
              aria-label="Accept"
              className="group/btn cursor-pointer rounded-full bg-[var(--bliss-accent)]/90 text-black hover:bg-[var(--bliss-accent)] @max-sm:flex @max-sm:h-6 @max-sm:w-6 @max-sm:items-center @max-sm:justify-center @sm:px-2.5 @sm:py-0.5 @sm:text-[11px] @sm:font-semibold"
            >
              <span className="@max-sm:hidden">Accept</span>
              <svg
                className="hidden h-3.5 w-3.5 @max-sm:block"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(record.id)}
              title={record.direction === 'incoming' ? 'Decline' : 'Cancel'}
              aria-label={record.direction === 'incoming' ? 'Decline' : 'Cancel'}
              className="cursor-pointer rounded-full bg-white/10 text-white/80 hover:bg-white/20 @max-sm:flex @max-sm:h-6 @max-sm:w-6 @max-sm:items-center @max-sm:justify-center @sm:px-2 @sm:py-0.5 @sm:text-[11px] @sm:font-medium"
            >
              <span className="@max-sm:hidden">
                {record.direction === 'incoming' ? 'Decline' : 'Cancel'}
              </span>
              <svg
                className="hidden h-3.5 w-3.5 @max-sm:block"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : onRemove ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(record.id); }}
          className="cursor-pointer rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/80 opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-100"
          title="Remove friend"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}
