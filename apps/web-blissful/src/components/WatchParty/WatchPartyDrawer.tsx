// Watch-party drawer — slides in from the right edge of the player,
// matching the SettingsPanel layout (floating tab row + content card).
//
// Three views, picked automatically based on `roomCode`:
//   1. roomCode == null & tab='open'  — Open Room (public / password)
//   2. roomCode == null & tab='join'  — Join Room (code + password)
//   3. roomCode != null               — Active Room dashboard
//                                       (code, participants, chat, leave)
//
// All watch-party UX in the player flows through this single
// component — the chip dropdown / popover menu / standalone modals
// the old design used are subsumed here.

import { AnimatePresence, motion } from 'framer-motion';
import { Label } from '@heroui/react';
import { BlissButton, BlissDropdown, BlissTabs } from '../base';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StremioIcon, type StremioIconName } from '../PlayerControlIcons';
import { useFriends } from '../../context/FriendsProvider';
import { notifySuccess, notifyWarning } from '../../lib/toastQueues';
import {
  formatRoomCodeInput,
  getWatchPartyRoom,
  isValidRoomCode,
  ROOM_CODE_LENGTH,
  stashWatchPartyPassword,
  verifyWatchPartyPassword,
  type WatchPartyChatMessage,
  type WatchPartyParticipant,
  type WatchPartyRoomInfo,
} from '../../lib/watchParty';
import type { ReactionMap, WatchPartyActivity } from '../../lib/useWatchParty';
import { EmojiPicker } from './EmojiPicker';

export type WatchPartyDrawerTab = 'open' | 'join';

export type WatchPartyDrawerProps = {
  open: boolean;
  onClose: () => void;

  tab: WatchPartyDrawerTab;
  onTabChange: (t: WatchPartyDrawerTab) => void;

  // ---- Active-room data (rendered when roomCode != null) -----------------
  roomCode: string | null;
  connected: boolean;
  selfUserId: string | null;
  hostUserId: string | null;
  participants: WatchPartyParticipant[];
  chat: WatchPartyChatMessage[];
  sendChat: (text: string) => void;
  /** Debounced typing ping — fire from the chat input's onChange. */
  sendTyping: () => void;
  /** Other participants currently typing (already filters out self). */
  typingNames: string[];
  /** Rolling activity feed — pause/play/seek + join/leave. The chat
   *  tab folds the presence entries in as system messages. */
  activity: WatchPartyActivity[];
  /** Per-message emoji reactions. Map<messageKey, Map<emoji,
   *  userIds[]>>; messageKey = `${from.userId}-${at}` matching the
   *  chat bubble key. */
  reactions: ReactionMap;
  toggleReaction: (messageKey: string, emoji: string) => void;
  /** Active-room sub-tab (controlled by parent so it knows when the
   *  chat is visible — drives the unread-badge clear). */
  activeRoomTab: 'people' | 'chat';
  onActiveRoomTabChange: (tab: 'people' | 'chat') => void;
  hasPassword: boolean;
  error: string | null;
  onLeave: () => void;
  /** Host-only: transfer host status to a participant. */
  onTransferHost: (targetUserId: string) => void;
  /** Layer B (guest): ask the host to relay its exact stream so we watch the
   *  same file frame-aligned (Vidking guests drift; this fixes it). Undefined →
   *  the button is hidden (e.g. shown only to guests, never the host). */
  onRequestHostStream?: () => void;

  // ---- Create flow (no-room → Open Room tab) -----------------------------
  /** Whether the user *can* create a room — false when there's no auth
   *  key / type / id (e.g. straight after deep-link without context). */
  canCreate: boolean;
  creatingRoom: boolean;
  /** Parent runs the POST; receives optional password (null = public). */
  onCreateRoom: (password: string | null) => Promise<void> | void;

  // ---- Join flow (no-room → Join Room tab) -------------------------------
  /** Parent handles the navigation once code (+ optional password) is
   *  verified. The drawer takes care of lookup + verify. May be async
   *  (e.g. for a meta fetch before the navigate) — the drawer awaits
   *  it so the button stays in pending state until navigation kicks. */
  onNavigateToRoom: (room: WatchPartyRoomInfo) => void | Promise<void>;
};

