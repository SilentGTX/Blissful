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
