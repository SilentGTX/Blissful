// useWatchParty — React hook that connects to a watch-party room over
// WebSocket and keeps an HTMLVideoElement in lock-step with the host's
// timeline.
//
// Roles:
//   - Host: attaches `play`/`pause`/`seeked` listeners on the video and
//     broadcasts them; sends a 1Hz `host:tick` while connected so guests
//     can correct drift.
//   - Guest: receives `event` / `tick` messages and applies them to its
//     own video. Drift > 1.5s snaps to the host's time. No broadcast.
//
// Echo suppression: guests don't broadcast at all, so there's no loop —
// applying a remote action triggers the video's normal event chain, which
// updates the player's React state but doesn't send anything back.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  watchPartyWsUrl,
  type WatchPartyChatMessage,
  type WatchPartyClientMessage,
  type WatchPartyParticipant,
  type WatchPartyServerMessage,
  type WatchPartySource,
} from './watchParty';

export type UseWatchPartyOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Room code from the URL or the create-room response. Null disables. */
  roomCode: string | null;
  /** Blissful JWT for signed-in users. Provide this OR `guestId` —
   *  at least one is required for the server to grant join. */
  authToken: string | null;
  /** Stable per-device id for guest viewers. Used by the server as
   *  the participant identity when `authToken` is null. */
  guestId?: string | null;
  /** Public display name shown to other participants. */
  displayName: string;
  /** Password for password-protected rooms. Leave null/empty for open
   *  rooms; if the server says the room needs a password and none is
   *  provided, the hook surfaces `error: 'password required'` and
   *  stops reconnecting. */
  password?: string | null;
  /** Callback fired on guests when the host changes the current episode. */
  onHostEpisodeChange?: (videoId: string | null) => void;
  /** Callback fired on guests when the host's Real-Debrid fallback URL changes
   *  (set when the host falls back to RD, null when back on Vidking) — the guest
   *  loads the same torrent. Also fired on join with the room's current value. */
  onHostStreamChange?: (streamUrl: string | null) => void;
  /** Callback fired on guests when the host changes subtitle language (or null =
   *  off) so they match it. Also fired on join with the room's current value. */
  onHostSubsChange?: (lang: string | null) => void;
  /** Callback fired on guests when the host announces the room's content
   *  `source` (Watch Party v2 same-file sync) so the guest can resolve the
   *  SAME file its own way. Also fired on join with the room's current value. */
  onHostSourceChange?: (source: WatchPartySource) => void;
};

/** Reactions per chat message. messageKey → emoji → array of
 *  userIds who reacted with that emoji. Plain object (not Map) so
 *  React identity-compare on setState works naturally. */
export type ReactionMap = Record<string, Record<string, string[]>>;

export type WatchPartyActivity =
  | {
      id: string;
      kind: 'play' | 'pause' | 'seek';
      who: { userId: string; displayName: string };
      currentTime: number;
      at: number;
    }
  | {
      id: string;
      kind: 'joined' | 'left' | 'host-changed';
      who: { userId: string; displayName: string };
      at: number;
    };

