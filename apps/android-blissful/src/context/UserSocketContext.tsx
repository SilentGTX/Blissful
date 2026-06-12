// Persistent per-user WebSocket (`/ws/user`) — the invite/notification channel,
// 1:1 with the desktop UserSocketProvider. Sends {t:'auth',token} on open, fans
// flat {t, ...payload} frames out to subscribers, reconnects with exponential
// backoff, pauses on logout. Separate from the per-room sync socket.
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { getStorageBaseUrl } from '@blissful/core';
import { useAuth } from './AuthContext';

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
export type PartyRoomClosed = { code: string; at: number };

type EventMap = {
  'party:invite-request': PartyInviteRequest;
  'party:invite-accepted': PartyInviteAccepted;
  'party:room-closed': PartyRoomClosed;
};
type EventName = keyof EventMap;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (payload: any) => void;

const Ctx = createContext<{ subscribe: (event: EventName, handler: AnyHandler) => () => void } | null>(null);

function userSocketUrl(): string {
  return `${getStorageBaseUrl().replace(/^http/, 'ws')}/ws/user`;
}

export function UserSocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const handlers = useRef<Map<EventName, Set<AnyHandler>>>(new Map());

  const subscribe = useCallback((event: EventName, handler: AnyHandler) => {
    let set = handlers.current.get(event);
    if (!set) { set = new Set(); handlers.current.set(event, set); }
    set.add(handler);
    return () => { set?.delete(handler); };
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let attempt = 0;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (cancelled || !token) return;
      ws = new WebSocket(userSocketUrl());
      ws.onopen = () => { attempt = 0; try { ws?.send(JSON.stringify({ t: 'auth', token })); } catch { /* closing */ } };
      ws.onmessage = (ev) => {
        let msg: { t?: string } & Record<string, unknown>;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
        if (!msg || typeof msg.t !== 'string') return;
        const set = handlers.current.get(msg.t as EventName);
        if (!set) return;
        const { t: _t, ...rest } = msg; // payload sits FLAT beside `t`
        void _t;
        set.forEach((h) => { try { h(rest); } catch { /* handler threw */ } });
      };
      ws.onclose = () => {
        ws = null;
        if (cancelled || !token) return;
        const delay = Math.min(30_000, 500 * 2 ** attempt);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
    };
    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try { ws?.close(); } catch { /* noop */ }
    };
  }, [token]);

  return <Ctx.Provider value={{ subscribe }}>{children}</Ctx.Provider>;
}

/** Subscribe to a user-socket event for the component's lifetime. */
export function useUserSocketEvent<E extends EventName>(event: E, handler: (payload: EventMap[E]) => void): void {
  const ctx = useContext(Ctx);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(event, (p) => ref.current(p as EventMap[E]));
  }, [ctx, event]);
}
