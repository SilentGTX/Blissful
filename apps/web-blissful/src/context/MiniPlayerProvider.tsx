import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getDocPiP, copyStylesToPiP } from '../lib/documentPip';
import { parsePlayerPath, type PlayerTarget } from '../lib/playerUrl';
import { getLastStreamSelection } from '../lib/streamHistory';
import { useAuth } from './AuthProvider';

// Translate a short player path (/player/vidking/<id>/<slug>, /player/rd/…)
// into the internal query string the persistent player already understands.
// This is the ONLY place the short form is expanded — everything downstream
// (PlayerPageWeb, watch party, mini-player) keeps operating on the query
// vocabulary unchanged. What the URL deliberately omits, the player looks up:
// artwork + title from Cinemeta by id, resume position from Continue-Watching
// progress. See lib/playerUrl.ts for the URL scheme rationale.
function shortPathToSearch(target: PlayerTarget, search: string, authKey: string | null): string {
  const qs = new URLSearchParams();
  qs.set('type', target.type);
  qs.set('id', target.id);
  if (target.videoId) qs.set('videoId', target.videoId);
  if (target.source === 'rd') {
    // Warm open (the user's own history): replay the exact saved RD stream.
    // Cold open (a shared rd link, nothing saved locally): re-resolve and let
    // the RD releases picker take over rather than guessing a stale URL.
    const saved = getLastStreamSelection({ authKey, type: target.type, id: target.id, videoId: target.videoId });
    if (saved?.url && /\/resolve\/realdebrid\//i.test(saved.url)) {
      qs.set('url', saved.url);
      qs.set('rdsel', '1');
      if (saved.title) qs.set('title', saved.title);
    } else {
      qs.set('url', 'vidking:placeholder');
      qs.set('pickReleases', '1');
    }
  } else {
    // auto (default, and what the detail page / Continue-Watching emit on web;
    // `vidking` is the legacy alias): resolve fresh. Profiles with an RD key go
    // RD-first, everyone else vidking-first — the player decides from its own
    // settings, so nothing authKey-dependent here (a late auth hydration
    // doesn't re-seed the session). If vidking's CDN is down the player's own
    // RD fallback covers it (see PlayerPageWeb). The internal placeholder token
    // stays `vidking:placeholder` — it's not user-visible (the address bar
    // keeps the short /player/auto/… path).
    qs.set('url', 'vidking:placeholder');
  }
  // Query extras riding on the short path refine the expansion: ?t=0
  // (start-over — without it the player auto-resumes from CW progress),
  // ?pickReleases=1, ?room=<code> (watch-party invite). They never
  // OVERRIDE it — url/type/id derived from the path always win, so a
  // crafted ?url=… can't smuggle a different stream into a short link.
  for (const [k, v] of new URLSearchParams(search)) {
    if (!qs.has(k)) qs.set(k, v);
  }
  return qs.toString();
}

// ─────────────────────────────────────────────────────────────────────────
// Mini-player / persistent-player session.
//
// The web player normally lives inside the /player route, so navigating away
// unmounts the <video> and playback stops. To support a YouTube-style
// mini-player — keep playing while you browse, click to expand back — the
// player is hoisted OUT of the route into a single persistent instance mounted
// in AppShell (see PersistentPlayerHost). This context owns the active playback
// "session" (the /player query string) plus, when available, the real
// Document-PiP OS window the mini player is shown in.
//
//   • The /player route renders only <PlayerSeeder/>, which pushes the current
//     query string into the session (it does NOT render the player itself).
//   • PersistentPlayerHost renders the real player whenever a session is active.
//   • `mode` is 'full' on /player, 'mini' after an explicit PiP (minimize),
//     and null otherwise.
//   • `minimize` opens a real Document Picture-in-Picture window (Chromium +
//     secure context) so the mini player is a true OS window that can be moved
//     to any monitor. requestWindow() needs transient user activation, so it is
//     called SYNCHRONOUSLY here inside the click gesture. When the API is
//     unavailable (non-Chromium / insecure context) pipWindow stays null and
//     the host renders the in-page floating window instead.
// ─────────────────────────────────────────────────────────────────────────

export type PlayerSession = {
  /** The /player query string, including the leading '?'. The persistent
   *  player reads all its params from here instead of live useSearchParams. */
  search: string;
  /** Stable identity for the session — bumped only when a DIFFERENT video is
   *  opened, so re-entering /player for the same video keeps playing. */
  key: string;
};

type Mode = 'full' | 'mini';

type MiniPlayerCtx = {
  session: PlayerSession | null;
  mode: Mode | null;
  params: URLSearchParams;
  /** The real Document-PiP window when the mini player is shown in one
   *  (Chromium + secure context). null for the in-page fallback / not mini. */
  pipWindow: Window | null;
  open: (search: string) => void;
  close: () => void;
  minimize: () => void;
  expand: () => void;
};

const Ctx = createContext<MiniPlayerCtx | null>(null);

