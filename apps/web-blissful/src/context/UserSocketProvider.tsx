// Persistent WebSocket to blissful-storage at /ws/user. Used for
// real-time friend / party events — no DM payloads anymore. Auto-
// reconnects with exponential backoff and pauses on logout.
//
// Subscribers register via `useUserSocketEvent('party:invite-request',
// fn)` and friends.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';
import { STORAGE_URL, STORAGE_WS_URL } from '../lib/storageBaseUrl';
import { isNativeShell } from '../lib/desktop';

export type PartyInviteRequest = {
  from: { userId: string; displayName: string };
  activity: { type: string; id: string; name: string | null; videoId: string | null };
  at: number;
};

export type PartyInviteAccepted = {
  code: string;
  type: 'movie' | 'series';
  imdbId: string;
  videoId: string | null;
  host: { userId: string; displayName: string };
  at: number;
};

export type PartyRoomClosed = {
  code: string;
  at: number;
};

export type UserSocketEventMap = {
  'party:invite-request': PartyInviteRequest;
  'party:invite-accepted': PartyInviteAccepted;
  'party:room-closed': PartyRoomClosed;
};

type EventName = keyof UserSocketEventMap;
type Handler<E extends EventName> = (payload: UserSocketEventMap[E]) => void;
type Subscribe = <E extends EventName>(event: E, handler: Handler<E>) => () => void;

const UserSocketContext = createContext<{ subscribe: Subscribe } | null>(null);

export function useUserSocket() {
  const ctx = useContext(UserSocketContext);
  if (!ctx) throw new Error('useUserSocket must be used within UserSocketProvider');
  return ctx;
}

/** Subscribe to a single push event for the lifetime of the component. */
export function useUserSocketEvent<E extends EventName>(event: E, handler: Handler<E>) {
  const { subscribe } = useUserSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const off = subscribe(event, (payload) => handlerRef.current(payload));
    return off;
  }, [event, subscribe]);
}

function buildWsUrl(): string {
  if (isNativeShell()) {
    // Desktop: direct WS URL — the shell's HTTP proxy doesn't handle
    // WebSocket upgrades.
    return `${STORAGE_WS_URL}/ws/user`;
  }
  // Web: derive ws(s) from the storage base; Traefik forwards upgrades.
  return `${STORAGE_URL.replace(/^http/, 'ws')}/ws/user`;
}

export function UserSocketProvider({ children }: { children: ReactNode }) {
  const { authKey } = useAuth();
  // Registry of handlers keyed by event name. Every matching message
  // dispatches to every subscribed handler.
  const handlersRef = useRef<Map<EventName, Set<Handler<EventName>>>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  const subscribe = useCallback<Subscribe>((event, handler) => {
    let set = handlersRef.current.get(event);
    if (!set) {
      set = new Set();
      handlersRef.current.set(event, set);
    }
    set.add(handler as Handler<EventName>);
    return () => {
      set!.delete(handler as Handler<EventName>);
      if (set!.size === 0) handlersRef.current.delete(event);
    };
  }, []);

  useEffect(() => {
    const closeExisting = () => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      if (ws && ws.readyState <= 1) {
        try { ws.close(1000, 'auth changed'); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };

    if (!authKey) {
      closeExisting();
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled || !authKey) return;
      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        attemptRef.current = 0;
        try { ws.send(JSON.stringify({ t: 'auth', token: authKey })); } catch { /* ignore */ }
      };
      ws.onmessage = (ev) => {
        let msg: { t?: string } & Record<string, unknown> = {};
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
        } catch {
          return;
        }
        if (!msg || typeof msg.t !== 'string') return;
        const set = handlersRef.current.get(msg.t as EventName);
        if (!set) return;
        // The server sends the event payload flat (event-specific
        // fields directly on the message). Strip the `t` field
        // before handing off so the handler sees a clean payload.
        const { t: _t, ...rest } = msg;
        for (const handler of set) {
          try { handler(rest as UserSocketEventMap[EventName]); } catch { /* ignore */ }
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (cancelled || !authKey) return;
        // Exponential backoff capped at 30s.
        const delay = Math.min(30_000, 500 * Math.pow(2, attemptRef.current));
        attemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => { /* close handler reconnects */ };
    };

    connect();
    return () => {
      cancelled = true;
      closeExisting();
    };
  }, [authKey]);

  const value = useMemo(() => ({ subscribe }), [subscribe]);
  return <UserSocketContext.Provider value={value}>{children}</UserSocketContext.Provider>;
}
