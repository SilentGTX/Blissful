// Watch-party room SYNC hook — 1:1 port of the Windows app's useWatchPartyMpv
// (apps/blissful-mvs/src/lib/useWatchPartyMpv.ts), bridged to the RN expo-video
// player instead of the mpv desktop bridge. The component supplies getTime/seek/
// play/pause + a pausedRef; the hook owns the WebSocket, the host drift tick, and
// applies remote actions through those callbacks.
//
// Control is DEMOCRATISED (anyone can play/pause/seek for the room) exactly like
// the desktop. Three guards prevent loops: echo-suppression (600ms after applying
// a remote action we don't re-broadcast), stale-tick guard (ignore host ticks for
// 1500ms after a local action), and a host settle window (host ignores inbound
// events for 3000ms after connect so a guest's autoplay can't fight the resume).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  watchPartyWsUrl,
  type ReactionMap,
  type WatchPartyActivity,
  type WatchPartyChatMessage,
  type WatchPartyClientMessage,
  type WatchPartyParticipant,
  type WatchPartyServerMessage,
} from './watchParty';

const TICK_INTERVAL_MS = 500; // host drift heartbeat (2 Hz)
// Sync strategy on RN: hard seeks stall expo-video's picture, so instead of
// snap-seeking on drift (which left a loose 1.5s tolerance + cooldown = the 2-3s
// gap), we keep guests pinned with PLAYBACK-RATE micro-correction — speed up a hair
// when behind, slow a hair when ahead — and only hard-seek for a real jump (>4s,
// i.e. someone scrubbed). preservesPitch keeps the audio natural, so a few % of rate
// nudge is inaudible while it holds everyone within ~0.4s of the host.
const SOFT_SYNC_TOLERANCE_S = 0.4; // within this we're "in sync" — rate back to 1x
const HARD_SEEK_THRESHOLD_S = 4; // beyond this it's a scrub/huge desync — jump, don't drift
const DRIFT_SEEK_COOLDOWN_MS = 2500; // min gap between hard seeks
const MAX_CATCHUP_RATE = 0.12; // +12% max when catching up (behind the host)
const MAX_SLOWDOWN_RATE = 0.1; // -10% max when easing back (ahead of the host)
// Join is made NON-DESTRUCTIVE three ways: (1) a promoted/rejoining host adopts the
// room's lastTick instead of ticking its fresh 0 — the reset-to-0-for-everyone bug;
// (2) existing members ignore a just-joined peer's events for INBOUND_MS (a joiner's
// load-time autoplay can't hijack the room); (3) the joiner self-suppresses its own
// outbound events for OUTBOUND_MS (insurance for non-RN members without guard 2).
const JOIN_INBOUND_GRACE_MS = 4000;
const JOIN_OUTBOUND_GRACE_MS = 2000;
const RECONNECT_DELAY_MS = 2000;
const ECHO_SUPPRESS_MS = 600;
const STALE_TICK_GUARD_MS = 1500;
const HOST_SETTLE_MS = 3000;
const HARD_ERROR_CODES = new Set(['no-room', 'auth', 'password-required', 'password-incorrect']);

export type UseWatchPartyRoomOptions = {
  roomCode: string | null; // null disables the connection
  authToken: string | null; // provide this OR guestId
  guestId?: string | null;
  displayName: string;
  password?: string | null;
  onHostEpisodeChange?: (videoId: string | null) => void;
  // Player bridge:
  getTime: () => number; // current playback seconds
  pausedRef: { current: boolean }; // true = user wants paused
  seek: (seconds: number) => void; // absolute seek
  play: () => void;
  pause: () => void;
  setRate?: (rate: number) => void; // playback speed (for drift micro-correction)
};