// ---------- Avatar helpers (also used by the People / Chat tabs) -----------

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function avatarBg(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  const palette = [
    '#7c3aed', '#0891b2', '#16a34a', '#d97706',
    '#dc2626', '#db2777', '#0284c7', '#65a30d',
  ];
  return palette[h % palette.length]!;
}

function formatChatTime(at: number): string {
  const d = new Date(at);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ---------- Drawer ---------------------------------------------------------

export function WatchPartyDrawer(props: WatchPartyDrawerProps) {
  const inRoom = props.roomCode != null;
  return (
    <AnimatePresence>
      {props.open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-40 flex items-start justify-end gap-3 bg-black/90 p-4 pb-24 md:bg-black/30 md:px-8 md:pb-28 md:pt-28 [@media(max-height:520px)]:!p-2"
          onClick={props.onClose}
        >
          {/* On short-height (landscape phone) screens, scale the drawer down so
              the participants/chat fit without the giant md: padding squishing
              it — matches the settings + episodes drawers. */}
          <motion.div
            initial={{ x: 'calc(100% + 2rem)', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 'calc(100% + 2rem)', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 32, mass: 0.85 }}
            className="pointer-events-auto flex max-h-full w-[80%] flex-col gap-3 md:w-[420px] [@media(max-height:520px)]:gap-1.5 [@media(max-height:520px)]:[zoom:0.8] [@media(max-height:400px)]:[zoom:0.7]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top row: tabs (only when no room) + close button */}
            <div className="pointer-events-auto flex items-center justify-end gap-2">
              {!inRoom ? (
                <BlissTabs
                  // Distinct `key` from the in-room Tabs forces React
                  // (and HeroUI's React Aria machinery) to mount a
                  // fresh component when the user transitions
                  // lobby→active-room — reusing the same instance
                  // would trigger "Cannot change the id of an item"
                  // because the Tab.Tab ids differ between the two
                  // states.
                  key="watch-party-lobby"
                  selectedKey={props.tab}
                  onSelectionChange={(k) => props.onTabChange(k as WatchPartyDrawerTab)}
                >
                  <BlissTabs.ListContainer>
                    <BlissTabs.List aria-label="Watch party">
                      <BlissTabs.Tab id="open" className="whitespace-nowrap">
                        Open Room
                        <BlissTabs.Indicator />
                      </BlissTabs.Tab>
                      <BlissTabs.Tab id="join" className="whitespace-nowrap">
                        Join Room
                        <BlissTabs.Indicator />
                      </BlissTabs.Tab>
                    </BlissTabs.List>
                  </BlissTabs.ListContainer>
                </BlissTabs>
              ) : (
                // In-room: People / Chat as a floating tab pill,
                // matching the SettingsPanel + no-room state layout.
                <BlissTabs
                  key="watch-party-active"
                  selectedKey={props.activeRoomTab}
                  onSelectionChange={(k) => props.onActiveRoomTabChange(k as 'people' | 'chat')}
                >
                  <BlissTabs.ListContainer>
                    <BlissTabs.List aria-label="Watch party">
                      <BlissTabs.Tab id="people" className="whitespace-nowrap">
                        People
                        <BlissTabs.Indicator />
                      </BlissTabs.Tab>
                      <BlissTabs.Tab id="chat" className="whitespace-nowrap">
                        Chat
                        <BlissTabs.Indicator />
                      </BlissTabs.Tab>
                    </BlissTabs.List>
                  </BlissTabs.ListContainer>
                </BlissTabs>
              )}
              <button
                type="button"
                className="pointer-events-auto flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
                onClick={props.onClose}
                aria-label="Close"
              >
                <StremioIcon name={'x' as StremioIconName} className="h-4 w-4" />
              </button>
            </div>

            {/* Content card — view body is wrapped in AnimatePresence
                so the transition from Open/Join → Active Room (when
                the room is created, or when a guest navigates in)
                cross-fades + slides instead of popping in. Without
                this the moment the URL gained `?room=` the active-
                room view appeared instantly, which read as a flash. */}
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#101116]/95 shadow-2xl backdrop-blur-md">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={inRoom ? 'active' : `lobby-${props.tab}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  {inRoom ? (
                    <ActiveRoomView {...props} />
                  ) : props.tab === 'open' ? (
                    <OpenRoomView
                      canCreate={props.canCreate}
                      creatingRoom={props.creatingRoom}
                      onCreateRoom={props.onCreateRoom}
                    />
                  ) : (
                    <JoinRoomView onNavigateToRoom={props.onNavigateToRoom} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------- Open Room view -------------------------------------------------

type OpenRoomViewProps = Pick<WatchPartyDrawerProps, 'canCreate' | 'creatingRoom' | 'onCreateRoom'>;

function OpenRoomView({ canCreate, creatingRoom, onCreateRoom }: OpenRoomViewProps) {
  // Two-card layout: public vs password-protected. Picking the
  // password card expands a password input inline so the user can
  // submit in one place — no nested modal.
  const [mode, setMode] = useState<'public' | 'password'>('public');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pwInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mode === 'password') {
      window.setTimeout(() => pwInputRef.current?.focus(), 50);
    } else {
      setPassword('');
    }
    setError(null);
  }, [mode]);

  const handleSubmit = async () => {
    if (!canCreate || creatingRoom) return;
    if (mode === 'password' && !password.trim()) {
      setError('Enter a password');
      return;
    }
    try {
      await onCreateRoom(mode === 'password' ? password.trim() : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="text-sm font-semibold text-white">Open a watch party</div>
      <div className="text-xs text-white/55">
        Pick public for anyone with the code, or password-protected so only people
        you share the password with can join.
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setMode('public')}
          className={
            'flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ' +
            (mode === 'public'
              ? 'border-[var(--bliss-accent)]/60 bg-[var(--bliss-accent)]/10 text-white'
              : 'border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/10')
          }
        >
          <span className="text-lg" aria-hidden>🎬</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Public room</span>
            <span className="block text-xs text-white/55">
              Anyone with the code or invite link can join.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMode('password')}
          className={
            'flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ' +
            (mode === 'password'
              ? 'border-[var(--bliss-accent)]/60 bg-[var(--bliss-accent)]/10 text-white'
              : 'border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/10')
          }
        >
          <span className="text-lg" aria-hidden>🔒</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Password-protected room</span>
            <span className="block text-xs text-white/55">
              Set a password and share it with the people you invite.
            </span>
          </span>
        </button>
      </div>

      {mode === 'password' ? (
        <div className="mt-1 flex flex-col gap-2">
          <input
            ref={pwInputRef}
            // Plain text input on the create flow — the host is the
            // one picking the password and needs to read what they
            // typed before sharing it. `data-*-ignore` attrs +
            // autoComplete=off keep Bitwarden / 1Password / LastPass
            // popovers from offering to autofill credentials over
            // this field (it's a room code, not a login).
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
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-[var(--bliss-accent)] focus:outline-none"
          />
        </div>
      ) : null}

      {error ? <div className="text-xs text-red-400">{error}</div> : null}
      {!canCreate ? (
        <div className="text-xs text-white/55">
          Log in and start playing something to open a room.
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canCreate || creatingRoom || (mode === 'password' && !password.trim())}
        data-testid="wp-create-submit"
        className="mt-auto rounded-full bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
      >
        {creatingRoom ? 'Starting…' : mode === 'password' ? 'Create password room' : 'Create public room'}
      </button>
    </div>
  );
}

// ---------- Join Room view -------------------------------------------------

type JoinStep = { kind: 'code' } | { kind: 'password'; room: WatchPartyRoomInfo };

type JoinRoomViewProps = Pick<WatchPartyDrawerProps, 'onNavigateToRoom'>;

function JoinRoomView({ onNavigateToRoom }: JoinRoomViewProps) {
  const [step, setStep] = useState<JoinStep>({ kind: 'code' });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const pwRef = useRef<HTMLInputElement | null>(null);

  // Autofocus code input on mount, password on step change.
  useEffect(() => {
    window.setTimeout(() => codeRef.current?.focus(), 60);
  }, []);
  useEffect(() => {
    if (step.kind === 'password') {
      window.setTimeout(() => pwRef.current?.focus(), 50);
    }
  }, [step.kind]);

  const handleCodeSubmit = async () => {
    if (!isValidRoomCode(code)) {
      setError('Enter the full 6-character code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const room = await getWatchPartyRoom(code);
      if (!room) {
        setError('Room not found. Double-check the code.');
        setBusy(false);
        return;
      }
      if (room.hasPassword) {
        setStep({ kind: 'password', room });
        setBusy(false);
        return;
      }
      await onNavigateToRoom(room);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to look up room');
      setBusy(false);
    }
  };

  const handlePasswordSubmit = async () => {
    if (step.kind !== 'password') return;
    if (!password.trim()) {
      setError('Enter the password');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await verifyWatchPartyPassword(step.room.code, password.trim());
    if (result === 'ok') {
      stashWatchPartyPassword(step.room.code, password.trim());
      await onNavigateToRoom(step.room);
      return;
    }
    if (result === 'wrong-password') setError('Incorrect password');
    else if (result === 'no-room') setError('Room expired or was closed');
    else setError('Failed to verify password');
    setBusy(false);
  };

  if (step.kind === 'code') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) handleCodeSubmit();
        }}
        className="flex flex-1 flex-col gap-3 p-4"
      >
        <div className="text-sm font-semibold text-white">Join a watch party</div>
        <div className="text-xs text-white/55">
          Paste the code your friend shared.
        </div>
        <input
          ref={codeRef}
          type="text"
          value={code}
          onChange={(e) => {
            setCode(formatRoomCodeInput(e.target.value));
            if (error) setError(null);
          }}
          placeholder="xxx-yyy"
          maxLength={ROOM_CODE_LENGTH}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="wp-join-code"
          className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center font-mono text-2xl tracking-[0.35em] uppercase text-white placeholder:text-white/30 focus:border-[var(--bliss-accent)] focus:outline-none"
        />
        {error ? <div className="text-xs text-red-400">{error}</div> : null}
        <button
          type="submit"
          disabled={busy || !isValidRoomCode(code)}
          data-testid="wp-join-continue"
          className="mt-auto rounded-full bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
        >
          {busy ? 'Looking up…' : 'Continue'}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) handlePasswordSubmit();
      }}
      className="flex flex-1 flex-col gap-3 p-4"
    >
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold text-white">Password required</div>
        <button
          type="button"
          className="text-[11px] font-semibold text-white/60 hover:text-white"
          onClick={() => {
            setStep({ kind: 'code' });
            setPassword('');
            setError(null);
          }}
        >
          Back
        </button>
      </div>
      <div className="text-xs text-white/55">
        Room <span className="font-mono uppercase tracking-wider text-white/85">{step.room.code}</span> is password-protected.
      </div>
      {/* Plain `type="text"` field — a watch-party password is a
          shared room access code, not an account credential. Using
          `type="password"` triggers Bitwarden / 1Password / LastPass
          popovers that try to autofill saved logins, which is the
          opposite of what we want. The vendor `data-*-ignore` attrs
          + `autoComplete="off"` belt-and-suspender against any
          remaining heuristic detection. */}
      <input
        ref={pwRef}
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
        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-[var(--bliss-accent)] focus:outline-none"
      />
      {error ? <div className="text-xs text-red-400">{error}</div> : null}
      <button
        type="submit"
        disabled={busy || !password.trim()}
        className="mt-auto rounded-full bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
      >
        {busy ? 'Verifying…' : 'Join'}
      </button>
    </form>
  );
}

