// Watch-party invite landing page. Shown when someone opens an
// invite link like `https://blissful.budinoff.com/invite/xxx-yyy`.
//
// Renders the title, episode info, poster/backdrop, and a big
// Continue button. Clicking Continue is the user gesture that the
// player needs to autoplay successfully on browsers that block
// gesture-less media. We pre-stash a password if required, then
// hand off to /player.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  buildRoomPlayerUrl,
  getWatchPartyRoom,
  stashWatchPartyPassword,
  verifyWatchPartyPassword,
  type WatchPartyRoomInfo,
} from '../lib/watchParty';
import { fetchMeta, type StremioMetaDetail } from '../lib/stremioAddon';
import { normalizeStremioImage } from '../lib/mediaTypes';
import { proxiedImage } from '../lib/imageProxy';
import { parseSeriesInfo } from '../lib/playerEnv';
import type { MediaType } from '../types/media';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'ready'; room: WatchPartyRoomInfo; meta: StremioMetaDetail | null };

export default function InvitePage() {
  const navigate = useNavigate();
  const { code: rawCode } = useParams<{ code: string }>();
  const code = (rawCode ?? '').toLowerCase();

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setState({ kind: 'not-found' });
      return;
    }
    let cancelled = false;
    (async () => {
      const room = await getWatchPartyRoom(code);
      if (cancelled) return;
      if (!room) {
        setState({ kind: 'not-found' });
        return;
      }
      let meta: StremioMetaDetail | null = null;
      try {
        meta = await fetchMeta({ type: room.type as MediaType, id: room.imdbId });
      } catch {
        // best-effort — landing page still renders without it.
      }
      if (cancelled) return;
      setState({ kind: 'ready', room, meta });
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const episodeInfo = useMemo(() => {
    if (state.kind !== 'ready' || state.room.type !== 'series' || !state.room.videoId) {
      return null;
    }
    const parsed = parseSeriesInfo(state.room.videoId);
    if (!parsed) return null;
    const epMeta = state.meta?.meta?.videos?.find((v) => v.id === state.room.videoId);
    const epTitle = epMeta?.title ?? epMeta?.name ?? null;
    const label =
      parsed.season != null && parsed.episode != null
        ? `S${String(parsed.season).padStart(2, '0')}E${String(parsed.episode).padStart(2, '0')}`
        : null;
    return { label, title: epTitle };
  }, [state]);

  const handleJoin = async () => {
    if (state.kind !== 'ready' || joining) return;
    const { room } = state;
    setJoining(true);
    setJoinError(null);
    try {
      if (room.hasPassword) {
        const trimmed = password.trim();
        if (!trimmed) {
          setJoinError('Enter the room password to continue');
          setJoining(false);
          return;
        }
        const result = await verifyWatchPartyPassword(room.code, trimmed);
        if (result !== 'ok') {
          setJoinError(
            result === 'wrong-password'
              ? 'Incorrect password'
              : result === 'no-room'
                ? 'Room expired or was closed'
                : 'Failed to verify password'
          );
          setJoining(false);
          return;
        }
        stashWatchPartyPassword(room.code, trimmed);
      }
      const url = await buildRoomPlayerUrl(room);
      navigate(url);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Failed to join party');
      setJoining(false);
    }
  };

  const room = state.kind === 'ready' ? state.room : null;
  const meta = state.kind === 'ready' ? state.meta?.meta : null;
  const titleText = meta?.name ?? null;
  const poster = normalizeStremioImage(meta?.poster ?? null) ?? null;
  const background = normalizeStremioImage(meta?.background ?? null) ?? poster;
  const logo = (meta as { logo?: string | null } | null | undefined)?.logo ?? null;
  const description = meta?.description ?? null;

  return (
    <div className="fixed inset-0 z-[80] overflow-hidden bg-black text-white">
      {/* Backdrop — full-bleed poster/backdrop with heavy darken so
          the foreground content stays readable. */}
      {background ? (
        <img
          src={proxiedImage(background)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-50"
          draggable={false}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/70 to-black/40" />

      <div className="relative flex h-full w-full items-center justify-center p-6">
        <div className="w-full max-w-xl">
          {state.kind === 'loading' ? (
            <div className="text-center text-white/70">Loading invite…</div>
          ) : state.kind === 'not-found' ? (
            <div className="rounded-3xl border border-white/15 bg-black/65 p-8 text-center backdrop-blur-xl">
              <div className="text-2xl font-semibold">Room not found</div>
              <div className="mt-2 text-sm text-white/60">
                This watch party has ended or the code is wrong. Ask your friend
                for a new link.
              </div>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="mt-6 cursor-pointer rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-white/90"
              >
                Go to Blissful
              </button>
            </div>
          ) : (
            <div className="rounded-3xl border border-white/10 bg-black/55 p-6 shadow-2xl backdrop-blur-2xl md:p-8">
              <div className="text-xs uppercase tracking-[0.25em] text-[var(--bliss-accent)]">
                You're invited to a Watch Party
              </div>

              <div className="mt-4 flex items-start gap-4">
                {poster ? (
                  <img
                    src={proxiedImage(poster)}
                    alt=""
                    className="h-32 w-22 shrink-0 rounded-2xl object-cover shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] md:h-40 md:w-28"
                    draggable={false}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  {logo ? (
                    <img
                      src={proxiedImage(logo)}
                      alt={titleText ?? ''}
                      className="mb-2 max-h-12 w-auto object-contain drop-shadow md:max-h-16"
                      draggable={false}
                    />
                  ) : (
                    <div className="text-xl font-bold md:text-2xl">
                      {titleText ?? 'Watch party'}
                    </div>
                  )}
                  {episodeInfo ? (
                    <div className="text-sm text-white/80">
                      {episodeInfo.label}
                      {episodeInfo.title ? <> · {episodeInfo.title}</> : null}
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-center gap-2 text-xs text-white/55">
                    <span>
                      Room <span className="font-mono uppercase tracking-wider text-white/85">{room!.code}</span>
                    </span>
                    {room!.hasPassword ? (
                      <span title="Password protected" aria-label="Password protected">🔒</span>
                    ) : null}
                    <span>·</span>
                    <span>
                      {room!.participantCount}
                      {' '}
                      {room!.participantCount === 1 ? 'person' : 'people'} in the room
                    </span>
                  </div>
                </div>
              </div>

              {description ? (
                <div className="mt-4 line-clamp-3 text-sm text-white/65">
                  {description}
                </div>
              ) : null}

              {room!.hasPassword ? (
                <div className="mt-5">
                  <label className="text-[11px] uppercase tracking-[0.2em] text-white/55">
                    Room password
                  </label>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (joinError) setJoinError(null);
                    }}
                    placeholder="Enter password"
                    autoComplete="off"
                    spellCheck={false}
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-bwignore="true"
                    data-form-type="other"
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-[var(--bliss-accent)] focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleJoin();
                      }
                    }}
                  />
                </div>
              ) : null}

              {joinError ? (
                <div className="mt-3 text-sm text-red-400">{joinError}</div>
              ) : null}

              <button
                type="button"
                onClick={() => void handleJoin()}
                disabled={joining}
                data-testid="wp-invite-continue"
                // Hover stays on the same accent color — just nudges
                // brightness with `brightness-95` so the feedback is
                // a subtle dim, not a different colour. The old
                // `hover:bg-[#14dbb8]` shifted to a noticeably
                // different teal which felt off.
                className="mt-6 w-full cursor-pointer rounded-full bg-[var(--bliss-accent)] px-6 py-3 text-base font-semibold text-black shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] transition hover:brightness-95 disabled:opacity-60"
              >
                {joining ? 'Joining…' : 'Continue'}
              </button>

              {/* Same height + padding as Continue so the two CTAs
                  read as a paired stack; the secondary action stays
                  visually quieter via colour + weight, not size. */}
              <button
                type="button"
                onClick={() => navigate('/')}
                className="mt-2 w-full cursor-pointer rounded-full border border-white/15 bg-white/5 px-6 py-3 text-base font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                Not now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
