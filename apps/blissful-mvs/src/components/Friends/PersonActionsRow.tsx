// Dropdown-menu row for any person in the sidebar:
//   - Existing friends -> Nickname / Remove friend
//   - Non-friends      -> Add friend
//
// Chat / DM actions were removed from the friends accordion -- this
// component is friend-graph only.

import { Button, Dropdown, Label } from '@heroui/react';
import { FriendAvatar } from './FriendAvatar';
import { formatRelativeTime } from './relativeTime';
import { activityLabel } from './activityLabel';
import type { FriendRecord } from '../../lib/friendsApi';
import type { PresenceRecord } from '../../lib/blissfulAuthApi';

type Subtitle = { kind: 'status'; presence?: PresenceRecord | null } | { kind: 'text'; text: string };

type Props = {
  userId: string;
  displayName: string;
  /** When provided, enables the "Nickname" + "Remove friend" actions. */
  friendRecord?: FriendRecord;
  /** When provided, the row is for a non-friend with a pending
   *  outgoing request. Replaces the Add-friend action with a
   *  Cancel-invite action that takes this friend-edge id. */
  pendingOutgoingId?: string;
  presence?: PresenceRecord | null;
  /** Override the subtitle line. Defaults to presence-derived status. */
  subtitle?: Subtitle;
  /** Required when `friendRecord` is provided. */
  onSetNickname?: () => void;
  /** Either onRemove (friend) or onAddFriend (non-friend) must be
   *  provided -- the menu shows whichever matches. */
  onRemove?: () => void;
  onAddFriend?: () => void;
  /** Called when the user picks "Cancel invite" on a pending row.
   *  Receives the outgoing friend-edge id. */
  onCancelInvite?: (id: string) => void;
  /** Optional "Request party" action -- only shown when the friend
   *  has a fresh `currentActivity` (i.e. is watching something) so
   *  there's a title to ask to join. */
  onRequestParty?: () => void;
  /** When the friend has already accepted an invite from us and the
   *  room is still open, the dropdown swaps "Request party" for a
   *  one-click "Join party" that drops us straight into the player
   *  for that room. Cleared when the server pushes room-closed. */
  hasActiveParty?: boolean;
  onJoinParty?: () => void;
};

function statusText(presence?: PresenceRecord | null): string {
  if (!presence) return 'offline';
  if (presence.online && presence.activity?.name) {
    // The title itself is the status line -- no "watching" prefix
    // since the row's online dot already implies live activity.
    const label = activityLabel(presence.activity);
    return label ?? 'online';
  }
  if (presence.online) return 'online';
  if (presence.lastSeenAt) return `last seen ${formatRelativeTime(presence.lastSeenAt)}`;
  return 'offline';
}