// ---------- Active Room view ----------------------------------------------

type ChatTimelineItem = {
  key: string;
  /** Server-friendly identity for reactions (`userId-at`). */
  messageKey: string;
  mine: boolean;
  from: { displayName: string };
  text: string;
  at: number;
};

function ActiveRoomView(props: WatchPartyDrawerProps) {
  const {
    roomCode,
    connected,
    selfUserId,
    hostUserId,
    participants,
    chat,
    sendChat,
    sendTyping,
    typingNames,
    reactions,
    toggleReaction,
    activeRoomTab: subTab,
    // Tab switching is now driven from the floating top-row tabs;
    // ActiveRoomView only consumes the current value.
    hasPassword,
    error,
    onLeave,
    onTransferHost,
    onRequestHostStream,
  } = props;
  // Layer B: transient "asked the host" state for the request button.
  const [hostStreamAsked, setHostStreamAsked] = useState(false);
  useEffect(() => {
    if (!hostStreamAsked) return;
    const id = window.setTimeout(() => setHostStreamAsked(false), 8000);
    return () => window.clearTimeout(id);
  }, [hostStreamAsked]);
  const { friends, outgoing, sendRequest } = useFriends();
  const friendUserIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of friends) set.add(f.userId);
    for (const o of outgoing) set.add(o.userId);
    return set;
  }, [friends, outgoing]);
  const isViewerHost = selfUserId != null && hostUserId === selfUserId;
  // Popovers for the emoji button next to the input ('input') and
  // the per-message reaction trigger (messageKey of the open one).
  const [emojiPickerFor, setEmojiPickerFor] = useState<'input' | string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [draft, setDraft] = useState('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Chat tab is user-messages-only — presence events (joined / left /
  // host-changed) surface in the in-player activity toast instead so
  // the chat panel stays focused on conversation.
  const timeline = useMemo<ChatTimelineItem[]>(() => {
    const out: ChatTimelineItem[] = [];
    for (const m of chat) {
      // messageKey matches what the server / reaction relay uses:
      // `${userId}-${at}` is unique per message (a single user can
      // send two messages at the same ms only if they're spamming
      // faster than Date.now() resolution).
      const messageKey = `${m.from.userId}-${m.at}`;
      out.push({
        key: `m-${messageKey}`,
        messageKey,
        mine: m.from.userId === selfUserId,
        from: { displayName: m.from.displayName },
        text: m.text,
        at: m.at,
      });
    }
    return out;
  }, [chat, selfUserId]);

  useEffect(() => {
    if (subTab !== 'chat') return;
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline, subTab, typingNames]);

  const handleCopy = async (kind: 'code' | 'link') => {
    if (!roomCode) return;
    // Codes are displayed uppercase everywhere — copy the uppercase
    // form too so what hits the clipboard matches what the user
    // sees. The Join modal's `formatRoomCodeInput` always lowercases
    // on paste back, so the server (which keys rooms lowercase)
    // still resolves correctly.
    //
    // Invite link points to /invite/<code> — a short, readable URL
    // that opens a landing page (poster, title, episode, Continue).
    // The Continue click is the user gesture autoplay needs.
    // Invite-link host. Prod: window.location.origin already IS the public host.
    // Dev: point at the dev WEB server (localhost:<vite port>) so a copied link
    // opens YOUR dev guest — not prod, and not the desktop shell's loopback port
    // (5175, which can't upgrade the watch-party WebSocket). Same-machine dev
    // testing only; for sharing to another device use the code, or prod.
    const inviteOrigin = import.meta.env.DEV
      ? `http://localhost:${import.meta.env.VITE_DEV_PORT || 5173}`
      : window.location.origin;
    const text =
      kind === 'code'
        ? roomCode.toUpperCase()
        : `${inviteOrigin}/invite/${roomCode}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      window.prompt(`Copy this ${kind}:`, text);
    }
  };

  const handleSendChat = () => {
    const text = draft.trim();
    if (!text) return;
    sendChat(text);
    setDraft('');
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* People / Chat sub-tabs live on the floating top row of the
          drawer (matches the Settings panel's Quality/Subtitles/
          Servers layout), so the content card itself starts straight
          with the tab body. */}
      {subTab === 'people' ? (
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {participants.length === 0 ? (
            <div className="text-xs text-white/50">No participants yet</div>
          ) : (
            participants.map((p) => {
              const isSelf = p.userId === selfUserId;
              const isParticipantHost = p.userId === hostUserId;
              const isParticipantGuest = p.userId.startsWith('guest:');
              const canMakeHost = !isSelf && isViewerHost && !isParticipantHost;
              const alreadyFriend = friendUserIds.has(p.userId);
              // Friend requests need a real Stremio account on the receiving
              // side (guests have no inbox). The viewer's own auth state is
              // checked at click-time so guests get a helpful error rather
              // than being silently hidden from the option.
              const canAddFriend = !isSelf && !isParticipantGuest && !alreadyFriend;
              const hasMenu = canMakeHost || canAddFriend;
              const rowInner = (
                <>
                  <div
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold leading-none text-white"
                    style={{ backgroundColor: avatarBg(p.userId) }}
                  >
                    {initials(p.displayName)}
                  </div>
                  <div className="min-w-0 flex-1 truncate text-sm">
                    {p.displayName}
                    {isSelf ? <span className="ml-1 text-white/40">(you)</span> : null}
                  </div>
                  {isParticipantHost ? (
                    <span className="rounded-full bg-[var(--bliss-accent)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--bliss-accent)]">
                      Host
                    </span>
                  ) : null}
                </>
              );
              if (!hasMenu) {
                return (
                  <div key={p.userId} className="flex items-center gap-2 px-1 py-1">
                    {rowInner}
                  </div>
                );
              }
              return (
                <BlissDropdown key={p.userId}>
                  <BlissButton
                    variant="ghost"
                    className="w-full justify-start gap-2 rounded-lg bg-transparent px-1 py-1 text-left hover:bg-white/5"
                  >
                    {rowInner}
                  </BlissButton>
                  <BlissDropdown.Popover className="min-w-[200px] border border-white/10 bg-[#101116]/95 p-2 shadow-2xl backdrop-blur-md">
                    <BlissDropdown.Menu
                      onAction={async (key) => {
                        const action = String(key);
                        if (action === 'make-host') {
                          onTransferHost(p.userId);
                          return;
                        }
                        if (action === 'add-friend') {
                          try {
                            const result = await sendRequest({ toUserId: p.userId, toDisplayName: p.displayName });
                            if (result.accepted) {
                              notifySuccess('Friend added', `${p.displayName} accepted your earlier request.`);
                            } else if (result.already) {
                              notifyWarning('Already friends', `You and ${p.displayName} are already connected.`);
                            } else {
                              notifySuccess('Request sent', `Waiting for ${p.displayName} to accept.`);
                            }
                          } catch (err: unknown) {
                            const message = err instanceof Error ? err.message : 'Failed to send request';
                            notifyWarning('Friend request failed', message);
                          }
                        }
                      }}
                    >
                      {canMakeHost ? (
                        <BlissDropdown.Item id="make-host" textValue="Make host" className="px-3 py-2 text-sm hover:bg-white/10 data-[hovered=true]:bg-white/10">
                          <Label>Make host</Label>
                        </BlissDropdown.Item>
                      ) : null}
                      {canAddFriend ? (
                        <BlissDropdown.Item id="add-friend" textValue="Add as friend" className="px-3 py-2 text-sm hover:bg-white/10 data-[hovered=true]:bg-white/10">
                          <Label>Add as friend</Label>
                        </BlissDropdown.Item>
                      ) : null}
                    </BlissDropdown.Menu>
                  </BlissDropdown.Popover>
                </BlissDropdown>
              );
            })
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            ref={chatScrollRef}
            // `min-h-[18rem]` keeps the chat panel visually
            // substantial even when there are zero messages — the
            // empty state used to render as a single tiny line, now
            // it gets real breathing room. With messages, flex-1
            // still takes whatever vertical space is available.
            className="min-h-[18rem] flex-1 space-y-2 overflow-y-auto px-4 py-3"
          >
            {timeline.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <div className="text-4xl" aria-hidden>💬</div>
                <div className="text-sm font-semibold text-white/70">No messages yet</div>
                <div className="text-xs text-white/45">Say hi 👋</div>
              </div>
            ) : (
              timeline.map((item) => {
                const messageReactions = reactions[item.messageKey];
                const reactionEntries: [string, string[]][] = messageReactions
                  ? Object.entries(messageReactions)
                  : [];
                const reactionOpen = emojiPickerFor === item.messageKey;
                return (
                  <div
                    key={item.key}
                    className={'group/msg flex flex-col ' + (item.mine ? 'items-end' : 'items-start')}
                  >
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-white/40">
                      {item.mine ? 'You' : item.from.displayName} · {formatChatTime(item.at)}
                    </div>
                    <div className={'relative flex max-w-[85%] items-center gap-1 ' + (item.mine ? 'flex-row-reverse' : 'flex-row')}>
                      <div
                        className={
                          'rounded-2xl px-3 py-1.5 text-xs leading-snug ' +
                          (item.mine
                            ? 'bg-[var(--bliss-accent)]/85 text-black'
                            : 'bg-white/10 text-white')
                        }
                      >
                        {item.text}
                      </div>
                      {/* React trigger — visible on hover (desktop)
                          and always on touch (where there's no
                          hover). Tap opens the emoji picker anchored
                          above-left for 'mine' messages (right side
                          of the row) and above-right otherwise. */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setEmojiPickerFor(reactionOpen ? null : item.messageKey)}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-xs text-white/60 opacity-0 transition hover:bg-black/70 hover:text-white group-hover/msg:opacity-100 sm:group-hover/msg:opacity-100"
                          aria-label="React"
                          title="React"
                        >
                          +
                        </button>
                        <EmojiPicker
                          open={reactionOpen}
                          onClose={() => setEmojiPickerFor((curr) => (curr === item.messageKey ? null : curr))}
                          onPick={(emoji) => toggleReaction(item.messageKey, emoji)}
                          // Picker prefers above the bubble; it
                          // auto-flips to below when the message
                          // is near the top of the chat scroll
                          // container (so it doesn't get clipped).
                          align={item.mine ? 'right' : 'left'}
                          side="above"
                        />
                      </div>
                    </div>
                    {reactionEntries.length > 0 ? (
                      <div
                        className={
                          'mt-1 flex flex-wrap gap-1 ' + (item.mine ? 'justify-end' : 'justify-start')
                        }
                      >
                        {reactionEntries.map(([emoji, userIds]) => {
                          const mine = selfUserId != null && userIds.includes(selfUserId);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleReaction(item.messageKey, emoji)}
                              className={
                                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition ' +
                                (mine
                                  ? 'border border-[var(--bliss-accent)]/60 bg-[var(--bliss-accent)]/15 text-white'
                                  : 'border border-white/15 bg-white/5 text-white/80 hover:bg-white/10')
                              }
                              aria-pressed={mine}
                              title={`${userIds.length} ${userIds.length === 1 ? 'reaction' : 'reactions'}`}
                            >
                              <span aria-hidden>{emoji}</span>
                              <span className="font-medium">{userIds.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
            {/* "X is typing…" indicator. Hides when nobody is
                actively typing — keeps the chat box visually quiet
                during silence. */}
            {typingNames.length > 0 ? (
              <div className="flex items-center gap-2 text-[11px] italic text-white/55">
                <span className="flex gap-0.5" aria-hidden>
                  <span className="h-1 w-1 animate-pulse rounded-full bg-white/70" />
                  <span className="h-1 w-1 animate-pulse rounded-full bg-white/70 [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-pulse rounded-full bg-white/70 [animation-delay:300ms]" />
                </span>
                <span>
                  {typingNames.length === 1
                    ? `${typingNames[0]} is typing…`
                    : typingNames.length === 2
                      ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                      : `${typingNames.length} people are typing…`}
                </span>
              </div>
            ) : null}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendChat();
            }}
            className="flex items-center gap-2 border-t border-white/5 bg-white/[0.03] px-3 py-2"
          >
            {/* Emoji insert button — popover with the curated emoji
                set. Picked emoji gets appended to the draft and the
                input keeps focus. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setEmojiPickerFor(emojiPickerFor === 'input' ? null : 'input')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-base text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="Insert emoji"
                title="Insert emoji"
              >
                😀
              </button>
              <EmojiPicker
                open={emojiPickerFor === 'input'}
                onClose={() => setEmojiPickerFor((curr) => (curr === 'input' ? null : curr))}
                onPick={(emoji) => {
                  setDraft((prev) => prev + emoji);
                  // Refocus the input so the user can keep typing
                  // immediately after picking.
                  window.setTimeout(() => inputRef.current?.focus(), 0);
                }}
                align="left"
                side="above"
              />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                // Fire a typing ping on each keystroke; the hook
                // internally debounces so the wire only sees one
                // every ~2.5s.
                if (e.target.value.trim()) sendTyping();
              }}
              placeholder="Type a message…"
              maxLength={500}
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-[var(--bliss-accent)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="rounded-full bg-[var(--bliss-accent)] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* Room footer — code as the headline, Copy code / Copy link
          buttons under it, Leave party at the very bottom. People
          tab only: the Chat tab is conversation-focused so the
          footer would steal vertical room from the message list +
          input. Users who want to copy / leave switch to People. */}
      {subTab === 'people' ? (
        <div className="border-t border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="flex items-baseline justify-between">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Room code</div>
            <div className="text-[11px] text-white/55" data-testid="wp-connection-status">
              {error
                ? <span className="text-red-400">{error}</span>
                : connected
                  ? 'Connected'
                  : 'Connecting…'}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono text-2xl font-bold uppercase tracking-widest text-[var(--bliss-accent)]">
            <span data-testid="wp-room-code">{roomCode}</span>
            {hasPassword ? (
              <span className="text-base text-white/70" title="Password protected" aria-label="Password protected">🔒</span>
            ) : null}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => handleCopy('code')}
              className="flex-1 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
            >
              {copied === 'code' ? 'Copied!' : 'Copy code'}
            </button>
            <button
              type="button"
              onClick={() => handleCopy('link')}
              className="flex-1 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
            >
              {copied === 'link' ? 'Copied!' : 'Copy link'}
            </button>
          </div>
          {!isViewerHost && onRequestHostStream ? (
            <button
              type="button"
              onClick={() => {
                onRequestHostStream();
                setHostStreamAsked(true);
              }}
              disabled={!connected || hostStreamAsked}
              title="Watch the host's exact stream, frame-aligned (best sync). The host has to approve."
              className="mt-3 w-full rounded-full border border-[var(--bliss-accent)]/30 bg-[var(--bliss-accent)]/15 px-3 py-1.5 text-xs font-semibold text-[var(--bliss-accent)] hover:bg-[var(--bliss-accent)]/25 disabled:opacity-50"
            >
              {hostStreamAsked ? 'Asked host — waiting…' : "Ask for host's stream"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onLeave}
            data-testid="wp-leave"
            className="mt-3 w-full rounded-full border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/25"
          >
            Leave party
          </button>
        </div>
      ) : null}
    </div>
  );
}
