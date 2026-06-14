// Watch-party entry pill — top-right of the player. Single button
// that opens the WatchPartyDrawer. When the user is already in a
// room, the button shows a connection dot + the code so the room is
// legible at a glance; clicking opens the drawer's active-room
// dashboard (participants / chat / leave).

import type { WatchPartyParticipant } from '../../lib/watchParty';

export type WatchPartyButtonProps = {
  onClick: () => void;
  /** When null we render the entry-point label. When set we show
   *  the room status (dot + code + avatar stack). */
  roomCode: string | null;
  connected?: boolean;
  hasPassword?: boolean;
  participants?: WatchPartyParticipant[];
  /** Number of unread chat messages — when > 0 we render a small
   *  red badge in the top-right corner of the pill. Cleared by the
   *  parent when the chat tab becomes visible. */
  unreadCount?: number;
  /** Disabled state — currently only used while a create-room POST
   *  is in flight to avoid double-clicks. */
  busy?: boolean;
};

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

export function WatchPartyButton({
  onClick,
  roomCode,
  connected,
  hasPassword,
  participants,
  unreadCount,
  busy,
}: WatchPartyButtonProps) {
  const unread = unreadCount ?? 0;
  if (roomCode) {
    const list = participants ?? [];
    const visible = list.slice(0, 3);
    const overflow = list.length - visible.length;
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid="wp-room-pill"
        className="pointer-events-auto relative flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-sm font-semibold text-white backdrop-blur shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] hover:bg-white/15"
        aria-label={`Watch party — ${list.length} participant${list.length === 1 ? '' : 's'}${unread > 0 ? `, ${unread} unread message${unread === 1 ? '' : 's'}` : ''}`}
      >
        {unread > 0 ? (
          <span
            className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow ring-2 ring-black/60"
            aria-hidden
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
        <span
          className={
            'h-2 w-2 rounded-full ' + (connected ? 'bg-emerald-400' : 'bg-amber-400')
          }
          aria-hidden
        />
        {visible.length > 0 ? (
          <div className="flex -space-x-2">
            {visible.map((p) => (
              <div
                key={p.userId}
                className="grid h-6 w-6 place-items-center rounded-full border border-black/40 text-[10px] font-semibold leading-none text-white"
                style={{ backgroundColor: avatarBg(p.userId) }}
                title={`${p.displayName}${p.isHost ? ' (host)' : ''}`}
              >
                {initials(p.displayName)}
              </div>
            ))}
            {overflow > 0 ? (
              <div className="grid h-6 w-6 place-items-center rounded-full border border-black/40 bg-white/15 text-[10px] font-semibold leading-none">
                +{overflow}
              </div>
            ) : null}
          </div>
        ) : null}
        <span className="font-mono text-xs uppercase tracking-wide text-white/70">{roomCode}</span>
        {hasPassword ? (
          <span className="text-xs text-white/70" aria-label="Password protected">🔒</span>
        ) : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-testid="wp-open-drawer"
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-sm font-semibold text-white backdrop-blur shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] hover:bg-white/15 disabled:opacity-50"
      aria-label="Watch party"
    >
      <span aria-hidden>👥</span>
      <span>{busy ? 'Starting…' : 'Watch Party'}</span>
    </button>
  );
}