export function PersonActionsRow({
  displayName,
  friendRecord,
  pendingOutgoingId,
  presence,
  subtitle,
  onSetNickname,
  onRemove,
  onAddFriend,
  onCancelInvite,
  onRequestParty,
  hasActiveParty,
  onJoinParty,
}: Props) {
  const isFriend = Boolean(friendRecord);
  const isPendingOutgoing = Boolean(pendingOutgoingId) && !isFriend;
  const online = Boolean(presence?.online);
  const subText = subtitle?.kind === 'text'
    ? subtitle.text
    : statusText(subtitle?.kind === 'status' ? subtitle.presence : presence);
  const canJoinParty = isFriend && Boolean(hasActiveParty) && Boolean(onJoinParty);
  // Request-party only shows when there's no live room with this
  // friend yet -- once they've accepted, the slot is taken by Join.
  const canRequestParty =
    isFriend
    && !canJoinParty
    && Boolean(onRequestParty)
    && Boolean(presence?.online && presence?.activity?.name);
  const hasMenu =
    (isFriend && (Boolean(onSetNickname) || Boolean(onRemove) || canRequestParty || canJoinParty))
    || (isPendingOutgoing && Boolean(onCancelInvite))
    || (!isFriend && !isPendingOutgoing && Boolean(onAddFriend));

  const rowInner = (
    <>
      <FriendAvatar
        displayName={displayName}
        // Avatar grows on tall screens (clamp), same vh anchor as
        // the CW thumb so the two cards feel consistent.
        size="clamp(1.75rem, 5vh, 2.75rem)"
        online={online}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-white text-[clamp(13px,2vh,16px)] leading-tight">{displayName}</div>
        <div className="truncate text-white/55 text-[clamp(11px,1.5vh,13px)] mt-0.5">{subText}</div>
      </div>
    </>
  );

  // Row padding scales with viewport so each friend gets more
  // breathing room on big screens. `shrink-0 + snap-start` keep the
  // row at its natural height -- the parent scroll container snaps
  // to row boundaries so we never show a half-clipped friend at the
  // edge of the visible area. The `!` prefixes force overrides on
  // HeroUI's default Button height/padding.
  const rowClass =
    'flex !h-auto !min-h-0 w-full shrink-0 snap-start items-center !justify-start gap-[clamp(0.5rem,1.2vh,0.875rem)] rounded-xl bg-white/5 !px-[clamp(0.625rem,1.4vh,1rem)] !py-[clamp(0.375rem,1vh,0.625rem)] text-left hover:bg-white/10';

  if (!hasMenu) {
    return (
      <div className="flex w-full shrink-0 snap-start items-center gap-[clamp(0.5rem,1.2vh,0.875rem)] rounded-xl bg-white/5 px-[clamp(0.625rem,1.4vh,1rem)] py-[clamp(0.375rem,1vh,0.625rem)]">
        {rowInner}
      </div>
    );
  }

  return (
    <Dropdown>
      <Button
        variant="ghost"
        size="sm"
        className={rowClass}
      >
        {rowInner}
      </Button>
      <Dropdown.Popover className="solid-surface min-w-[180px] rounded-2xl bg-white/10 p-1 text-white shadow-xl">
        <Dropdown.Menu
          onAction={(key) => {
            const action = String(key);
            if (action === 'nickname' && onSetNickname) onSetNickname();
            else if (action === 'request-party' && onRequestParty) onRequestParty();
            else if (action === 'join-party' && onJoinParty) onJoinParty();
            else if (action === 'add' && onAddFriend) onAddFriend();
            else if (action === 'cancel' && pendingOutgoingId && onCancelInvite) onCancelInvite(pendingOutgoingId);
            else if (action === 'remove' && onRemove) onRemove();
          }}
        >
          {canJoinParty ? (
            <Dropdown.Item id="join-party" textValue="Join party" className="rounded-xl px-3 py-2 text-sm hover:bg-white/10 data-[hovered=true]:bg-white/10">
              <Label className="text-[var(--bliss-accent)]">Join party</Label>
            </Dropdown.Item>
          ) : null}
          {canRequestParty ? (
            <Dropdown.Item id="request-party" textValue="Request party" className="rounded-xl px-3 py-2 text-sm hover:bg-white/10 data-[hovered=true]:bg-white/10">
              <Label className="text-[var(--bliss-accent)]">Request party</Label>
            </Dropdown.Item>
          ) : null}
          {isFriend && onSetNickname ? (
            <Dropdown.Item id="nickname" textValue="Nickname" className="rounded-xl px-3 py-2 text-sm hover:bg-white/10 data-[hovered=true]:bg-white/10">
              <Label>Nickname</Label>
            </Dropdown.Item>
          ) : null}
          {isFriend && onRemove ? (
            <Dropdown.Item id="remove" textValue="Remove friend" className="rounded-xl px-3 py-2 text-sm hover:bg-white/10 data-[hovered=true]:bg-white/10">
              <Label className="text-red-300">Remove friend</Label>
            </Dropdown.Item>
          ) : null}
          {isPendingOutgoing && onCancelInvite ? (
            <Dropdown.Item id="cancel" textValue="Cancel invite" className="rounded-xl px-3 py-2 text-sm hover:bg-white/10 data-[hovered=true]:bg-white/10">
              <Label className="text-white/80">Cancel invite</Label>
            </Dropdown.Item>
          ) : null}
          {!isFriend && !isPendingOutgoing && onAddFriend ? (
            <Dropdown.Item id="add" textValue="Add friend" className="rounded-xl px-3 py-2 text-sm hover:bg-white/10 data-[hovered=true]:bg-white/10">
              <Label className="text-[var(--bliss-accent)]">Add friend</Label>
            </Dropdown.Item>
          ) : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
