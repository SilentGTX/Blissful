// useWatchPartyMpv — mpv-adapted watch-party hook. Mirrors the
// structure and protocol of useWatchParty but uses libmpv's desktop
// bridge instead of a <video> element.
//
// Key differences from the <video>-based hook:
//   - getCurrentTime → playbackClock.get() (module-level external store)
//   - seekTo → desktop.seek(seconds, 'absolute')
//   - play/pause → desktop.play() / desktop.pause()
//   - No DOM event listeners — play/pause broadcasts are triggered
//     explicitly by the player component after user actions.
//   - Host tick reads playbackClock.get() + pausedRef for current state.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktop } from './desktop';
import { playbackClock } from '../components/NativeMpvPlayer/playbackClock';
import {
  watchPartyWsUrl,
  type WatchPartyChatMessage,
  type WatchPartyClientMessage,
  type WatchPartyParticipant,
  type WatchPartyServerMessage,
} from './watchParty';
import type { ReactionMap, WatchPartyActivity } from './useWatchParty';

export type UseWatchPartyMpvOptions = {
  /** Room code from the URL or the create-room response. Null disables. */
  roomCode: string | null;
  /** Blissful JWT for signed-in users. Provide this OR `guestId`. */
  authToken: string | null;
  /** Stable per-device id for guest viewers. */
  guestId?: string | null;
  /** Public display name shown to other participants. */
  displayName: string;
  /** Password for password-protected rooms. */
  password?: string | null;
  /** Callback fired on guests when the host changes the current episode. */
  onHostEpisodeChange?: (videoId: string | null) => void;
  /** Ref that tracks the latest paused state from mpv. Read by the
   *  host tick interval to avoid re-rendering on every tick. */
  pausedRef: React.RefObject<boolean>;
};

