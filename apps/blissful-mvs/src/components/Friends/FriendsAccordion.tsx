// Sidebar Friends section. Two internal views:
//   - default:  search field, "Friend requests" button, friend list
//               with online + currently-watching status.
//   - requests: Received / Sent tabs with a back arrow.
//
// Search expands inline into two groups (Friends I have / Everyone on
// Blissful). Clicking any person opens a dropdown menu of actions.
// Direct messaging UI was removed — this accordion is friend-graph
// only.
//
// Layout is pure flex: when `expanded`, the body takes `flex-1
// min-h-0` so the parent (DesktopNav footer) can hand it however
// much vertical room is left. No hardcoded heights anywhere — short
// viewports just see a shorter scroll area.

import { useMemo, useState, type Ref } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useFriends } from '../../context/FriendsProvider';
import { useAuth } from '../../context/AuthProvider';
import { useActiveParties, type ActiveParty } from '../../context/ActivePartiesProvider';
import { useUserSearch, usePresenceLookup } from '../../lib/useSocial';
import { requestPartyInvite } from '../../lib/blissfulAuthApi';
import { buildRoomPlayerUrl } from '../../lib/watchParty';
import { notifySuccess, notifyWarning } from '../../lib/toastQueues';
import { FriendRow } from './FriendRow';
import { PersonActionsRow } from './PersonActionsRow';
import { NicknameModal } from './NicknameModal';
import type { FriendRecord } from '../../lib/friendsApi';

type View = 'default' | 'friend-requests';
type RequestsTab = 'received' | 'sent';

type FriendsAccordionProps = {
  /** Controlled expand state (lifted so the parent sidebar can flip
   *  the surrounding box between `flex-1 min-h-0` and `shrink-0`).
   *  Falls back to internal state if omitted. */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /** Refs the sidebar attaches to the header-chrome wrapper (trigger
   *  + search row) and to the friend list scroll viewport, so the
   *  parent's integer-snap height hook can measure them. */
  chromeRef?: Ref<HTMLDivElement>;
  listRef?: Ref<HTMLDivElement>;
  /** Computed by the sidebar; bounds the inner scroll list to an
   *  exact-fit-N-rows height so no half-row peeks out at the bottom.
   *  null = no constraint (collapsed accordion). */
  listMaxHeight?: number | null;
};

