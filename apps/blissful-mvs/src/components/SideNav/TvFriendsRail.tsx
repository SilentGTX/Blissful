// Friends, living INSIDE the TV nav rail (auto-expanding accordion, not a
// popup). When the rail is expanded (focused) the Friends section auto-reveals
// a search row, a Requests toggle, and the friend list with live presence
// (online dot, "watching X" / "last seen N ago"). Every row is a Norigin
// focusable that reports rail-focus (so the rail stays open while you navigate
// friends), and lives in the rail's FocusContext boundary so Up/Down stay
// within the rail and Right exits to content. Pressing a friend opens a
// centered actions menu (Join/Request party, Nickname, Remove).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import { useFriends } from '../../context/FriendsProvider';
import { useAuth } from '../../context/AuthProvider';
import { useActiveParties, type ActiveParty } from '../../context/ActivePartiesProvider';
import { usePresenceLookup, useUserSearch } from '../../lib/useSocial';
import { requestPartyInvite } from '../../lib/blissfulAuthApi';
import { buildRoomPlayerUrl } from '../../lib/watchParty';
import { notifySuccess, notifyWarning } from '../../lib/toastQueues';
import { useTvFocusable } from '../../spatial/useTvFocusable';
import { FriendAvatar } from '../Friends/FriendAvatar';
import { NicknameModal } from '../Friends/NicknameModal';
import { activityLabel } from '../Friends/activityLabel';
import { formatRelativeTime } from '../Friends/relativeTime';
import { FriendsIcon } from '../../icons/FriendsIcon';
import type { FriendRecord } from '../../lib/friendsApi';
import type { PresenceRecord } from '../../lib/blissfulAuthApi';

type Props = {
  collapsed: boolean;
  isSignedIn: boolean;
  onOpenLogin: () => void;
  onRailFocus?: (focused: boolean) => void;
};

function statusLine(p?: PresenceRecord | null): string {
  if (!p) return 'offline';
  if (p.online && p.activity?.name) return activityLabel(p.activity) ?? 'online';
  if (p.online) return 'online';
  if (p.lastSeenAt) return `last seen ${formatRelativeTime(p.lastSeenAt)}`;
  return 'offline';
}