export type UseWatchPartyMpvResult = {
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

const TICK_DRIFT_TOLERANCE_S = 0.35;
const TICK_INTERVAL_MS = 500;
const RECONNECT_DELAY_MS = 2000;

export function useWatchPartyMpv({
  roomCode,
  authToken,
  guestId,
  displayName,
  password,
  onHostEpisodeChange,
  pausedRef,
}: UseWatchPartyMpvOptions): UseWatchPartyMpvResult {
  const [connected, setConnected] = useState(false);
  const [hostUserId, setHostUserId] = useState<string | null>(null);
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<WatchPartyParticipant[]>([]);
  const [chat, setChat] = useState<WatchPartyChatMessage[]>([]);
  const [activity, setActivity] = useState<WatchPartyActivity[]>([]);
  const [typingMap, setTypingMap] = useState<Map<string, { displayName: string; at: number }>>(() => new Map());
  const [reactions, setReactions] = useState<ReactionMap>({});
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const leftRef = useRef(false);
  const selfIdRef = useRef<string | null>(null);
  const hostIdRef = useRef<string | null>(null);
  // Stamp when we apply a remote action to suppress echo broadcasts.
  const applyingRemoteAtRef = useRef(0);
  // Stamp when the local user performed a play/pause/seek — stale
  // ticks within 1.5s are ignored so the user doesn't bounce back.
  const lastLocalActionAtRef = useRef(0);
  const connectedAtRef = useRef(0);
  const onHostEpisodeChangeRef = useRef(onHostEpisodeChange);
  onHostEpisodeChangeRef.current = onHostEpisodeChange;

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
      // Socket may have closed between the readyState check and send.
    }
  }, []);

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      send({ t: 'chat', text: trimmed });
    },
    [send]
  );

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

  // Explicit play/pause broadcasts for mpv (no DOM events to listen to).
  const broadcastPlay = useCallback(() => {
    if (!connected) return;
    if (Date.now() - applyingRemoteAtRef.current < 600) return;
    lastLocalActionAtRef.current = Date.now();
    send({ t: 'event', kind: 'play', currentTime: playbackClock.get() });
  }, [connected, send]);

  const broadcastPause = useCallback(() => {
    if (!connected) return;
    if (Date.now() - applyingRemoteAtRef.current < 600) return;
    lastLocalActionAtRef.current = Date.now();
    send({ t: 'event', kind: 'pause', currentTime: playbackClock.get() });
  }, [connected, send]);

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
        // Best-effort.
      }
      ws.close(1000, 'left');
    } else if (ws) {
      ws.close();
    }
    setConnected(false);
  }, []);

  // Apply a remote discrete event (play/pause/seek) to mpv.
  const applyHostEvent = useCallback(
    (kind: 'play' | 'pause' | 'seek', currentTime: number, latencyMs: number) => {
      applyingRemoteAtRef.current = Date.now();
      const target = kind === 'pause' ? currentTime : currentTime + latencyMs / 1000;
      desktop.seek(target, 'absolute').catch(() => {});
      if (kind === 'play') {
        desktop.play().catch(() => {});
      } else if (kind === 'pause') {
        desktop.pause().catch(() => {});
      }
    },
    []
  );

  // Periodic tick drift correction — snap mpv's position when it
  // strays beyond the tolerance threshold.
  const applyHostTick = useCallback(
    (currentTime: number, isPlaying: boolean, latencyMs: number) => {
      if (Date.now() - lastLocalActionAtRef.current < 1500) return;
      const expected = isPlaying ? currentTime + latencyMs / 1000 : currentTime;
      const current = playbackClock.get();
      const drift = Math.abs(current - expected);
      if (drift > TICK_DRIFT_TOLERANCE_S) {
        applyingRemoteAtRef.current = Date.now();
        desktop.seek(expected, 'absolute').catch(() => {});
      }
      const isPaused = pausedRef.current;
      if (isPlaying && isPaused) {
        applyingRemoteAtRef.current = Date.now();
        desktop.play().catch(() => {});
      } else if (!isPlaying && !isPaused) {
        applyingRemoteAtRef.current = Date.now();
        desktop.pause().catch(() => {});
      }
    },
    [pausedRef]
  );

  // ---- WebSocket lifecycle ----

  useEffect(() => {
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
          token: authToken ?? undefined,
          guestId: !authToken && guestId ? guestId : undefined,
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
          // Initial sync on join (guest only).
          if (msg.lastTick && msg.self.userId !== msg.hostUserId) {
            applyHostTick(
              msg.lastTick.currentTime,
              msg.lastTick.isPlaying,
              Date.now() - msg.lastTick.at
            );
          }
        } else if (msg.t === 'presence') {
          if (msg.kind === 'joined') {
            setParticipants((prev) => {
              if (prev.some((p) => p.userId === msg.userId)) return prev;
              return [
                ...prev,
                { userId: msg.userId, displayName: msg.displayName, joinedAt: Date.now(), isHost: false },
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
          if (msg.from.userId !== selfIdRef.current) {
            const isHostNow = !!(selfIdRef.current && selfIdRef.current === hostIdRef.current);
            const settling = isHostNow && Date.now() - connectedAtRef.current < 3000;
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

      ws.onerror = () => {};
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, authToken, guestId, displayName, password]);

  // Host tick interval — sends the current mpv position + playing
  // state at 2Hz so guests can drift-correct.
  useEffect(() => {
    if (!connected || !isHost) return;
    tickTimerRef.current = window.setInterval(() => {
      send({
        t: 'host:tick',
        currentTime: playbackClock.get(),
        isPlaying: !pausedRef.current,
      });
    }, TICK_INTERVAL_MS);
    return () => {
      if (tickTimerRef.current != null) {
        window.clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
    };
  }, [connected, isHost, send, pausedRef]);

  // Sweep stale typing entries every second.
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
    sendChat,
    sendTyping,
    broadcastSeek,
    broadcastPlay,
    broadcastPause,
    toggleReaction,
    announceEpisode,
    transferHost,
    leave,
  };
}