export function FriendsAccordion({
  expanded: controlledExpanded,
  onExpandedChange,
  chromeRef,
  listRef,
  listMaxHeight = null,
}: FriendsAccordionProps = {}) {
  const { authKey } = useAuth();
  const navigate = useNavigate();
  const { friends, incoming, outgoing, accept, remove, sendRequest, setNickname } = useFriends();
  const { byHost: activePartiesByHost } = useActiveParties();

  const onJoinParty = async (party: ActiveParty) => {
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

  const [internalExpanded, setInternalExpanded] = useState(true);
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = (next: boolean) => {
    if (controlledExpanded === undefined) setInternalExpanded(next);
    onExpandedChange?.(next);
  };
  const [view, setView] = useState<View>('default');
  const [requestsTab, setRequestsTab] = useState<RequestsTab>('received');
  const [nicknameTarget, setNicknameTarget] = useState<FriendRecord | null>(null);
  const [query, setQuery] = useState('');

  // Live presence for everyone we render.
  const friendIds = useMemo(() => friends.map((f) => f.userId), [friends]);
  const presenceMap = usePresenceLookup(friendIds);

  // Online friends float to the top of the list; within each bucket
  // we keep server order (so re-sort doesn't jitter when presence
  // updates for a single friend). Stable enough that someone going
  // online during the session just rises to the top of the offline
  // section, not all the way past their friends.
  const sortedFriends = useMemo(() => {
    return [...friends].sort((a, b) => {
      const aOnline = presenceMap.get(a.userId)?.online ? 1 : 0;
      const bOnline = presenceMap.get(b.userId)?.online ? 1 : 0;
      return bOnline - aOnline;
    });
  }, [friends, presenceMap]);

  // Search results.
  const { results: peopleHits } = useUserSearch(query);
  const filteredFriends = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return friends.filter((f) => {
      // `displayName` already collapses to the nickname when one is
      // set; `realName` keeps the original Blissful displayName, so
      // both lookups work — type the nickname OR the real name.
      const haystack = `${f.displayName} ${f.realName ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [friends, query]);

  if (!authKey) return null;

  const isSearching = query.trim().length > 0;
  const showRequestsView = view === 'friend-requests' && !isSearching;
  const showDefaultView = !showRequestsView && !isSearching;

  // Header badge is just the number of pending incoming requests.
  const totalUnseen = incoming.length;
  const headerBadge = totalUnseen > 0 ? (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--bliss-accent)] px-1.5 text-[10px] font-semibold leading-none normal-case tracking-normal text-white">
      {totalUnseen}
    </span>
  ) : null;

  const friendUserIds = new Set(friends.map((f) => f.userId));
  // Local optimistic set of friend-edge ids the user has just clicked
  // "Cancel invite" on. We strip them from the outgoing map so the
  // dropdown updates instantly — without this, a fast second click
  // re-DELETEs an already-gone edge and the server 404s.
  const [recentlyCancelled, setRecentlyCancelled] = useState<Set<string>>(new Set());
  const outgoingByUserId = useMemo(() => {
    const m = new Map<string, string>(); // toUserId → friend edge id
    for (const r of outgoing) {
      if (recentlyCancelled.has(r.id)) continue;
      m.set(r.userId, r.id);
    }
    return m;
  }, [outgoing, recentlyCancelled]);

  return (
    <div className="flex w-full flex-col">
      {/* chromeRef wraps the parts of the accordion that don't scroll:
          the trigger button and (when expanded) the search + Requests
          row. The sidebar's snap-height hook measures this. */}
      <div ref={chromeRef} className="flex shrink-0 flex-col">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full shrink-0 cursor-pointer items-center justify-between gap-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/50 hover:text-foreground/70"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2">
            <span>Friends</span>
            {headerBadge}
          </div>
          {/* Base icon points UP (^). rotate-180 when expanded → down. */}
          <svg
            className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 15 12 9 18 15" />
          </svg>
        </button>
        {expanded && (showDefaultView || isSearching) ? (
          <div className="mt-2 mb-1.5 flex shrink-0 items-center gap-1.5">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="block h-7 min-w-0 flex-1 rounded-full bg-white/10 px-3 text-xs text-white placeholder:text-white/45 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--bliss-accent)]"
            />
            <button
              type="button"
              onClick={() => { setRequestsTab('received'); setView('friend-requests'); }}
              aria-label="Friend requests"
              title="Friend requests"
              className="relative flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-white/10 px-2.5 text-[11px] font-medium text-white hover:bg-white/15"
            >
              <span>Requests</span>
              {incoming.length > 0 ? (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--bliss-accent)] px-1 text-[9px] font-bold leading-none text-black">
                  {incoming.length}
                </span>
              ) : null}
            </button>
          </div>
        ) : null}
      </div>
      {/* Wrapper motion.div animates height with an EXPLICIT numeric
          target for the default-view friend list (= listMaxHeight
          from the snap hook), 'auto' for search/requests subviews
          (those have their own internal sizing).

          Why explicit numbers in default view: 'auto' caused Framer
          Motion to measure the inner list's natural (uncapped) height
          before maxHeight kicked in, leaving empty space inside.
          Dropping `flex min-h-0 shrink` from the wrapper avoids the
          other failure mode where flex-shrink chains let children
          collapse to height 0 mid-animation. */}
      <motion.div
        initial={false}
        animate={{
          // Animation target. Ordering matters:
          //   - collapsed → 0
          //   - search / requests subviews → 'auto' (no snap maxHeight,
          //     their content is small and self-sizes correctly)
          //   - default view + snap-height parent (listRef attached)
          //     but listMaxHeight not computed yet → 0 (wait one render
          //     for the hook). Falling back to 'auto' here briefly
          //     measures the uncapped list height and animates toward
          //     a huge target before the hook snaps it back — that's
          //     the "jump" the user kept seeing in the sidebar.
          //   - default view + snap-height with listMaxHeight → exact
          //     integer-row value.
          //   - default view + NO snap-height parent (mobile drawer,
          //     no listRef) → 'auto'. Without this branch the wrapper
          //     stays at 0 forever in the mobile drawer and the friend
          //     list never appears.
          height: !expanded
            ? 0
            : !showDefaultView
              ? 'auto'
              : listRef === undefined
                ? 'auto'
                : listMaxHeight != null
                  ? listMaxHeight
                  : 0,
          opacity: expanded ? 1 : 0,
        }}
        transition={{ height: { duration: 0.22, ease: 'easeOut' }, opacity: { duration: 0.15 } }}
        style={{ overflow: 'hidden' }}
      >
            {isSearching ? (
              <SearchResults
                query={query}
                friendHits={filteredFriends}
                peopleHits={peopleHits}
                presenceMap={presenceMap}
                friendUserIds={friendUserIds}
                outgoingByUserId={outgoingByUserId}
                onSetNickname={(f) => setNicknameTarget(f)}
                onRemoveFriend={(id) => { void remove(id); }}
                onCancelInvite={(id) => {
                  // Hide the edge optimistically so the dropdown
                  // flips instantly. Swallow a 404 — the server is
                  // just telling us the edge is already gone.
                  setRecentlyCancelled((prev) => {
                    const next = new Set(prev);
                    next.add(id);
                    return next;
                  });
                  void remove(id).catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : '';
                    if (!/not found/i.test(message)) {
                      notifyWarning('Failed to cancel invite', message || 'Try again');
                    }
                  });
                }}
                onAddFriend={async (id, displayName) => {
                  try {
                    const result = await sendRequest({ toUserId: id, toDisplayName: displayName });
                    if (result.accepted) notifySuccess('Friend added', `${displayName} accepted earlier.`);
                    else if (result.already) notifyWarning('Already friends', `You and ${displayName} are already connected.`);
                    else notifySuccess('Request sent', `Waiting for ${displayName} to accept.`);
                  } catch (err: unknown) {
                    notifyWarning('Friend request failed', err instanceof Error ? err.message : 'Try again');
                  }
                }}
              />
            ) : showRequestsView ? (
              <FriendRequestsView
                incoming={incoming}
                outgoing={outgoing}
                tab={requestsTab}
                onTabChange={setRequestsTab}
                onBack={() => setView('default')}
                onAccept={accept}
                onRemove={remove}
              />
            ) : (
              <DefaultView
                friends={sortedFriends}
                presenceMap={presenceMap}
                activePartiesByHost={activePartiesByHost}
                listRef={listRef}
                listMaxHeight={listMaxHeight}
                onSetNickname={(f) => setNicknameTarget(f)}
                onRemove={remove}
                onJoinParty={onJoinParty}
                onRequestParty={async (friend) => {
                  if (!authKey) return;
                  try {
                    await requestPartyInvite(authKey, friend.userId);
                    notifySuccess('Invite sent', `Waiting for ${friend.displayName} to accept.`);
                  } catch (err: unknown) {
                    notifyWarning('Invite failed', err instanceof Error ? err.message : 'Try again');
                  }
                }}
              />
            )}
      </motion.div>
      <NicknameModal
        friend={nicknameTarget}
        onClose={() => setNicknameTarget(null)}
        onSave={async (next) => {
          if (!nicknameTarget) return;
          await setNickname(nicknameTarget.id, next);
        }}
      />
    </div>
  );
}

// ---------- Default view (Friends list) -----------------------------------
// Friend-requests access is rolled into the search row's "Requests"
// pill — this view is just the friend list itself.

type DefaultViewProps = {
  friends: FriendRecord[];
  presenceMap: Map<string, ReturnType<typeof usePresenceLookup> extends Map<string, infer V> ? V : never>;
  activePartiesByHost: Record<string, ActiveParty>;
  onSetNickname: (friend: FriendRecord) => void;
  onRemove: (id: string) => void;
  onRequestParty: (friend: FriendRecord) => void;
  onJoinParty: (party: ActiveParty) => void;
  /** Attached to the scroll viewport so the sidebar's snap-height hook
   *  can walk children and read real per-row heights. */
  listRef?: Ref<HTMLDivElement>;
  /** Hard cap on the scroll viewport; ensures the visible area is an
   *  exact fit of N whole rows (no half-clipped row at the bottom).
   *  null = no cap (let the parent flex compress us). */
  listMaxHeight?: number | null;
};

function DefaultView({
  friends,
  presenceMap,
  activePartiesByHost,
  onSetNickname,
  onRemove,
  onRequestParty,
  onJoinParty,
  listRef,
  listMaxHeight,
}: DefaultViewProps) {
  return (
    // No `flex min-h-0 shrink` wrappers: the parent's animated wrapper
    // is the height authority. Extra flex-shrink chains let rows
    // collapse to 0 mid-animation when the wrapper is height: 0.
    <div
      ref={listRef}
      // snap-y keeps the scroll position aligned with whole rows;
      // maxHeight (from useFooterAccordionHeights) caps the viewport
      // to an exact fit of N whole rows. listRef points HERE so the
      // hook can walk children for real per-row heights.
      className="flex flex-col gap-[clamp(0.375rem,1vh,0.625rem)] snap-y snap-mandatory overflow-auto pr-1 hide-scrollbar"
      style={listMaxHeight != null ? { maxHeight: listMaxHeight } : undefined}
    >
        {friends.length === 0 ? (
          <div className="px-1 py-3 text-sm text-white/60">
            No friends yet. Search above to find someone.
          </div>
        ) : (
          friends.map((f) => {
            const activeParty = activePartiesByHost[f.userId] ?? null;
            return (
              <PersonActionsRow
                key={f.id}
                userId={f.userId}
                displayName={f.displayName}
                friendRecord={f}
                presence={presenceMap.get(f.userId)}
                onSetNickname={() => onSetNickname(f)}
                onRemove={() => onRemove(f.id)}
                onRequestParty={() => onRequestParty(f)}
                hasActiveParty={Boolean(activeParty)}
                onJoinParty={activeParty ? () => onJoinParty(activeParty) : undefined}
              />
            );
          })
        )}
    </div>
  );
}

// ---------- Friend requests view ------------------------------------------

type FriendRequestsViewProps = {
  incoming: FriendRecord[];
  outgoing: FriendRecord[];
  tab: RequestsTab;
  onTabChange: (tab: RequestsTab) => void;
  onBack: () => void;
  onAccept: (id: string) => void;
  onRemove: (id: string) => void;
};

function FriendRequestsView({ incoming, outgoing, tab, onTabChange, onBack, onAccept, onRemove }: FriendRequestsViewProps) {
  const list = tab === 'received' ? incoming : outgoing;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer rounded-full bg-white/10 px-2 py-1 text-sm text-white/80 hover:bg-white/20"
          aria-label="Back"
        >
          ←
        </button>
        <div className="text-sm font-semibold text-white">Friend requests</div>
      </div>
      <div className="flex shrink-0 gap-1 rounded-full bg-white/5 p-1">
        <button
          type="button"
          onClick={() => onTabChange('received')}
          className={
            'flex-1 min-w-0 cursor-pointer rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap truncate transition '
            + (tab === 'received' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10')
          }
        >
          {`Received${incoming.length ? ` (${incoming.length})` : ''}`}
        </button>
        <button
          type="button"
          onClick={() => onTabChange('sent')}
          className={
            'flex-1 min-w-0 cursor-pointer rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap truncate transition '
            + (tab === 'sent' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10')
          }
        >
          {`Sent${outgoing.length ? ` (${outgoing.length})` : ''}`}
        </button>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto pr-1 hide-scrollbar">
        {list.length === 0 ? (
          <div className="px-1 py-1 text-xs text-white/60">
            {tab === 'received' ? 'No incoming requests.' : "You haven't sent any requests."}
          </div>
        ) : (
          list.map((r) => (
            <FriendRow
              key={r.id}
              record={r}
              onAccept={onAccept}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------- Search results view -------------------------------------------

type SearchResultsProps = {
  query: string;
  friendHits: FriendRecord[];
  peopleHits: ReturnType<typeof useUserSearch>['results'];
  presenceMap: Map<string, ReturnType<typeof usePresenceLookup> extends Map<string, infer V> ? V : never>;
  friendUserIds: Set<string>;
  /** Map of `recipientUserId → friend-edge id` for outgoing pending
   *  requests. Lets us flip Add → Cancel invite per row. */
  outgoingByUserId: Map<string, string>;
  onSetNickname: (friend: FriendRecord) => void;
  onRemoveFriend: (id: string) => void;
  onAddFriend: (userId: string, displayName: string) => void;
  onCancelInvite: (id: string) => void;
};

function SearchResults({
  query,
  friendHits,
  peopleHits,
  presenceMap,
  friendUserIds,
  outgoingByUserId,
  onSetNickname,
  onRemoveFriend,
  onAddFriend,
  onCancelInvite,
}: SearchResultsProps) {
  const nothing = friendHits.length === 0 && peopleHits.length === 0;
  return (
    <div className="flex max-h-[420px] flex-col gap-3 overflow-auto pr-1 hide-scrollbar">
      <Group title="Friends">
        {friendHits.length === 0 ? (
          <div className="px-1 text-xs text-white/45">No matches.</div>
        ) : (
          friendHits.map((f) => (
            <PersonActionsRow
              key={f.id}
              userId={f.userId}
              displayName={f.displayName}
              friendRecord={f}
              presence={presenceMap.get(f.userId)}
              onSetNickname={() => onSetNickname(f)}
              onRemove={() => onRemoveFriend(f.id)}
            />
          ))
        )}
      </Group>

      <Group title="Everyone on Blissful">
        {peopleHits.length === 0 ? (
          <div className="px-1 text-xs text-white/45">No people matching.</div>
        ) : (
          peopleHits.map((p) => {
            const alreadyFriend = friendUserIds.has(p.id);
            const pendingId = outgoingByUserId.get(p.id);
            return (
              <PersonActionsRow
                key={p.id}
                userId={p.id}
                displayName={p.displayName}
                presence={presenceMap.get(p.id)}
                subtitle={alreadyFriend ? { kind: 'status', presence: presenceMap.get(p.id) } : { kind: 'text', text: p.username ? `@${p.username}` : '' }}
                pendingOutgoingId={!alreadyFriend && pendingId ? pendingId : undefined}
                onAddFriend={alreadyFriend || pendingId ? undefined : () => onAddFriend(p.id, p.displayName)}
                onCancelInvite={onCancelInvite}
              />
            );
          })
        )}
      </Group>

      {nothing ? (
        <div className="px-1 py-2 text-center text-xs text-white/40">
          Nothing matched &ldquo;{query}&rdquo;.
        </div>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-white/45">
        {title}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}