export function MiniPlayerProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<PlayerSession | null>(null);
  // `minimized` is set ONLY by the explicit PiP button. Leaving /player any
  // other way (back button, a nav link) closes the player instead of shrinking
  // it — so PiP is opt-in, never automatic.
  const [minimized, setMinimized] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const onPlayer = location.pathname.startsWith('/player');

  // Remember the last page the user was actually browsing (NOT a /player URL),
  // so minimize returns there. navigate(-1) was buggy: history is full of
  // /player entries, so "back" could land on a DIFFERENT episode's /player URL.
  const lastNonPlayerRef = useRef('/');
  useEffect(() => {
    if (!onPlayer) lastNonPlayerRef.current = location.pathname + location.search;
  }, [onPlayer, location.pathname, location.search]);

  // Mirror session into a ref so the PiP window's native listeners (attached
  // once, in a single render's closure) always read the current session.
  const sessionRef = useRef<PlayerSession | null>(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // The live PiP window + a flag so OUR programmatic close (expand / ✕) doesn't
  // get mistaken for the user closing the OS window (which tears down the
  // session via the 'pagehide' listener below).
  const pipRef = useRef<Window | null>(null);
  const closingPipRef = useRef(false);
  const dropPip = useCallback(() => {
    const win = pipRef.current;
    pipRef.current = null;
    setPipWindow(null);
    if (win) {
      closingPipRef.current = true;
      try { win.close(); } catch { /* noop */ }
      closingPipRef.current = false;
    }
  }, []);

  const open = useCallback((search: string) => {
    setMinimized(false); // entering /player is always full-screen
    setSession((prev) => {
      if (prev && prev.search === search) return prev;
      return { search, key: `${search.length}:${Math.floor(performance.now())}` };
    });
  }, []);

  const close = useCallback(() => {
    dropPip();
    setSession(null);
    setMinimized(false);
    if (location.pathname.startsWith('/player')) navigate(lastNonPlayerRef.current || '/');
  }, [dropPip, location.pathname, navigate]);

  const expand = useCallback(() => {
    dropPip();
    const s = sessionRef.current;
    if (s) navigate(`/player${s.search}`);
  }, [dropPip, navigate]);

  const minimize = useCallback(() => {
    // Open the real OS-level PiP window SYNCHRONOUSLY inside the click gesture —
    // requestWindow() needs transient user activation, which a deferred effect
    // would lose. Only available in a secure context (https / localhost);
    // otherwise this no-ops and the host renders the in-page mini window.
    const dpip = getDocPiP();
    if (dpip && !pipRef.current) {
      dpip
        .requestWindow({ width: 480, height: 270 })
        .then((win) => {
          // Register the window FIRST so a later style-copy error can't strand
          // it (the host reparents the player in as soon as pipWindow is set).
          pipRef.current = win;
          win.addEventListener('pagehide', () => {
            if (closingPipRef.current) return; // our own programmatic close
            pipRef.current = null;
            setPipWindow(null);
            setSession(null); // user closed the OS window → tear down
            setMinimized(false);
          });
          // Escape hatch independent of React's (cross-document) event system:
          // double-click anywhere in the PiP window expands back to full.
          win.document.addEventListener('dblclick', () => expand());
          try { copyStylesToPiP(win); } catch { /* styles are best-effort */ }
          setPipWindow(win);
        })
        .catch(() => { /* unsupported / blocked → native / in-page fallback */ });
    }
    setMinimized(true);
    navigate(lastNonPlayerRef.current || '/');
  }, [navigate, expand]);

  // If we've left /player WITHOUT an explicit PiP, the player is done — close
  // it (back button, nav links, etc.).
  useEffect(() => {
    if (session && !onPlayer && !minimized) setSession(null);
  }, [onPlayer, minimized, session]);

  const mode: Mode | null = !session ? null : onPlayer ? 'full' : minimized ? 'mini' : null;

  // Safety net: any time we're no longer showing the mini player, make sure the
  // PiP window is closed (covers teardown paths that don't go through
  // close()/expand(), e.g. session cleared by the effect above).
  useEffect(() => {
    if (mode !== 'mini' && pipRef.current) dropPip();
  }, [mode, dropPip]);

  const params = useMemo(() => new URLSearchParams(session?.search ?? ''), [session?.search]);

  const value = useMemo(
    () => ({ session, mode, params, pipWindow, open, close, minimize, expand }),
    [session, mode, params, pipWindow, open, close, minimize, expand],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMiniPlayer(): MiniPlayerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMiniPlayer must be used within MiniPlayerProvider');
  return v;
}

/** Rendered by the /player route. Seeds the session from the URL and renders
 *  nothing — the actual player lives persistently in PersistentPlayerHost. */
export function PlayerSeeder() {
  const { open } = useMiniPlayer();
  const { authKey } = useAuth();
  const location = useLocation();
  useEffect(() => {
    // Short path (/player/vidking/…, /player/rd/…) → expand to the internal
    // query form; legacy /player?… passes through as-is.
    const target = parsePlayerPath(location.pathname);
    open(target ? shortPathToSearch(target, location.search, authKey) : location.search);
  }, [open, location.pathname, location.search, authKey]);
  return null;
}
