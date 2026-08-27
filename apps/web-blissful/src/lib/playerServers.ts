// ── VIDEASY DISABLED (2026-08-27) ────────────────────────────────────────────
// Videasy/Vidking is switched OFF. Every web playback now resolves Real-Debrid
// only. Flip this flag back to `true` to restore the entire path — nothing else
// needs editing on the client.
//
// Why it's parked: the path's break-glass rung is a headed Chrome on the Mac
// (infra/scripts/videasy-resolver.py). After a failed resolve on 2026-08-21 it
// was left running and spun 6 CPU cores for six days straight. It had also not
// returned a single source since 2026-07-18 (0-for-4 attempts), so it cost
// ~60 s of stall per play and delivered nothing. The in-process fast path still
// worked, but we're not using Videasy for now, so the whole rung is parked.
//
// Turned off at these entry points — grep `VIDEASY DISABLED` to find them all:
//   1. here (the client flag)
//   2. pages/PlayerPageWeb.tsx  — the resolve effect returns immediately
//   3. App.tsx                  — the orphaned /vidking/* iframe routes
//   4. apps/shared/addon-proxy/server.js — /videasy-sources, /videasy-token and
//      the on-Mac browser resolver all short-circuit (server-side flag is
//      VIDEASY_ENABLED=1 in the proxy env, so the backend reverts without a
//      code change)
// Also parked on the Mac: launchd agent `com.budinoff.videasy-resolver`.
//
// Everything downstream of the resolve (quality picker, subtitle mapping,
// watch-party source encoding) is left intact and simply never receives a
// Videasy source while this is false.
export const VIDEASY_ENABLED = false;

// Bitcine-style "server" list shared by BlissfulPlayer's picker UI and
// PlayerPage's Videasy fetch. Each server maps to an upstream
// Videasy provider name (`cdn`, `mb-flix`, `1movies`, `downloader2`).
// The decorative entries (Neon, Cypher, etc.) reuse `cdn` since
// that's the only backend that consistently returns sources — the
// auto-switch logic in PlayerPage cycles through them when a server
// returns nothing or fails entirely, so the user can still try
// alternates without leaving the player.
export type PlayerServer = {
  id: string;
  name: string;
  flag: string;
  audio: string;
  notes?: string;
  // Upstream Videasy provider used when this server is selected.
  provider: 'cdn' | 'mb-flix' | '1movies' | 'downloader2';
};

export const PLAYER_SERVERS: PlayerServer[] = [
  { id: 'neon', name: 'Neon', flag: '🇺🇸', audio: 'Original audio', provider: 'cdn' },
  { id: 'yoru', name: 'Yoru', flag: '🇺🇸', audio: 'Original audio', notes: 'Movies only, may have 4K', provider: 'cdn' },
  { id: 'cypher', name: 'Cypher', flag: '🇺🇸', audio: 'Original audio', provider: 'cdn' },
  { id: 'sage', name: 'Sage', flag: '🇺🇸', audio: 'Original audio', provider: 'downloader2' },
  { id: 'breach', name: 'Breach', flag: '🇺🇸', audio: 'Original audio', provider: 'cdn' },
  { id: 'vyse', name: 'Vyse', flag: '🇺🇸', audio: 'Original audio', provider: 'cdn' },
  { id: 'killjoy', name: 'Killjoy', flag: '🇩🇪', audio: 'German audio', provider: 'mb-flix' },
  { id: 'harbor', name: 'Harbor', flag: '🇮🇹', audio: 'Italian audio', provider: '1movies' },
  { id: 'chamber', name: 'Chamber', flag: '🇫🇷', audio: 'French audio', notes: 'Only movies', provider: 'downloader2' },
  { id: 'fade', name: 'Fade', flag: '🇹🇷', audio: 'Turkish audio', provider: 'cdn' },
];

// Default to the FIRST server in the list rather than hard-coding an id.
// That way reordering PLAYER_SERVERS automatically changes the default
// without anyone having to remember to update this constant. Falls back
// to 'yoru' only if the list were somehow empty.
export const DEFAULT_SERVER_ID = PLAYER_SERVERS[0]?.id ?? 'yoru';