export type UseWatchPartyRoomResult = {
  connected: boolean;
  hostUserId: string | null;
  selfUserId: string | null;
  isHost: boolean;
  participants: WatchPartyParticipant[];
  chat: WatchPartyChatMessage[];
  activity: WatchPartyActivity[];
  typingNames: string[];
  reactions: ReactionMap;
  error: string | null;
  sendChat: (text: string) => void;
  toggleReaction: (messageKey: string, emoji: string) => void;
  broadcastSeek: (currentTime: number) => void;
  broadcastPlay: () => void;
  broadcastPause: () => void;
  sendTyping: () => void;
  announceEpisode: (videoId: string | null) => void;
  transferHost: (targetUserId: string) => void;
  leave: () => void;
};

let activitySeq = 0;
const nextActivityId = () => `a${++activitySeq}`;

export function useWatchPartyRoom(opts: UseWatchPartyRoomOptions): UseWatchPartyRoomResult {
  const { roomCode, authToken, guestId, displayName, password } = opts;

  const [connected, setConnected] = useState(false);
  const [hostUserId, setHostUserId] = useState<string | null>(null);
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<WatchPartyParticipant[]>([]);
  const [chat, setChat] = useState<WatchPartyChatMessage[]>([]);
  const [activity, setActivity] = useState<WatchPartyActivity[]>([]);
  const [reactions, setReactions] = useState<ReactionMap>({});
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isHost = !!(selfUserId && hostUserId && selfUserId === hostUserId);

  // Refs that the WebSocket callbacks read without re-subscribing.
  const wsRef = useRef<WebSocket | null>(null);
  const leftRef = useRef(false);
  const selfIdRef = useRef<string | null>(null);
  const hostIdRef = useRef<string | null>(null);
  const connectedAtRef = useRef(0); // host settle window
  const lastLocalActionAtRef = useRef(0); // stale-tick guard
  const applyingRemoteAtRef = useRef(0); // echo suppression
  const lastDriftSeekRef = useRef(0); // rate-limit hard drift-correction seeks
  const currentRateRef = useRef(1); // last playback rate we set (avoid redundant sets)
  const joinGraceUntilRef = useRef(0); // suppress OUR outbound events right after join
  const recentJoinAtRef = useRef<Map<string, number>>(new Map()); // peers who just joined
  const initialSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Latest player-bridge callbacks (kept fresh so the socket closures don't go stale).
  const bridgeRef = useRef(opts);
  bridgeRef.current = opts;

  const send = useCallback((msg: WatchPartyClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* socket closing */ }
  }, []);

  const pushActivity = useCallback((a: WatchPartyActivity) => {
    setActivity((prev) => [...prev.slice(-19), a]);
  }, []);

  // ── Apply remote actions through the player bridge ─────────────────────────
  const applyRemoteEvent = useCallback((kind: 'play' | 'pause' | 'seek', currentTime: number, latencyMs: number) => {
    const b = bridgeRef.current;
    applyingRemoteAtRef.current = Date.now();
    const target = kind === 'pause' ? currentTime : currentTime + latencyMs / 1000;
    b.seek(target);
    if (kind === 'play') b.play();
    else if (kind === 'pause') b.pause();
  }, []);

  const setRate = useCallback((rate: number) => {
    if (currentRateRef.current === rate) return;
    currentRateRef.current = rate;
    bridgeRef.current.setRate?.(rate);
  }, []);

  // Adopt an absolute position + play state, retrying while the engine reports it's
  // not loaded yet (expo-video silently drops `currentTime =` before the source is
  // ready — the one-shot join seek used to be lost, leaving the guest stuck at 0).
  const applyInitialSync = useCallback((time: number, isPlaying: boolean) => {
    if (initialSyncTimerRef.current != null) clearTimeout(initialSyncTimerRef.current);
    let tries = 0;
    const attempt = () => {
      const b = bridgeRef.current;
      applyingRemoteAtRef.current = Date.now();
      b.seek(time);
      if (isPlaying) b.play(); else b.pause();
      tries += 1;
      // Keep retrying only while the engine is clearly pre-load (still ~0 although we
      // asked for a real position). Once it loads + the seek lands, getTime jumps and
      // we stop; the ongoing host tick then fine-tunes via rate correction.
      if (tries < 14 && time > 2 && b.getTime() < 1) {
        initialSyncTimerRef.current = setTimeout(attempt, 300);
      }
    };
    attempt();
  }, []);

  // Host drift tick — keeps guests pinned to the host clock. Play/pause is NOT
  // reconciled here (explicit play/pause EVENTS handle that, so a guest who pauses
  // isn't force-played back). When playing: tiny drift -> nudge playbackRate so the
  // picture never stalls; a real jump (>4s) -> hard seek (rate-limited). When paused
  // or in-sync -> rate back to 1x.
  const applyHostTick = useCallback((currentTime: number, isPlaying: boolean, latencyMs: number) => {
    if (Date.now() - lastLocalActionAtRef.current < STALE_TICK_GUARD_MS) return;
    const b = bridgeRef.current;
    if (!isPlaying) { setRate(1); return; }
    const expected = currentTime + latencyMs / 1000;
    const drift = b.getTime() - expected; // >0 ahead of host, <0 behind
    const ad = Math.abs(drift);
    if (ad > HARD_SEEK_THRESHOLD_S) {
      if (Date.now() - lastDriftSeekRef.current > DRIFT_SEEK_COOLDOWN_MS) {
        lastDriftSeekRef.current = Date.now();
        applyingRemoteAtRef.current = Date.now();
        setRate(1);
        b.seek(expected);
      }
      return;
    }
    if (ad <= SOFT_SYNC_TOLERANCE_S) { setRate(1); return; }
    // Behind -> speed up; ahead -> ease off. Magnitude scales with drift, capped.
    if (drift < 0) setRate(1 + Math.min(MAX_CATCHUP_RATE, ad * 0.1));
    else setRate(1 - Math.min(MAX_SLOWDOWN_RATE, ad * 0.08));
  }, [setRate]);

  // ── Outbound broadcasts (player calls these on USER actions) ───────────────
  const inJoinGrace = () => Date.now() < joinGraceUntilRef.current;
  const broadcastSeek = useCallback((currentTime: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (inJoinGrace()) return;
    lastLocalActionAtRef.current = Date.now();
    send({ t: 'event', kind: 'seek', currentTime });
  }, [send]);
  const broadcastPlay = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (inJoinGrace()) return;
    if (Date.now() - applyingRemoteAtRef.current < ECHO_SUPPRESS_MS) return;
    lastLocalActionAtRef.current = Date.now();
    send({ t: 'event', kind: 'play', currentTime: bridgeRef.current.getTime() });
  }, [send]);
  const broadcastPause = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (inJoinGrace()) return;
    if (Date.now() - applyingRemoteAtRef.current < ECHO_SUPPRESS_MS) return;
    lastLocalActionAtRef.current = Date.now();
    send({ t: 'event', kind: 'pause', currentTime: bridgeRef.current.getTime() });
  }, [send]);

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed) send({ t: 'chat', text: trimmed.slice(0, 500) });
  }, [send]);
  const sendTyping = useCallback(() => { send({ t: 'typing' }); }, [send]);
  const announceEpisode = useCallback((videoId: string | null) => { send({ t: 'host:episode', videoId }); }, [send]);
  const transferHost = useCallback((targetUserId: string) => { send({ t: 'host:transfer', targetUserId }); }, [send]);

  const toggleReaction = useCallback((messageKey: string, emoji: string) => {
    const self = selfIdRef.current;
    if (!self) return;
    const has = reactions[messageKey]?.[emoji]?.includes(self);
    send({ t: 'chat:react', messageKey, emoji, kind: has ? 'remove' : 'add' });
  }, [reactions, send]);

  const leave = useCallback(() => {
    leftRef.current = true;
    send({ t: 'leave' });
    if (tickTimerRef.current != null) clearInterval(tickTimerRef.current);
    if (reconnectTimerRef.current != null) clearTimeout(reconnectTimerRef.current);
    if (initialSyncTimerRef.current != null) clearTimeout(initialSyncTimerRef.current);
    setRate(1); // hand the player back at normal speed
    try { wsRef.current?.close(1000); } catch { /* already closing */ }
    wsRef.current = null;
    setConnected(false);
  }, [send, setRate]);

  // ── Connection lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomCode || !displayName) return;
    let cancelled = false;
    leftRef.current = false;

    const handle = (msg: WatchPartyServerMessage) => {
      switch (msg.t) {
        case 'room': {
          selfIdRef.current = msg.self.userId;
          hostIdRef.current = msg.hostUserId;
          connectedAtRef.current = Date.now();
          setSelfUserId(msg.self.userId);
          setHostUserId(msg.hostUserId);
          setParticipants(msg.participants);
          setChat((msg.chat ?? []).slice(-99));
          setReactions(msg.reactions ?? {});
          setConnected(true);
          setError(null);
          // Don't broadcast our own load-time play/seek right after joining, and treat
          // existing members as "not recently joined" (only NEW joins after us are).
          joinGraceUntilRef.current = Date.now() + JOIN_OUTBOUND_GRACE_MS;
          recentJoinAtRef.current.clear();
          // Sync to the room's last tick on join. Guests always adopt it; a host adopts
          // it only when the room is AHEAD of us — i.e. we were just promoted to host
          // (or rejoined) and loaded at ~0, so we resume the real position instead of
          // ticking our fresh 0 and snapping everyone back to the start.
          if (msg.lastTick) {
            const amHost = msg.self.userId === msg.hostUserId;
            const latency = Math.max(0, Date.now() - msg.lastTick.at);
            const target = msg.lastTick.isPlaying ? msg.lastTick.currentTime + latency / 1000 : msg.lastTick.currentTime;
            if (!amHost || bridgeRef.current.getTime() < target - 2) {
              applyInitialSync(target, msg.lastTick.isPlaying);
            }
          }
          break;
        }
        case 'presence': {
          if (msg.kind === 'joined') {
            // A freshly-joined peer's load-time play/seek must not hijack the room —
            // ignore their events for a grace window (the reset-to-0-for-everyone bug).
            recentJoinAtRef.current.set(msg.userId, Date.now());
            setParticipants((prev) => prev.some((p) => p.userId === msg.userId) ? prev : [...prev, { userId: msg.userId, displayName: msg.displayName, joinedAt: Date.now(), isHost: false }]);
            pushActivity({ id: nextActivityId(), kind: 'joined', who: { userId: msg.userId, displayName: msg.displayName }, at: Date.now() });
          } else if (msg.kind === 'left') {
            recentJoinAtRef.current.delete(msg.userId);
            setParticipants((prev) => prev.filter((p) => p.userId !== msg.userId));
            pushActivity({ id: nextActivityId(), kind: 'left', who: { userId: msg.userId, displayName: msg.displayName }, at: Date.now() });
          } else if (msg.kind === 'host-changed') {
            hostIdRef.current = msg.hostUserId;
            setHostUserId(msg.hostUserId);
            setParticipants((prev) => prev.map((p) => ({ ...p, isHost: p.userId === msg.hostUserId })));
            pushActivity({ id: nextActivityId(), kind: 'host-changed', who: { userId: msg.userId, displayName: msg.displayName }, at: Date.now() });
          }
          break;
        }
        case 'tick': {
          if (selfIdRef.current && selfIdRef.current === hostIdRef.current) break; // host ignores own tick
          applyHostTick(msg.currentTime, msg.isPlaying, Math.max(0, Date.now() - msg.sentAt));
          break;
        }
        case 'event': {
          const amHost = selfIdRef.current === hostIdRef.current;
          const settling = amHost && Date.now() - connectedAtRef.current < HOST_SETTLE_MS;
          const joinedAt = recentJoinAtRef.current.get(msg.from.userId);
          const fromFreshJoiner = joinedAt != null && Date.now() - joinedAt < JOIN_INBOUND_GRACE_MS;
          if (msg.from.userId !== selfIdRef.current && !settling && !fromFreshJoiner) {
            applyRemoteEvent(msg.kind, msg.currentTime, Math.max(0, Date.now() - msg.sentAt));
          }
          pushActivity({ id: nextActivityId(), kind: msg.kind, who: msg.from, currentTime: msg.currentTime, at: Date.now() });
          break;
        }
        case 'episode':
          bridgeRef.current.onHostEpisodeChange?.(msg.videoId);
          break;
        case 'typing': {
          const name = msg.from.displayName;
          if (msg.from.userId === selfIdRef.current) break;
          setTypingNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
          const timers = typingTimersRef.current;
          const existing = timers.get(name);
          if (existing) clearTimeout(existing);
          timers.set(name, setTimeout(() => { setTypingNames((prev) => prev.filter((n) => n !== name)); timers.delete(name); }, 4000));
          break;
        }
        case 'chat':
          setChat((prev) => [...prev.slice(-98), { from: msg.from, text: msg.text, at: msg.at }]);
          break;
        case 'reaction': {
          setReactions((prev) => {
            const next: ReactionMap = { ...prev };
            const forKey = { ...(next[msg.messageKey] ?? {}) };
            const list = new Set(forKey[msg.emoji] ?? []);
            if (msg.kind === 'add') list.add(msg.from.userId); else list.delete(msg.from.userId);
            if (list.size > 0) forKey[msg.emoji] = [...list]; else delete forKey[msg.emoji];
            if (Object.keys(forKey).length > 0) next[msg.messageKey] = forKey; else delete next[msg.messageKey];
            return next;
          });
          break;
        }
        case 'error':
          setError(msg.message || msg.code);
          if (HARD_ERROR_CODES.has(msg.code)) leftRef.current = true; // stop reconnecting
          break;
      }
    };

    const connect = () => {
      if (cancelled || leftRef.current) return;
      const ws = new WebSocket(watchPartyWsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        send({
          t: 'join',
          code: roomCode,
          displayName,
          token: authToken ?? undefined,
          guestId: !authToken && guestId ? guestId : undefined,
          password: password ?? undefined,
        });
      };
      ws.onmessage = (ev) => {
        let parsed: WatchPartyServerMessage;
        try { parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
        if (parsed && typeof parsed.t === 'string') handle(parsed);
      };
      ws.onclose = () => {
        setConnected(false);
        if (cancelled || leftRef.current) return;
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    connect();

    return () => {
      cancelled = true;
      leftRef.current = true;
      if (tickTimerRef.current != null) clearInterval(tickTimerRef.current);
      if (reconnectTimerRef.current != null) clearTimeout(reconnectTimerRef.current);
      if (initialSyncTimerRef.current != null) clearTimeout(initialSyncTimerRef.current);
      typingTimersRef.current.forEach((t) => clearTimeout(t));
      typingTimersRef.current.clear();
      try { wsRef.current?.send(JSON.stringify({ t: 'leave' })); } catch { /* noop */ }
      try { wsRef.current?.close(1000); } catch { /* noop */ }
      wsRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, authToken, guestId, displayName, password]);

  // Host drift heartbeat — 2 Hz. The host plays at natural speed: reset any leftover
  // rate nudge from when we were a guest (e.g. after a host transfer to us).
  useEffect(() => {
    if (!connected || !isHost) return;
    setRate(1);
    tickTimerRef.current = setInterval(() => {
      send({ t: 'host:tick', currentTime: bridgeRef.current.getTime(), isPlaying: !bridgeRef.current.pausedRef.current });
    }, TICK_INTERVAL_MS);
    return () => { if (tickTimerRef.current != null) clearInterval(tickTimerRef.current); };
  }, [connected, isHost, send, setRate]);

  return {
    connected, hostUserId, selfUserId, isHost, participants, chat, activity, typingNames, reactions, error,
    sendChat, toggleReaction, broadcastSeek, broadcastPlay, broadcastPause, sendTyping, announceEpisode, transferHost, leave,
  };
}