export type UseWatchPartyResult = {
  connected: boolean;
  /** Stable across reconnects — drives "host" indicators in the UI. */
  hostUserId: string | null;
  /** Current user's userId once joined (null until first room snapshot). */
  selfUserId: string | null;
  isHost: boolean;
  participants: WatchPartyParticipant[];
  chat: WatchPartyChatMessage[];
  /** Rolling feed of pause/play/seek + join/leave events with
   *  attribution. UI typically renders the most recent item as a
   *  transient toast. Capped to the last 20 entries. */
  activity: WatchPartyActivity[];
  /** Display names of participants currently typing (excluding self).
   *  Cleared automatically ~5s after their last `typing` ping. */
  typingNames: string[];
  /** Map<messageKey, Map<emoji, Set<userId>>> — flattened to a
   *  plain object so React change detection works on shallow
   *  re-renders. `messageKey` is `${from.userId}-${at}` and matches
   *  what the chat UI uses to key bubbles. */
  reactions: ReactionMap;
  error: string | null;
  /** The last error's machine code (e.g. 'no-room', 'password-incorrect') so
   *  callers can react precisely without string-matching the message. */
  errorCode: string | null;
  sendChat: (text: string) => void;
  /** Toggle the current user's reaction with `emoji` on the given
   *  message. Optimistically updates local state + broadcasts. */
  toggleReaction: (messageKey: string, emoji: string) => void;
  /** Broadcast a user-initiated seek to the new position. Called
   *  directly from the scrub bar / keyboard handlers — the hook no
   *  longer listens to the DOM `seeked` event for outbound seeks,
   *  because that event can't be reliably distinguished from
   *  remote-applied seeks (drift correction, applyHostEvent), and
   *  every workaround we tried produced false positives that made
   *  guest scrubs snap back. The UI layer knows when the user is
   *  scrubbing — let it just tell us. */
  broadcastSeek: (currentTime: number) => void;
  /** Send a `typing` ping — call this from a debounced handler on
   *  the chat input so we don't flood the wire. */
  sendTyping: () => void;
  /** Host-only: tell the room the current episode changed. */
  announceEpisode: (videoId: string | null) => void;
  /** Host-only: announce the current Real-Debrid fallback URL (or null when
   *  back on Vidking) so guests load the same torrent. */
  announceStream: (streamUrl: string | null) => void;
  /** Host-only: announce the selected subtitle language (or null = off). */
  announceSubs: (lang: string | null) => void;
  /** Host-only: announce the room's content `source` so guests land on the same
   *  file (Watch Party v2). Pass null when no shareable source is resolved. */
  announceSource: (source: WatchPartySource) => void;
  /** "Buffer until everybody loads" gate — true while any member is buffering. */
  partyWaiting: boolean;
  /** Report our own buffering state into the gate. */
  sendBuffering: (waiting: boolean) => void;
  /** Host-only: hand the crown to another participant. Server
   *  enforces both sender == current host and target in room. */
  transferHost: (targetUserId: string) => void;
  /** Cleanly leave the room (also fires on unmount). */
  leave: () => void;
};

// Tick-based drift correction kicks in when the guest's currentTime
// strays past this threshold. Tight enough that audible audio drift
// gets corrected fast, loose enough that normal playback jitter
// doesn't cause constant micro-snaps.
const TICK_DRIFT_TOLERANCE_S = 0.35;
// 2Hz keeps the perceived sync gap small (~500ms upper bound between
// corrections) without flooding the wire — payload is ~50 bytes.
const TICK_INTERVAL_MS = 500;
const RECONNECT_DELAY_MS = 2000;

