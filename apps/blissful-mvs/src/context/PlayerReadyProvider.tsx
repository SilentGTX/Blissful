import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

// Tracks whether BlissfulPlayer / NativeMpvPlayer has finished mounting so
// the AppShell-level PlayerBufferingScreen can be hidden once the real
// player takes over. Without this, hiding the buffering screen relied on
// CSS z-index winning across multiple stacking contexts created by
// Framer Motion's popLayout exit + transform internals, which is brittle.
//
// BlissfulPlayer (and NativeMpvPlayer if applicable) calls `setReady(true)`
// in a mount effect and `setReady(false)` in cleanup. AppShell reads
// `ready` to gate the PlayerBufferingScreen render.

type Ctx = { ready: boolean; setReady: (v: boolean) => void };

const PlayerReadyContext = createContext<Ctx>({
  ready: false,
  setReady: () => { /* no-op default */ },
});

export function usePlayerReady() {
  return useContext(PlayerReadyContext);
}

export function PlayerReadyProvider({ children }: { children: ReactNode }) {
  const [ready, setReadyState] = useState(false);
  const setReady = useCallback((v: boolean) => setReadyState(v), []);
  const value = useMemo(() => ({ ready, setReady }), [ready, setReady]);
  return <PlayerReadyContext.Provider value={value}>{children}</PlayerReadyContext.Provider>;
}