/** A focusable rail row (button). Reports rail focus so the rail stays open. */
function RailRow({
  onPress,
  onRailFocus,
  className,
  ariaLabel,
  children,
}: {
  onPress?: () => void;
  onRailFocus?: (f: boolean) => void;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const { ref } = useTvFocusable({
    onPress,
    onFocus: () => onRailFocus?.(true),
    onBlur: () => onRailFocus?.(false),
  });
  return (
    <button ref={ref} type="button" onClick={onPress} className={className} aria-label={ariaLabel}>
      {children}
    </button>
  );
}

/** Search row — a focusable shell that native-focuses its input on OK so the
 *  on-screen keyboard opens; pauses the spatial engine while editing. */
function RailSearchRow({
  value,
  onChange,
  onRailFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onRailFocus?: (f: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref } = useTvFocusable({
    onPress: () => inputRef.current?.focus(),
    onFocus: () => onRailFocus?.(true),
    onBlur: () => onRailFocus?.(false),
  });
  return (
    <div ref={ref} className="tv-friends-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => pause()}
        onBlur={() => resume()}
        onKeyDown={(e) => {
          // Escape / Down / Up release the field (blur → onBlur resumes the
          // spatial engine) so the user is never trapped in the paused input.
          if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            inputRef.current?.blur();
          }
        }}
        placeholder="Search people…"
      />
    </div>
  );
}

/** Centered, D-pad-driven actions menu for a friend (Join/Request party,
 *  Nickname, Remove friend). Pauses the spatial engine and self-drives focus
 *  with Up/Down/Enter/Esc — same pattern as the profile menu. ("View profile"
 *  from the desktop WIP isn't in this codebase yet, so it's omitted.) */
function TvFriendActionsMenu({
  friend,
  presence,
  activeParty,
  onClose,
  onRequestParty,
  onJoinParty,
  onNickname,
  onRemove,
}: {
  friend: FriendRecord;
  presence?: PresenceRecord | null;
  activeParty?: ActiveParty | null;
  onClose: () => void;
  onRequestParty: () => void;
  onJoinParty: () => void;
  onNickname: () => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pause();
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      resume();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = Array.from(ref.current?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const online = Boolean(presence?.online);
  const canRequestParty = Boolean(presence?.online && presence?.activity?.name);
  const name = friend.nickname || friend.displayName;

  return createPortal(
    <div className="tv-friend-menu-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="tv-friend-menu"
        role="menu"
        aria-label={`Actions for ${name}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="tv-friend-menu-head">
          <FriendAvatar displayName={name} online={online} size="clamp(2.4rem,3vw,3rem)" />
          <div className="tv-friend-menu-name">{name}</div>
        </div>
        {activeParty ? (
          <button type="button" className="tv-friend-menu-item is-accent" onClick={() => { onJoinParty(); onClose(); }}>
            Join party
          </button>
        ) : null}
        {canRequestParty ? (
          <button type="button" className="tv-friend-menu-item is-accent" onClick={() => { onRequestParty(); onClose(); }}>
            Request party
          </button>
        ) : null}
        <button type="button" className="tv-friend-menu-item" onClick={() => { onNickname(); onClose(); }}>
          Nickname
        </button>
        <button type="button" className="tv-friend-menu-item is-danger" onClick={() => { onRemove(); onClose(); }}>
          Remove friend
        </button>
      </div>
    </div>,
    document.body
  );
}

export function TvFriendsRail({ collapsed, isSignedIn, onOpenLogin, onRailFocus }: Props) {
  const { friends, incoming, accept, remove, sendRequest, setNickname } = useFriends();
  const { authKey } = useAuth();
  const navigate = useNavigate();
  const { byHost: activePartiesByHost } = useActiveParties();
  const [view, setView] = useState<'friends' | 'requests'>('friends');
  const [query, setQuery] = useState('');
  const [menuFriend, setMenuFriend] = useState<FriendRecord | null>(null);
  const [nicknameTarget, setNicknameTarget] = useState<FriendRecord | null>(null);
  const { results } = useUserSearch(query);

  const friendIds = useMemo(() => friends.map((f) => f.userId), [friends]);
  const presence = usePresenceLookup(friendIds);
  const friendIdSet = useMemo(() => new Set(friendIds), [friendIds]);

  // Pause the spatial engine while the (native-focus) nickname modal is open so
  // D-pad keys don't drive the rail behind it.
  useEffect(() => {
    if (!nicknameTarget) return;
    pause();
    return () => resume();
  }, [nicknameTarget]);

  const requestParty = async (friend: FriendRecord) => {
    if (!authKey) return;
    try {
      await requestPartyInvite(authKey, friend.userId);
      notifySuccess('Invite sent', `Waiting for ${friend.displayName} to accept.`);
    } catch (err: unknown) {
      notifyWarning('Invite failed', err instanceof Error ? err.message : 'Try again');
    }
  };

  const joinParty = async (party: ActiveParty) => {
    try {
      const url = await buildRoomPlayerUrl({
        code: party.code,
        type: party.type,
        imdbId: party.imdbId,
        videoId: party.videoId,
      });
      navigate(url);
    } catch (err: unknown) {
      notifyWarning('Failed to join party', err instanceof Error ? err.message : 'Try again');
    }
  };

  const sortedFriends = useMemo(
    () =>
      [...friends].sort(
        (a, b) =>
          (presence.get(b.userId)?.online ? 1 : 0) - (presence.get(a.userId)?.online ? 1 : 0)
      ),
    [friends, presence]
  );

  const searching = query.trim().length > 0;

  return (
    <>
      <div className="tv-friends-rail flex min-h-0 flex-1 flex-col">
        <div className="tv-friends-rail-divider" />

        {/* Section header — focusable so it shows a ring + is a landing spot;
            it does not need to "open" anything because the list auto-expands
            below when the rail is open. When signed out, OK prompts login. */}
        <RailRow
          className="bliss-sidebar-link tv-friends-header relative mx-4 flex h-[clamp(60px,4.4vh,76px)] items-center rounded-2xl"
          onRailFocus={onRailFocus}
          onPress={!isSignedIn ? onOpenLogin : undefined}
          ariaLabel="Friends"
        >
          <div className="nav-icon-slot relative z-10 flex h-full shrink-0 items-center justify-center">
            <FriendsIcon className="h-[clamp(1.25rem,1.1vw,2rem)] w-[clamp(1.25rem,1.1vw,2rem)]" />
            {incoming.length > 0 ? (
              <span className="absolute -right-1 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--bliss-accent)] px-1 text-[9px] font-bold leading-none text-black">
                {incoming.length > 99 ? '99+' : incoming.length}
              </span>
            ) : null}
          </div>
          {!collapsed ? <span className="tv-friends-header-label">Friends</span> : null}
        </RailRow>

        {/* Auto-expanded body: only while the rail is open (focused). */}
        {!collapsed ? (
          !isSignedIn ? (
            <div className="tv-friends-rail-body">
              <RailRow
                className="tv-friends-tab is-active w-full"
                onRailFocus={onRailFocus}
                onPress={onOpenLogin}
                ariaLabel="Login to see friends"
              >
                Login to see friends
              </RailRow>
            </div>
          ) : (
            <div className="tv-friends-rail-body flex min-h-0 flex-1 flex-col">
              <RailSearchRow value={query} onChange={setQuery} onRailFocus={onRailFocus} />

              {!searching ? (
                <div className="tv-friends-tabs">
                  <RailRow
                    className={'tv-friends-tab' + (view === 'friends' ? ' is-active' : '')}
                    onRailFocus={onRailFocus}
                    onPress={() => setView('friends')}
                  >
                    Friends{friends.length ? ` ${friends.length}` : ''}
                  </RailRow>
                  <RailRow
                    className={'tv-friends-tab' + (view === 'requests' ? ' is-active' : '')}
                    onRailFocus={onRailFocus}
                    onPress={() => setView('requests')}
                  >
                    Requests{incoming.length ? ` ${incoming.length}` : ''}
                  </RailRow>
                </div>
              ) : null}

              <div className="tv-friends-rail-list flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
                {searching ? (
                  results.filter((u) => !friendIdSet.has(u.id)).length === 0 ? (
                    <div className="tv-friends-rail-empty">No people found.</div>
                  ) : (
                    results
                      .filter((u) => !friendIdSet.has(u.id))
                      .map((u) => (
                        <div key={u.id} className="tv-friends-row">
                          <FriendAvatar displayName={u.displayName} size="clamp(2rem,2.4vw,2.6rem)" />
                          <div className="tv-friends-row-text">
                            <div className="tv-friends-row-name">{u.displayName}</div>
                            {u.username ? <div className="tv-friends-row-status">@{u.username}</div> : null}
                          </div>
                          <RailRow
                            className="tv-friends-btn is-accent"
                            onRailFocus={onRailFocus}
                            onPress={() => {
                              void sendRequest({ toUserId: u.id, toDisplayName: u.displayName }).catch(() => {});
                              setQuery('');
                            }}
                            ariaLabel={`Add ${u.displayName}`}
                          >
                            Add
                          </RailRow>
                        </div>
                      ))
                  )
                ) : view === 'requests' ? (
                  incoming.length === 0 ? (
                    <div className="tv-friends-rail-empty">No requests.</div>
                  ) : (
                    incoming.map((r) => (
                      <div key={r.id} className="tv-friends-row">
                        <FriendAvatar displayName={r.displayName} size="clamp(2rem,2.4vw,2.6rem)" />
                        <div className="tv-friends-row-text">
                          <div className="tv-friends-row-name">{r.displayName}</div>
                          <div className="tv-friends-row-status">wants to be friends</div>
                        </div>
                        <RailRow
                          className="tv-friends-btn is-accent"
                          onRailFocus={onRailFocus}
                          onPress={() => void accept(r.id).catch(() => {})}
                          ariaLabel={`Accept ${r.displayName}`}
                        >
                          ✓
                        </RailRow>
                        <RailRow
                          className="tv-friends-btn"
                          onRailFocus={onRailFocus}
                          onPress={() => void remove(r.id).catch(() => {})}
                          ariaLabel={`Decline ${r.displayName}`}
                        >
                          ✕
                        </RailRow>
                      </div>
                    ))
                  )
                ) : sortedFriends.length === 0 ? (
                  <div className="tv-friends-rail-empty">No friends yet — search to add one.</div>
                ) : (
                  sortedFriends.map((f) => {
                    const p = presence.get(f.userId);
                    return (
                      <RailRow
                        key={f.id}
                        className="tv-friends-row is-friend"
                        onRailFocus={onRailFocus}
                        onPress={() => setMenuFriend(f)}
                        ariaLabel={f.nickname || f.displayName}
                      >
                        <FriendAvatar
                          displayName={f.nickname || f.displayName}
                          size="clamp(2rem,2.4vw,2.6rem)"
                          online={Boolean(p?.online)}
                        />
                        <div className="tv-friends-row-text">
                          <div className="tv-friends-row-name">{f.nickname || f.displayName}</div>
                          <div className="tv-friends-row-status">{statusLine(p)}</div>
                        </div>
                      </RailRow>
                    );
                  })
                )}
              </div>
            </div>
          )
        ) : null}
      </div>

      {menuFriend ? (
        <TvFriendActionsMenu
          friend={menuFriend}
          presence={presence.get(menuFriend.userId)}
          activeParty={activePartiesByHost[menuFriend.userId] ?? null}
          onClose={() => setMenuFriend(null)}
          onRequestParty={() => requestParty(menuFriend)}
          onJoinParty={() => {
            const party = activePartiesByHost[menuFriend.userId];
            if (party) joinParty(party);
          }}
          onNickname={() => setNicknameTarget(menuFriend)}
          onRemove={() => {
            void remove(menuFriend.id).catch(() => {});
          }}
        />
      ) : null}

      <NicknameModal
        friend={nicknameTarget}
        onClose={() => setNicknameTarget(null)}
        onSave={async (next) => {
          if (!nicknameTarget) return;
          await setNickname(nicknameTarget.id, next);
        }}
      />
    </>
  );
}