export function useWatchParty({
  videoRef,
  roomCode,
  authToken,
  guestId,
  displayName,
  password,
  onHostEpisodeChange,
  onHostStreamChange,
  onHostSubsChange,
  onHostSourceChange,
}: UseWatchPartyOptions): UseWatchPartyResult {
  const [connected, setConnected] = useState(false);
  const [hostUserId, setHostUserId] = useState<string | null>(null);
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<WatchPartyParticipant[]>([]);
  const [chat, setChat] = useState<WatchPartyChatMessage[]>([]);
  const [activity, setActivity] = useState<WatchPartyActivity[]>([]);
  const [typingMap, setTypingMap] = useState<Map<string, { displayName: string; at: number }>>(() => new Map());
  const [reactions, setReactions] = useState<ReactionMap>({});
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const leftRef = useRef(false);
  // Refs mirror the latest user/host identifiers so the message handler
  // (captured once when the socket opens) reads current values instead
  // of stale closure state.
  const selfIdRef = useRef<string | null>(null);
  const hostIdRef = useRef<string | null>(null);
  // Stamp when we apply a remote play/pause/seek to our own <video>.
  // The DOM event our mutation triggers reads this and refuses to
  // re-broadcast, preventing an echo loop now that every participant
  // can fire events.
  const applyingRemoteAtRef = useRef(0);
  // Stamp when *we* broadcast a local play/pause action. The host's
  // periodic tick can race ahead of our pause (it was scheduled before
  // the host saw our event), and applying that stale tick would
  // un-pause us. While this ref is recent (~1.5s), applyHostTick keeps
  // drift correction but refuses to flip play/pause state.
  const lastLocalActionAtRef = useRef(0);
  // Stamp when our WS connection becomes live. Used to suppress two
  // classes of noise right after (re)connecting:
  //   - Guests' own initial-autoplay `play` events (they'd broadcast
  //     `play 0` and override the host's resume seek).
  //   - The host applying remote events during the moment their
  //     video is still loading toward its `?t=` start time.
  // Both windows are short — 2s for guests, 3s for the host.
  const connectedAtRef = useRef(0);
  const onHostEpisodeChangeRef = useRef(onHostEpisodeChange);
  onHostEpisodeChangeRef.current = onHostEpisodeChange;
  const onHostStreamChangeRef = useRef(onHostStreamChange);
  onHostStreamChangeRef.current = onHostStreamChange;
  const onHostSubsChangeRef = useRef(onHostSubsChange);
  onHostSubsChangeRef.current = onHostSubsChange;
  const onHostSourceChangeRef = useRef(onHostSourceChange);
  onHostSourceChangeRef.current = onHostSourceChange;

  const pushActivity = useCallback((item: WatchPartyActivity) => {
    setActivity((prev) => [...prev.slice(-19), item]);
  }, []);

  const isHost = !!(selfUserId && hostUserId && selfUserId === hostUserId);

  const send = useCallback((msg: WatchPartyClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket may have closed between the readyState check and the send.
    }
  }, []);

  // "Buffer until everybody loads" gate. `partyWaiting` = some member (us or
  // another) is still buffering, so the player should hold. We report our own
  // buffering via sendBuffering(); the server aggregates and broadcasts `gate`.
  const [partyWaiting, setPartyWaiting] = useState(false);
  // Ref mirror so applyHostTick (a stable useCallback) reads the live value.
  const partyWaitingRef = useRef(false);
  partyWaitingRef.current = partyWaiting;
  const lastBufferingSentRef = useRef<boolean | null>(null);
  const sendBuffering = useCallback((waiting: boolean) => {
    if (lastBufferingSentRef.current === waiting) return; // de-dupe
    lastBufferingSentRef.current = waiting;
    send({ t: 'buffering', waiting });
  }, [send]);

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      send({ t: 'chat', text: trimmed });
    },
    [send]
  );

  // Debounce typing pings: at most one every 2.5s while the user
  // keeps typing. Lower frequency than the 5s server-side TTL so
  // recipients never see the indicator flicker between keystrokes.
  const lastTypingSentRef = useRef(0);
  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2500) return;
    lastTypingSentRef.current = now;
    send({ t: 'typing' });
  }, [send]);

  const broadcastSeek = useCallback(
    (currentTime: number) => {
      if (!connected) return;
      lastLocalActionAtRef.current = Date.now();
      send({ t: 'event', kind: 'seek', currentTime });
    },
    [connected, send]
  );

  const toggleReaction = useCallback(
    (messageKey: string, emoji: string) => {
      const selfId = selfIdRef.current;
      if (!selfId) return;
      let kind: 'add' | 'remove' = 'add';
      setReactions((prev) => {
        const messageMap = { ...(prev[messageKey] ?? {}) };
        const list = messageMap[emoji] ?? [];
        if (list.includes(selfId)) {
          const next = list.filter((u) => u !== selfId);
          if (next.length === 0) delete messageMap[emoji];
          else messageMap[emoji] = next;
          kind = 'remove';
        } else {
          messageMap[emoji] = [...list, selfId];
          kind = 'add';
        }
        const out = { ...prev };
        if (Object.keys(messageMap).length === 0) delete out[messageKey];
        else out[messageKey] = messageMap;
        return out;
      });
      send({ t: 'chat:react', messageKey, emoji, kind });
    },
    [send]
  );

  const announceEpisode = useCallback(
    (videoId: string | null) => {
      send({ t: 'host:episode', videoId });
    },
    [send]
  );

  const announceStream = useCallback(
    (streamUrl: string | null) => {
      send({ t: 'host:stream', streamUrl });
    },
    [send]
  );

  const announceSubs = useCallback(
    (lang: string | null) => {
      send({ t: 'host:subs', lang });
    },
    [send]
  );

  const announceSource = useCallback(
    (source: WatchPartySource) => {
      send({ t: 'host:source', source });
    },
    [send]
  );

  const transferHost = useCallback(
    (targetUserId: string) => {
      send({ t: 'host:transfer', targetUserId });
    },
    [send]
  );

  const leave = useCallback(() => {
    leftRef.current = true;
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (tickTimerRef.current != null) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ t: 'leave' } satisfies WatchPartyClientMessage));
      } catch {
        // Best-effort — close will follow.
      }
      ws.close(1000, 'left');
    } else if (ws) {
      ws.close();
    }
    setConnected(false);
  }, []);

  // Discrete user actions from the host (play / pause / seek). These
  // always snap immediately — no drift tolerance — because the host
  // explicitly took an action and any divergence would feel laggy. We
  // shift `currentTime` forward by the network latency on play/seek so
  // the guest doesn't start the next frame X ms behind the host.
  const applyHostEvent = useCallback(
    (kind: 'play' | 'pause' | 'seek', currentTime: number, latencyMs: number) => {
      const video = videoRef.current;
      if (!video) return;
      // Stamp BEFORE mutating so the resulting DOM event sees the
      // marker and skips its broadcast (echo prevention now that
      // every participant — not just the host — can broadcast).
      applyingRemoteAtRef.current = Date.now();
      const target = kind === 'pause' ? currentTime : currentTime + latencyMs / 1000;
      try {
        video.currentTime = target;
      } catch {
        // Pre-metadata seek — browsers throw; harmless, next event will retry.
      }
      if (kind === 'play' && video.paused) {
        // The invite landing page provides a user gesture before
        // navigating to the player, so autoplay is allowed by the
        // time apply runs — a bare play() works.
        video.play().catch(() => {});
      } else if (kind === 'pause' && !video.paused) {
        video.pause();
      }
    },
    [videoRef]
  );

  // Periodic 2Hz tick from the host. Used purely for drift correction —
  // we only snap currentTime when the guest has strayed beyond the
  // tolerance, otherwise normal playback continues uninterrupted (no
  // micro-snaps every 500ms).
  const applyHostTick = useCallback(
    (currentTime: number, isPlaying: boolean, latencyMs: number) => {
      const video = videoRef.current;
      if (!video) return;
      // Stale-tick guard for ALL of the tick (drift + play/pause).
      // When the local user just performed an action (play / pause /
      // seek), there's a ~500ms window where the host is still
      // sending ticks generated BEFORE they received our broadcast.
      // Honoring those would snap us back to the previous position —
      // so anyone seeking would visibly bounce back to where the host
      // was a half-second ago. Within 1.5s of a local action we treat
      // our state as authoritative and ignore the tick entirely. By
      // then the host has applied our event and is broadcasting
      // ticks that match the new position.
      if (Date.now() - lastLocalActionAtRef.current < 1500) return;
      // Buffer-until-everybody gate takes precedence: while waiting, hold paused
      // and ignore the tick's play state. A buffering host is STALLED (not
      // paused), so it broadcasts isPlaying=true — without this, a loaded member
      // would keep getting told to play behind the buffering overlay.
      if (partyWaitingRef.current) {
        if (!video.paused) {
          applyingRemoteAtRef.current = Date.now();
          video.pause();
        }
        return;
      }
      // IMPORTANT: do NOT pre-stamp applyingRemoteAtRef here. Ticks
      // arrive every 500ms; pre-stamping made every no-op tick
      // suppress the user's own play/pause broadcasts for the next
      // 600ms — which meant only the host could control playback.
      // Only stamp when we actually mutate the video below.
      const expected = isPlaying ? currentTime + latencyMs / 1000 : currentTime;
      const drift = Math.abs(video.currentTime - expected);
      if (drift > TICK_DRIFT_TOLERANCE_S) {
        applyingRemoteAtRef.current = Date.now();
        try {
          video.currentTime = expected;
        } catch {
          // ignore — pre-metadata.
        }
      }
      if (isPlaying && video.paused) {
        applyingRemoteAtRef.current = Date.now();
        video.play().catch(() => {});
      } else if (!isPlaying && !video.paused) {
        applyingRemoteAtRef.current = Date.now();
        video.pause();
      }
    },
    [videoRef]
  );

  // ---- WebSocket lifecycle ----

  useEffect(() => {
    // Need a room code and *some* identity (token or guestId).
    if (!roomCode || (!authToken && !guestId)) {
      setConnected(false);
      setHostUserId(null);
      setSelfUserId(null);
      setParticipants([]);
      setChat([]);
      setError(null);
      return;
    }

    leftRef.current = false;
    let cancelled = false;

    function connect() {
      if (cancelled || leftRef.current) return;
      const ws = new WebSocket(watchPartyWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        send({
          t: 'join',
          code: roomCode!,
          displayName,
          // Server prefers the JWT when both are present. Guests
          // identify themselves via guestId, which is persisted in
          // localStorage so reconnects land on the same participant
          // slot.
          token: authToken ?? undefined,
          guestId: !authToken && guestId ? guestId : undefined,
          // Server only validates when the room actually has a
          // password — sending an empty string for open rooms is a
          // no-op.
          password: password ?? undefined,
        });
      };

      ws.onmessage = (ev) => {
        let msg: WatchPartyServerMessage;
        try {
          msg = JSON.parse(ev.data) as WatchPartyServerMessage;
        } catch {
          return;
        }

        if (msg.t === 'room') {
          selfIdRef.current = msg.self.userId;
          hostIdRef.current = msg.hostUserId;
          setSelfUserId(msg.self.userId);
          setHostUserId(msg.hostUserId);
          setParticipants(msg.participants);
          connectedAtRef.current = Date.now();
          setConnected(true);
          setError(null);
          setErrorCode(null);
          // Seed persistent room state from the snapshot — chat
          // history + reactions survive both a tab refresh and a
          // storage container restart (server persists to Mongo).
          if (Array.isArray(msg.chat)) {
            setChat(msg.chat.slice(-99));
          } else {
            setChat([]);
          }
          if (msg.reactions && typeof msg.reactions === 'object') {
            setReactions(msg.reactions);
          } else {
            setReactions({});
          }
          // Initial sync on join (guest only — host's video is the
          // source of truth, never adjust it).
          if (msg.lastTick && msg.self.userId !== msg.hostUserId) {
            applyHostTick(
              msg.lastTick.currentTime,
              msg.lastTick.isPlaying,
              Date.now() - msg.lastTick.at
            );
          }
          // Late joiner: if the host is already on an RD fallback, load that same
          // torrent (guest only — the host already has it).
          if (msg.self.userId !== msg.hostUserId && msg.streamUrl) {
            onHostStreamChangeRef.current?.(msg.streamUrl);
          }
          // Late joiner: match the host's current subtitle language.
          if (msg.self.userId !== msg.hostUserId && msg.subtitleLang) {
            onHostSubsChangeRef.current?.(msg.subtitleLang);
          }
          // Late joiner: resolve the host's announced content source (WP v2).
          if (msg.self.userId !== msg.hostUserId && msg.source) {
            onHostSourceChangeRef.current?.(msg.source);
          }
        } else if (msg.t === 'presence') {
          if (msg.kind === 'joined') {
            setParticipants((prev) => {
              if (prev.some((p) => p.userId === msg.userId)) return prev;
              return [
                ...prev,
                {
                  userId: msg.userId,
                  displayName: msg.displayName,
                  joinedAt: Date.now(),
                  isHost: false,
                },
              ];
            });
            pushActivity({
              id: `j-${msg.userId}-${Date.now()}`,
              kind: 'joined',
              who: { userId: msg.userId, displayName: msg.displayName },
              at: Date.now(),
            });
          } else if (msg.kind === 'left') {
            setParticipants((prev) => prev.filter((p) => p.userId !== msg.userId));
            pushActivity({
              id: `l-${msg.userId}-${Date.now()}`,
              kind: 'left',
              who: { userId: msg.userId, displayName: msg.displayName },
              at: Date.now(),
            });
          } else if (msg.kind === 'host-changed') {
            hostIdRef.current = msg.hostUserId;
            setHostUserId(msg.hostUserId);
            setParticipants((prev) =>
              prev.map((p) => ({ ...p, isHost: p.userId === msg.hostUserId }))
            );
            pushActivity({
              id: `h-${msg.userId}-${Date.now()}`,
              kind: 'host-changed',
              who: { userId: msg.userId, displayName: msg.displayName },
              at: Date.now(),
            });
          }
        } else if (msg.t === 'tick') {
          applyHostTick(msg.currentTime, msg.isPlaying, Date.now() - msg.sentAt);
        } else if (msg.t === 'event') {
          // Apply to our own video (server already excluded us from
          // the broadcast, but defensive: skip if attribution says
          // it's us — happens with reflected echoes from a buggy
          // proxy etc).
          if (msg.from.userId !== selfIdRef.current) {
            // Host settle window: while the host is still loading
            // a fresh src and applying a `?t=` resume seek,
            // a guest's stray autoplay-triggered event must not
            // override the host's authoritative position. Belt-
            // and-suspenders against the guest-side 2s suppression.
            const isHost = !!(selfIdRef.current && selfIdRef.current === hostIdRef.current);
            const settling = isHost && Date.now() - connectedAtRef.current < 3000;
            if (!settling) {
              applyHostEvent(msg.kind, msg.currentTime, Date.now() - msg.sentAt);
            }
          }
          pushActivity({
            id: `e-${msg.from.userId}-${Date.now()}`,
            kind: msg.kind,
            who: msg.from,
            currentTime: msg.currentTime,
            at: Date.now(),
          });
        } else if (msg.t === 'typing') {
          if (msg.from.userId === selfIdRef.current) return;
          setTypingMap((prev) => {
            const next = new Map(prev);
            next.set(msg.from.userId, { displayName: msg.from.displayName, at: Date.now() });
            return next;
          });
        } else if (msg.t === 'episode') {
          onHostEpisodeChangeRef.current?.(msg.videoId);
        } else if (msg.t === 'stream') {
          // Host fell back to RD (or returned to Vidking) — guests follow.
          onHostStreamChangeRef.current?.(msg.streamUrl);
        } else if (msg.t === 'subs') {
          // Host changed subtitle language — guests match it.
          onHostSubsChangeRef.current?.(msg.lang);
        } else if (msg.t === 'source') {
          // Host announced/changed the room's content source — guests resolve
          // the same file (WP v2 same-file sync).
          onHostSourceChangeRef.current?.(msg.source);
        } else if (msg.t === 'gate') {
          // Buffer-until-everybody-loads gate flipped.
          setPartyWaiting(msg.waiting);
        } else if (msg.t === 'chat') {
          setChat((prev) => [...prev.slice(-99), { from: msg.from, text: msg.text, at: msg.at }]);
        } else if (msg.t === 'reaction') {
          setReactions((prev) => {
            const messageMap = { ...(prev[msg.messageKey] ?? {}) };
            const list = messageMap[msg.emoji] ?? [];
            const has = list.includes(msg.from.userId);
            if (msg.kind === 'add' && !has) {
              messageMap[msg.emoji] = [...list, msg.from.userId];
            } else if (msg.kind === 'remove' && has) {
              const next = list.filter((u) => u !== msg.from.userId);
              if (next.length === 0) delete messageMap[msg.emoji];
              else messageMap[msg.emoji] = next;
            } else {
              return prev;
            }
            const out = { ...prev };
            if (Object.keys(messageMap).length === 0) delete out[msg.messageKey];
            else out[msg.messageKey] = messageMap;
            return out;
          });
        } else if (msg.t === 'error') {
          setError(msg.message);
          setErrorCode(msg.code ?? null);
          // Hard failures: don't reconnect. Bad-password rooms get
          // re-tried by the user via the in-player prompt (which
          // re-renders the hook with a fresh password prop).
          if (
            msg.code === 'no-room'
            || msg.code === 'auth'
            || msg.code === 'password-required'
            || msg.code === 'password-incorrect'
          ) {
            leftRef.current = true;
          }
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        if (!leftRef.current && !cancelled) {
          reconnectTimerRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        // Logged via onclose — no extra state change.
      };
    }

    connect();

    return () => {
      cancelled = true;
      leftRef.current = true;
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (tickTimerRef.current != null) {
        window.clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: 'leave' } satisfies WatchPartyClientMessage));
          }
        } catch {
          // ignore
        }
        ws.close();
      }
      setConnected(false);
      setHostUserId(null);
      setSelfUserId(null);
      setParticipants([]);
      setChat([]);
    };
    // applyHostEvent / applyHostTick / send are stable; selfId / hostId
    // are read via refs above, not closure state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, authToken, guestId, displayName, password]);

  // ---- Broadcast: events (everyone) + tick (host only) ----

  // Every participant broadcasts their own play / pause / seek so
  // anyone can pause for the room. Echo suppression via
  // `applyingRemoteAtRef`: when WE just applied a remote action the
  // DOM event fires within ~600ms and gets skipped here.
  useEffect(() => {
    if (!connected) return;
    const video = videoRef.current;
    if (!video) return;

    // Outbound play/pause come from DOM events on the <video> —
    // those events fire reliably on user clicks AND on programmatic
    // mutations from applyHostEvent, so we echo-suppress via
    // applyingRemoteAtRef.
    //
    // SEEKS are intentionally NOT listened to here — DOM `seeked`
    // fires for drift-correction snaps, applyHostEvent, HLS-internal
    // re-seeks, and a hundred other things we can't reliably tell
    // apart from user scrubs. Instead the scrub bar / keyboard
    // handlers call `broadcastSeek()` directly: the UI layer knows
    // when a seek is user-initiated.
    const broadcast = (kind: 'play' | 'pause') => {
      if (Date.now() - applyingRemoteAtRef.current < 600) return;
      const isHost = !!(selfIdRef.current && selfIdRef.current === hostIdRef.current);
      if (!isHost && Date.now() - connectedAtRef.current < 2000) return;
      lastLocalActionAtRef.current = Date.now();
      send({ t: 'event', kind, currentTime: video.currentTime });
    };
    const onPlay = () => broadcast('play');
    const onPause = () => broadcast('pause');

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [connected, videoRef, send]);

  // "Buffer until everybody loads" — report OUR buffering state into the gate.
  // `readyState < HAVE_FUTURE_DATA` (can't play smoothly) = buffering. The server
  // aggregates everyone and flips `partyWaiting`.
  useEffect(() => {
    if (!connected) return;
    const video = videoRef.current;
    if (!video) return;
    const report = () => sendBuffering(video.readyState < video.HAVE_FUTURE_DATA);
    const evts = ['waiting', 'stalled', 'playing', 'canplay', 'canplaythrough', 'seeked', 'loadeddata', 'emptied'];
    evts.forEach((e) => video.addEventListener(e, report));
    report();
    return () => {
      evts.forEach((e) => video.removeEventListener(e, report));
      sendBuffering(false); // leaving the player / disconnecting → clear our wait
    };
  }, [connected, videoRef, sendBuffering]);

  // Gate hold: while ANY member is buffering, pause our video (without
  // broadcasting it — echo-suppressed). When the gate opens, resume if we were
  // playing, so the whole party starts together instead of the first-loaded
  // member ping-ponging at the seek point.
  const wasPlayingBeforeGateRef = useRef(false);
  useEffect(() => {
    if (!connected) return;
    const video = videoRef.current;
    if (!video) return;
    if (partyWaiting) {
      wasPlayingBeforeGateRef.current = !video.paused;
      if (!video.paused) {
        applyingRemoteAtRef.current = Date.now();
        video.pause();
      }
    } else if (wasPlayingBeforeGateRef.current && video.paused) {
      applyingRemoteAtRef.current = Date.now();
      video.play().catch(() => {});
    }
  }, [partyWaiting, connected, videoRef]);

  // The host owns the periodic drift-correction tick. Splitting this
  // off keeps `host:tick` single-source-of-truth even though
  // discrete events have been democratized.
  useEffect(() => {
    if (!connected || !isHost) return;
    const video = videoRef.current;
    if (!video) return;
    tickTimerRef.current = window.setInterval(() => {
      send({
        t: 'host:tick',
        currentTime: video.currentTime,
        isPlaying: !video.paused,
      });
    }, TICK_INTERVAL_MS);
    return () => {
      if (tickTimerRef.current != null) {
        window.clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
    };
  }, [connected, isHost, videoRef, send]);

  // Sweep stale typing entries every second. Server's clients send
  // pings every ~2.5s while typing; we expire 5s of silence so the
  // indicator disappears on a pause without flicker.
  useEffect(() => {
    const interval = window.setInterval(() => {
      setTypingMap((prev) => {
        if (prev.size === 0) return prev;
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [userId, info] of prev) {
          if (now - info.at > 5000) {
            next.delete(userId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const typingNames = useMemo(() => {
    const out: string[] = [];
    for (const info of typingMap.values()) out.push(info.displayName);
    return out;
  }, [typingMap]);

  return {
    connected,
    hostUserId,
    selfUserId,
    isHost,
    participants,
    chat,
    activity,
    typingNames,
    reactions,
    error,
    errorCode,
    sendChat,
    sendTyping,
    broadcastSeek,
    toggleReaction,
    announceEpisode,
    announceStream,
    announceSubs,
    announceSource,
    partyWaiting,
    sendBuffering,
    transferHost,
    leave,
  };
}
