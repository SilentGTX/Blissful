import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMiniPlayer } from '../context/MiniPlayerProvider';
import { useAddons } from '../context/AddonsProvider';
import { useAuth } from '../context/AuthProvider';
import { useStorage } from '../context/StorageProvider';
import BlissfulPlayer from '../components/BlissfulPlayer';
import type { PlayerSettings } from '../lib/playerSettings';
import { useMetaDetails } from '../models/useMetaDetails';
import { fetchTmdbId, type TmdbLookup } from '../lib/tmdb';
import { PLAYER_SERVERS, DEFAULT_SERVER_ID } from '../lib/playerServers';
import { getLibraryEntry } from '../lib/libraryStore';
import { useContinueWatchingContext } from '../context/ContinueWatchingProvider';
import { normalizeStremioImage } from '../lib/mediaTypes';
import { fetchStreams, type StremioStream } from '../lib/stremioAddon';

// Container formats the browser can't play natively — routed through the
// proxy's /transcode endpoint (remux/re-encode to fragmented MP4).
const TRANSCODE_CONTAINER_RE = /\.(mkv|avi|m2ts|wmv|flv|ogm)(\?|#|$)/i;

// Global videasy cooldown. Videasy's bad days are upstream-WIDE: manifests
// mint alive and die seconds later on EVERY episode, so each fresh resolve
// passes the health probe and then collapses mid-play — the player churns
// videasy → death → RD on every single episode/session. Once a videasy
// source is declared dead (pre-play probe or mid-playback), skip videasy
// entirely for a while and go straight to the RD fallback: quiet, instant
// playback instead of a doomed first act. sessionStorage so it survives
// reloads within the tab; self-lifts after the window; a MANUAL server pick
// clears it (the user explicitly asked to try videasy again).
const VIDEASY_COOLDOWN_KEY = 'bliss:videasyCooldownUntil';
const VIDEASY_COOLDOWN_MS = 10 * 60 * 1000;
function videasyCooldownActive(): boolean {
  try {
    const raw = sessionStorage.getItem(VIDEASY_COOLDOWN_KEY);
    return !!raw && Date.now() < Number(raw);
  } catch { return false; }
}
function startVideasyCooldown(): void {
  try { sessionStorage.setItem(VIDEASY_COOLDOWN_KEY, String(Date.now() + VIDEASY_COOLDOWN_MS)); } catch { /* noop */ }
}
function clearVideasyCooldown(): void {
  try { sessionStorage.removeItem(VIDEASY_COOLDOWN_KEY); } catch { /* noop */ }
}
import { getResumeSeconds, openInVlc } from '../layout/app-shell/utils';
import { parseStreamDescription } from '../features/detail/utils';
import { releaseMatchesShow } from '../lib/fallbackReleases';
import BottomDrawer from '../components/BottomDrawer';

type AddonStreamEntry = {
  /** Stream addon `name` field — usually two lines like "Torrentio\n1080p". */
  name: string;
  /** Torrent / file name parsed from the addon description (line 1). */
  torrentName: string | null;
  /** Full Stremio description (kept for the "title" tooltip + fallback). */
  description: string;
  /** Final URL handed to VLC: either an HTTPS stream URL (RD) or a
   *  `magnet:?xt=urn:btih:…` URI built from infoHash + trackers. */
  url: string;
  /** Detected resolution token: 2160p / 1080p / 720p / 480p / 360p / null. */
  quality: string | null;
  /** Seeders count as a string (e.g. "430") or null. */
  seeders: string | null;
  /** Size with unit (e.g. "817.21 MB") or null. */
  size: string | null;
  /** Source site (e.g. "ThePirateBay") or null. */
  site: string | null;
  addonName: string;
  /** Real-Debrid / Premiumize pre-resolved HTTPS URL. */
  isRd: boolean;
  /** Raw magnet / torrent (no debrid). VLC opens via libtorrent. */
  isMagnet: boolean;
};


/**
 * Mobile-only fallback UI. Renders a fullscreen list of every
 * Torrentio / Torrentio-RD stream returned by the user's addons,
 * laid out exactly like the desktop detail page's StreamList
 * (left label "Torrentio\nQUALITY" · torrent filename ·
 * 👤 seeders 💾 size ⚙️ site). Tapping a row pops the shared
 * `BottomDrawer` (drag-down-to-close, like Continue Watching)
 * with a Play in VLC button.
 */
function MobileStreamPicker({
  streams,
  onBack,
}: {
  streams: AddonStreamEntry[];
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<AddonStreamEntry | null>(null);
  // Probe every Torrentio /resolve/realdebrid/… URL in parallel
  // against our /resolve-url endpoint. The endpoint follows the
  // 302 to the actual download host — RD removes DMCA'd files by
  // redirecting to `failed_infringement_v2.mp4`. Any URL that
  // lands there gets dropped from the list before the user sees
  // it, so they don't tap a stream that won't actually play.
  const [deadUrls, setDeadUrls] = useState<Set<string>>(new Set());
  const [probing, setProbing] = useState<boolean>(streams.length > 0);
  useEffect(() => {
    if (streams.length === 0) { setProbing(false); return; }
    // Only Torrentio /resolve/realdebrid/… URLs can 302 to the
    // takedown notice. Raw magnets / direct HTTPS go straight to
    // VLC so there's nothing to probe.
    const probeable = streams.filter((s) => !s.isMagnet && /\/resolve\//i.test(s.url));
    if (probeable.length === 0) { setProbing(false); return; }
    setProbing(true);
    let cancelled = false;
    // 20 MB threshold below which a stream is treated as a takedown
    // placeholder. Real episodes weigh in at 200+ MB even for 480p
    // SD; the "File removed from debrid service due to copyright"
    // clip Torrentio/RD hand back is ~2 MB. Anything between is
    // unlikely to be real video and not worth showing.
    const MIN_REAL_BYTES = 20 * 1024 * 1024;
    void Promise.allSettled(
      probeable.map((s) =>
        fetch(`/resolve-url?url=${encodeURIComponent(s.url)}`)
          .then((r) => r.ok ? r.json() : null)
          .then((data: { finalUrl?: string; status?: number; contentLength?: number } | null) => {
            if (!data) return null;
            if (typeof data.status === 'number' && data.status >= 400) return s.url;
            if (data.finalUrl && /failed_infringement/i.test(data.finalUrl)) return s.url;
            // Tiny payload = takedown placeholder (RD sometimes
            // still hosts the entry but the bytes are just a
            // 30-second "removed for copyright" notice clip).
            if (typeof data.contentLength === 'number' && data.contentLength > 0 && data.contentLength < MIN_REAL_BYTES) {
              return s.url;
            }
            return null;
          })
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      const dead = new Set<string>();
      for (const r of results) if (r.status === 'fulfilled' && r.value) dead.add(r.value);
      setDeadUrls(dead);
      setProbing(false);
    });
    return () => { cancelled = true; };
  }, [streams]);
  const liveStreams = useMemo(() => streams.filter((s) => !deadUrls.has(s.url)), [streams, deadUrls]);
  // Group by resolution bucket — same order the detail page uses
  // (4K → 1080p → 720p → SD → Other). RD streams are sorted to the
  // top within each bucket because they're the most likely to
  // actually play.
  const grouped = useMemo(() => {
    type Bucket = '4K' | '1080p' | '720p' | 'SD' | 'Other';
    const bucketOf = (s: AddonStreamEntry): Bucket => {
      const q = (s.quality ?? '').toLowerCase();
      if (q === '2160p' || q === '4k') return '4K';
      if (q === '1080p') return '1080p';
      if (q === '720p') return '720p';
      if (q === '480p' || q === '360p') return 'SD';
      return 'Other';
    };
    const buckets: Record<Bucket, AddonStreamEntry[]> = {
      '4K': [], '1080p': [], '720p': [], SD: [], Other: [],
    };
    for (const s of liveStreams) buckets[bucketOf(s)].push(s);
    for (const k of Object.keys(buckets) as Bucket[]) {
      buckets[k].sort((a, b) => {
        if (a.isRd !== b.isRd) return a.isRd ? -1 : 1;
        const sa = a.seeders ? Number.parseInt(a.seeders, 10) : 0;
        const sb = b.seeders ? Number.parseInt(b.seeders, 10) : 0;
        return sb - sa;
      });
    }
    return buckets;
  }, [liveStreams]);

  const renderRow = (s: AddonStreamEntry, idx: number) => (
    <button
      key={`${s.url}|${idx}`}
      type="button"
      className="flex w-full cursor-pointer items-start gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-left transition hover:bg-white/[0.08]"
      onClick={() => setSelected(s)}
    >
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 break-words text-sm font-semibold leading-snug text-white">
          {s.torrentName ?? s.description ?? s.name}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/60">
          {s.seeders ? <span>👤 {s.seeders}</span> : null}
          {s.size ? <span>💾 {s.size}</span> : null}
          {s.site ? <span>⚙️ {s.site}</span> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {s.quality ? (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80">
              {s.quality}
            </span>
          ) : null}
          {s.isRd ? (
            <span className="rounded bg-[var(--bliss-accent)]/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--bliss-accent)]">
              RD
            </span>
          ) : s.isMagnet ? (
            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              Torrent
            </span>
          ) : null}
          <span className="truncate text-[10px] text-white/50">{s.name.split('\n')[0]}</span>
        </div>
      </div>
    </button>
  );

  const order: Array<'4K' | '1080p' | '720p' | 'SD' | 'Other'> = ['4K', '1080p', '720p', 'SD', 'Other'];

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-black text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 pb-3 pt-[max(env(safe-area-inset-top),16px)]">
        <button
          type="button"
          aria-label="Back"
          className="cursor-pointer rounded-full bg-white/10 p-2 hover:bg-white/15"
          onClick={onBack}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">Pick a stream</div>
          <div className="truncate text-[11px] text-white/60">Vidking is unavailable — tap a stream, open in VLC</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {probing ? (
          <div className="rounded-2xl bg-white/5 px-4 py-3 text-center text-xs text-white/60">
            Checking availability…
          </div>
        ) : null}
        {!probing && liveStreams.length === 0 ? (
          <div className="rounded-2xl bg-white/5 px-4 py-8 text-center text-sm text-white/60">
            No playable streams. All Real-Debrid links for this title
            were taken down.
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-5 pb-6">
            {order.map((bucket) =>
              grouped[bucket].length > 0 ? (
                <section key={bucket}>
                  <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">
                    {bucket}
                  </div>
                  <div className="flex flex-col gap-2">
                    {grouped[bucket].map(renderRow)}
                  </div>
                </section>
              ) : null,
            )}
          </div>
        )}
      </div>

      <BottomDrawer
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={(() => {
          if (!selected) return undefined;
          const parts: string[] = [];
          if (selected.quality) parts.push(selected.quality.toUpperCase());
          if (selected.isRd) parts.push('REAL-DEBRID');
          else if (selected.isMagnet) parts.push('TORRENT');
          return parts.join(' · ') || undefined;
        })()}
        subtitle={selected?.torrentName ?? selected?.description ?? undefined}
      >
        {selected ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/65">
              {selected.seeders ? <span>👤 {selected.seeders}</span> : null}
              {selected.size ? <span>💾 {selected.size}</span> : null}
              {selected.site ? <span>⚙️ {selected.site}</span> : null}
            </div>
            <button
              type="button"
              className="mt-4 block w-full cursor-pointer rounded-2xl bg-[var(--bliss-accent)] py-4 text-base font-semibold text-black transition hover:bg-[#14dbb8]"
              onClick={() => {
                openInVlc(selected.url);
              }}
            >
              Play in VLC
            </button>
            <button
              type="button"
              className="mt-2 block w-full cursor-pointer rounded-2xl bg-white/10 py-3 text-sm font-medium text-white hover:bg-white/15"
              onClick={() => setSelected(null)}
            >
              Cancel
            </button>
          </>
        ) : null}
      </BottomDrawer>
    </div>
  );
}

// Fire-and-forget log sink that also writes to /player-log on the
// addon-proxy (host file /Volumes/2TB/NAS/blissful/logs/addon-proxy/
// player.log) so iOS sessions can be inspected without Web Inspector.
function sendPlayerLog(line: string): void {
  // eslint-disable-next-line no-console
  console.info(line);
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : '';
    fetch('/player-log', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: `[${ua}] ${line}`,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* navigator/fetch unavailable — ignore */
  }
}

type VideasySource = { url: string; quality?: string };
type VideasySubtitle = { url?: string; file?: string; lang?: string; label?: string };

// Rank video sources for instant playback in <video>. Prefer 1080P,
// then 720P (common, fast first-frame); ORG (original) tends to be
// 4K and can be slow to start on average connections. Tiebreak by
// position to preserve the API's own ordering.
function rankSource(s: VideasySource): number {
  const q = (s.quality || '').toLowerCase();
  if (q.includes('1080')) return 5;
  if (q.includes('720')) return 4;
  if (q.includes('480')) return 3;
  if (q.includes('org') || q.includes('original')) return 2;
  return 1;
}

export type NextEpisodeInfo = {
  nextVideoId: string;
  nextEpisodeTitle: string;
  nextSeason: number | null;
  nextEpisode: number | null;
  nextThumbnail: string | null;
  /** ISO timestamp of when the next episode airs/aired. Null when the
   *  addon doesn't provide it. When set and in the future, the player's
   *  next-episode button is disabled with an explanatory tooltip. */
  nextReleased: string | null;
};

type MetaVideo = {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  thumbnail?: string;
  released?: string;
};

/** Compute the next episode from the full video list, mirroring useEpisodeSelection logic. */
function computeNextEpisode(currentVideoId: string, videos: MetaVideo[]): NextEpisodeInfo | null {
  const current = videos.find((v) => v.id === currentVideoId);
  if (!current) return null;

  const currentSeason = current.season;

  if (typeof currentSeason === 'number') {
    const seasonEps = videos
      .filter((v) => v.season === currentSeason)
      .slice()
      .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));

    const idx = seasonEps.findIndex((v) => v.id === currentVideoId);

    if (idx !== -1 && idx < seasonEps.length - 1) {
      return formatNextInfo(seasonEps[idx + 1]);
    }

    // Last episode in season — try first episode of next season
    const allSeasons = [
      ...new Set(
        videos.filter((v) => typeof v.season === 'number').map((v) => v.season as number),
      ),
    ].sort((a, b) => a - b);
    const sIdx = allSeasons.indexOf(currentSeason);
    if (sIdx >= 0 && sIdx < allSeasons.length - 1) {
      const nextSeasonEps = videos
        .filter((v) => v.season === allSeasons[sIdx + 1])
        .slice()
        .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
      if (nextSeasonEps.length > 0) return formatNextInfo(nextSeasonEps[0]);
    }
  } else {
    // No season info — linear list
    const idx = videos.findIndex((v) => v.id === currentVideoId);
    if (idx !== -1 && idx < videos.length - 1) {
      return formatNextInfo(videos[idx + 1]);
    }
  }

  return null;
}

function formatNextInfo(v: MetaVideo): NextEpisodeInfo {
  const s = typeof v.season === 'number' ? v.season : null;
  const e = typeof v.episode === 'number' ? v.episode : typeof v.number === 'number' ? v.number : null;
  const title = v.title ?? v.name ?? v.id;
  const prefix = s !== null && e !== null ? `S${s}E${e}` : '';
  const nextLabel = `${prefix}${prefix && title ? ' \u2014 ' : ''}${title}`.trim();
  return {
    nextVideoId: v.id,
    nextEpisodeTitle: nextLabel,
    nextSeason: s,
    nextEpisode: e,
    nextThumbnail: v.thumbnail ?? null,
    nextReleased: typeof v.released === 'string' && v.released.length > 0 ? v.released : null,
  };
}

export default function PlayerPage() {
  const { addons } = useAddons();
  const { authKey } = useAuth();
  const { playerSettings } = useStorage();
  // Params come from the persistent mini-player session (the /player route
  // only seeds it) — NOT live useSearchParams, so the player keeps its params
  // after you navigate away and it shrinks to the mini window.
  const { params: searchParams, mode: playerMode, minimize, expand, close: closeMiniPlayer } = useMiniPlayer();
  const compact = playerMode === 'mini';
  const [resolvedPlayerSettings, setResolvedPlayerSettings] = useState<PlayerSettings>(playerSettings);

  useEffect(() => {
    setResolvedPlayerSettings(playerSettings);
  }, [playerSettings]);

  // Tracks whether BlissfulPlayer has been mounted with a real
  // (non-placeholder) URL at least once during this PlayerPage
  // lifetime. Used to skip the early black-div gate on subsequent
  // transitions so the watch-party WS stays alive across episode
  // changes — otherwise the host disconnects mid-transition and
  // server-side host migration promotes the longest-attached guest.
  const hasShownPlayerRef = useRef(false);

  // (Previously fetched /storage/settings here on player mount. Removed:
  // playerSettings already arrives via AppContext from useStoredStateSync
  // which loads /storage/state including the playerSettings field. The
  // separate /storage/settings endpoint can return stale or sparse data
  // that overwrites the freshly loaded state — visible as the player
  // appearing to "forget" subtitle prefs after a restart.)

  const url = useMemo(() => {
    return searchParams.get('url');
  }, [searchParams]);

  const title = searchParams.get('title');
  const posterParam = searchParams.get('poster');
  const backgroundParam = searchParams.get('background');
  const metaTitleParam = searchParams.get('metaTitle');
  const type = searchParams.get('type');
  const id = searchParams.get('id');
  // Logo: URL param wins (legacy long links stamp it), else the same metahub
  // logo DetailPage always used. Short URLs carry NO artwork params, and the
  // in-player BufferingOverlay is logo-only — without this fallback the
  // centered buffering image simply vanished on every short-URL session.
  const logoParam = searchParams.get('logo');
  const logo = logoParam
    ?? (id && /^tt\d+$/.test(id) ? `https://images.metahub.space/logo/medium/${id}/img` : null);

  // Fallback poster (same source the ResumeOrStartOver modal uses)
  // — reach for the user's library / continue-watching entry when
  // no poster URL was passed in and meta hasn't loaded yet.
  const { continueWatching } = useContinueWatchingContext();
  const libraryFallbackPoster = useMemo(() => {
    if (!id || !type) return null;
    const cw = continueWatching.find((it) => it._id === id && it.type === type)?.poster;
    if (cw) return normalizeStremioImage(cw) ?? null;
    const lib = getLibraryEntry({ type, id })?.poster;
    return lib ? normalizeStremioImage(lib) ?? null : null;
  }, [continueWatching, id, type]);
  const videoId = searchParams.get('videoId');
  const roomCode = searchParams.get('room');
  // "Play with RD" pick-first mode: skip Videasy entirely and let the user
  // choose a torrent from the Releases picker before playback starts.
  const pickFirst = searchParams.get('pickReleases') === '1';
  // RD-selected mode: a torrent was already chosen in the unreleased selector
  // and passed as `url` — skip Videasy AND the auto-fallback, just play it.
  const rdSelected = searchParams.get('rdsel') === '1';
  // Continue-Watching resume: Vidking is tried first (url=vidking:placeholder),
  // but the EXACT saved stream rides along as `resume` and plays if Vidking
  // fails — instant, no addon re-fetch/auto-pick.
  const resumeUrl = searchParams.get('resume');
  // Best smooth stream in pick-first mode — committed only if the user closes
  // the picker without choosing (so they aren't stranded on the buffer screen).
  const pickFirstBestRef = useRef<string | null>(null);
  const isSeriesLike = type === 'series' || type === 'anime';

  // FROZEN once per episode session: startTimeSeconds is a dependency of the
  // player's src effect, and the CW list this lookup reads is updated by OUR
  // OWN progress saves every few seconds during playback. A live-tracking
  // value tears the video down and reloads it on every save — the "player
  // flashes black and re-seeks every ~2 seconds" loop.
  const initialResumeRef = useRef<{ key: string; value: number | null } | null>(null);
  const startTime = useMemo(() => {
    const raw = searchParams.get('t');
    if (raw) {
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    // No explicit `t` — this is a short player URL, which keeps the resume
    // position OUT of the URL. Look it up ONCE from the user's Continue-
    // Watching progress for this exact movie/episode. (In-app navigation has
    // CW already loaded, so this resolves on first render.)
    if (!id || !type) return null;
    const key = `${type}:${id}:${videoId ?? ''}`;
    if (initialResumeRef.current?.key === key) return initialResumeRef.current.value;
    const freeze = (value: number | null): number | null => {
      initialResumeRef.current = { key, value };
      return value;
    };
    const cw = continueWatching.find((it) => it._id === id && it.type === type);
    const st = cw?.state;
    if (!st) return freeze(null);
    // For a series, only honor progress that belongs to THIS episode.
    if (type === 'series' && videoId) {
      const cwVideo = st.videoId ?? st.video_id ?? null;
      if (cwVideo && cwVideo !== videoId) return freeze(null);
    }
    // getResumeSeconds normalizes the CW state's ms-vs-seconds ambiguity
    // (web-written offsets are milliseconds, desktop-written are seconds).
    // Reading st.timeOffset raw seeked ms values to the clamp-end of the
    // video, which "finished" instantly and binge-advanced.
    const off = getResumeSeconds(cw);
    if (off == null || off <= 0) return freeze(null);
    // Fully-watched guard: resuming at ~the end makes the video finish
    // within seconds and binge-advance instantly skip to the next episode
    // — re-opening a watched episode must RESTART it, not fast-forward
    // through it. Mirrors the usual >=95% / <60s-left "watched" heuristic.
    const durRaw = st.duration;
    const dur = typeof durRaw === 'number' && Number.isFinite(durRaw) && durRaw > 0
      ? (durRaw >= 10_000 ? durRaw / 1000 : durRaw)
      : null;
    if (dur !== null && (off / dur >= 0.95 || dur - off < 60)) return freeze(null);
    return freeze(off);
  }, [searchParams, continueWatching, id, type, videoId]);

  // Fetch series metadata so we can compute next-episode for chained auto-advance
  // (ep1 → ep2 → ep3 without returning to DetailPage). The metadata is cached in
  // stremioAddon's in-memory cache, so repeated calls for the same series are instant.
  const { meta } = useMetaDetails({
    type: type ?? '',
    id: id ?? '',
    addons,
    enableStreams: false,
  });

  // Display title: URL param wins (legacy long links stamp metaTitle=), else
  // the Cinemeta name. Short URLs carry no title params at all — without this
  // the player's back pill showed a literal "Player" instead of the show.
  const metaTitle = metaTitleParam ?? meta?.meta?.name ?? null;

  // Fallback chain for poster + background — URL param wins, then
  // anything the addon meta provides, then the library / continue-
  // watching item's poster (same source the ResumeOrStartOver
  // modal uses) so we never end up with a black overlay.
  // The meta ternaries are hoisted into named consts (not inlined into the ??
  // chains) to dodge a TS7 7.0.2 false-positive TS2871 ("always nullish") in its
  // new nullish-coalescing analysis — `x ?? (cond ? y ?? null : null)` trips it.
  // Behaviour is identical: URL param wins, then addon meta, then library fallback.
  const metaPoster: string | null = meta?.meta?.poster
    ? normalizeStremioImage(meta.meta.poster) ?? null
    : null;
  const metaBackground: string | null = meta?.meta?.background
    ? normalizeStremioImage(meta.meta.background) ?? null
    : null;
  const poster = posterParam ?? metaPoster ?? libraryFallbackPoster;
  const background =
    backgroundParam ?? metaBackground ?? metaPoster ?? libraryFallbackPoster;

  // Compute next-episode info from the full episode list when available.
  // Falls back to sessionStorage (written by DetailPage) for the initial play.
  const nextEpisodeInfo = useMemo((): NextEpisodeInfo | null => {
    if (!type || !id || !isSeriesLike) return null;

    // Primary: compute from metadata episode list (enables chained auto-advance)
    const videos = meta?.meta?.videos;
    if (videos?.length && videoId) {
      const computed = computeNextEpisode(videoId, videos);
      if (computed) return computed;
    }

    // Fallback: sessionStorage (written by DetailPage on initial navigation)
    try {
      const raw = sessionStorage.getItem(`bliss:nextEpisode:${type}:${id}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<NextEpisodeInfo>;
      if (!parsed || typeof parsed.nextVideoId !== 'string') return null;
      return {
        nextVideoId: parsed.nextVideoId,
        nextEpisodeTitle: typeof parsed.nextEpisodeTitle === 'string' ? parsed.nextEpisodeTitle : 'Next Episode',
        nextSeason: typeof parsed.nextSeason === 'number' ? parsed.nextSeason : null,
        nextEpisode: typeof parsed.nextEpisode === 'number' ? parsed.nextEpisode : null,
        nextThumbnail: typeof parsed.nextThumbnail === 'string' ? parsed.nextThumbnail : null,
        nextReleased: typeof parsed.nextReleased === 'string' ? parsed.nextReleased : null,
      };
    } catch {
      return null;
    }
  }, [type, id, isSeriesLike, videoId, meta]);

  // Clean up sessionStorage on unmount
  useEffect(() => {
    return () => {
      if (type && id) {
        try {
          sessionStorage.removeItem(`bliss:nextEpisode:${type}:${id}`);
        } catch {
          // ignore
        }
      }
    };
  }, [type, id]);

  // Web: resolve the playable stream URL via Videasy. Two-step:
  //   1. IMDb id -> TMDB id via /find (lib/tmdb.ts, cached).
  //   2. Hit our addon-proxy /videasy-sources which calls
  //      https://api.videasy.net/<provider>/sources-with-title,
  //      WASM-decrypts the response, returns { sources, subtitles }.
  // The chosen source URL is fed to BlissfulPlayer as a plain HTTPS .mp4,
  // so playback is same-origin from <video>'s perspective and autoplay
  // works without any iframe sandbox / Vidking overlay. Falls back to
  // BlissfulPlayer with the original props.url if either step fails.
  const imdbId = id && /^tt\d+/.test(id) ? id : null;
  const [tmdbLookup, setTmdbLookup] = useState<TmdbLookup | null>(null);
  const [tmdbResolved, setTmdbResolved] = useState(false);
  useEffect(() => {
    if (!imdbId) {
      setTmdbResolved(true);
      return;
    }
    let cancelled = false;
    sendPlayerLog(`[player-page] tmdb fetch start imdbId=${imdbId}`);
    void fetchTmdbId(imdbId)
      .then((result) => {
        if (cancelled) return;
        sendPlayerLog(
          `[player-page] tmdb fetch ok imdbId=${imdbId} result=${JSON.stringify(result)}`
        );
        setTmdbLookup(result);
        setTmdbResolved(true);
      })
      .catch((err) => {
        if (cancelled) return;
        sendPlayerLog(`[player-page] tmdb fetch FAILED imdbId=${imdbId} err=${String(err?.message ?? err)}`);
        setTmdbResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [imdbId]);

  // Videasy sources fetch (runs once TMDB resolves + we have a title).
  // We keep ALL sources so the player can render a quality picker.
  const [videasySources, setVideasySources] = useState<VideasySource[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string | null>(null);
  const [videasySubs, setVideasySubs] = useState<VideasySubtitle[]>([]);
  // Bitcine-style server picker — `selectedServer` drives which
  // Videasy provider we hit, `unavailableServers` collects the ones
  // we've already tried and given up on for this title so the
  // auto-switch chain doesn't loop and the picker can gray them out.
  // Seed from the cloud-synced favorite server if the user has one
  // — that's the bitcine-style "remember my preferred server"
  // behavior. PLAYER_SERVERS guarantees the id is valid; if it's
  // not in the list (stale value) fall back to the default.
  const initialServer = useMemo(() => {
    const fav = resolvedPlayerSettings.favoriteServer;
    if (fav && PLAYER_SERVERS.some((s) => s.id === fav)) return fav;
    return DEFAULT_SERVER_ID;
  }, [resolvedPlayerSettings.favoriteServer]);
  // Profile-level Real-Debrid key (per-profile playerSettings — see
  // DOCUMENTATION.md §Real-Debrid). Non-empty means this profile plays
  // RD-first: the videasy resolve is skipped outright and the addon
  // fallback commits the RD pick directly.
  const hasProfileRdKey = !!resolvedPlayerSettings.realDebridApiKey?.trim();
  const [selectedServer, setSelectedServer] = useState<string>(initialServer);
  const [unavailableServers, setUnavailableServers] = useState<string[]>([]);
  // Set to true when the user manually picks a server from the
  // Servers tab. While true, the Videasy fetch effect skips the
  // auto-switch chain on failure — we honor the user's pick and
  // let them try another themselves (or fall to RD). Reset on
  // episode change and on auto-switch advances.
  const userPickedServerRef = useRef(false);
  const handleSelectServer = useCallback((id: string) => {
    userPickedServerRef.current = true;
    // An explicit pick means "try videasy again" — lift the dead-source
    // cooldown so the resolve actually runs.
    clearVideasyCooldown();
    setSelectedServer(id);
  }, []);
  const [videasyResolved, setVideasyResolved] = useState(false);
  // Year (optional, helps Videasy disambiguate). Pulled from meta when
  // available — otherwise omitted entirely.
  const releaseYear = useMemo<number | null>(() => {
    const d = meta?.meta?.released ?? null;
    if (!d) return null;
    const y = Number.parseInt(String(d).slice(0, 4), 10);
    return Number.isFinite(y) && y > 1800 ? y : null;
  }, [meta?.meta?.released]);

  // Parse "tt9813792:4:3" -> { season: 4, episode: 3 } for TV episodes.
  const seriesSeasonEpisode = useMemo(() => {
    if (!isSeriesLike || !videoId) return null;
    const parts = videoId.split(':');
    if (parts.length < 3) return null;
    const season = Number.parseInt(parts[parts.length - 2], 10);
    const episode = Number.parseInt(parts[parts.length - 1], 10);
    if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
    return { season, episode };
  }, [isSeriesLike, videoId]);

  // Per-episode rating override fetched from TMDB. Cinemeta ships
  // "0" for shows it doesn't track — when that happens we hit
  // /tmdb-episode-rating to surface the TMDB community rating
  // instead of silently falling back to the show-level number.
  // Keyed by videoId so seeks within the same series cache.
  const [episodeRatingOverrides, setEpisodeRatingOverrides] = useState<
    Record<string, string | null>
  >({});
  useEffect(() => {
    if (!tmdbLookup || tmdbLookup.mediaType !== 'tv') return;
    if (!seriesSeasonEpisode || !videoId) return;
    if (videoId in episodeRatingOverrides) return; // already fetched/cached
    // Only call TMDB when Cinemeta gave us nothing useful for this
    // specific episode (or anything else with a falsy/"0" rating).
    const cinemetaVideos = meta?.meta?.videos ?? [];
    const cinemetaVideo = cinemetaVideos.find((v) => v.id === videoId) as
      | { rating?: string | number; imdbRating?: string | number }
      | undefined;
    const raw = cinemetaVideo?.rating ?? cinemetaVideo?.imdbRating ?? null;
    const num = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(num) && num > 0) return; // Cinemeta already has it
    let cancelled = false;
    const params = new URLSearchParams({
      tmdbId: String(tmdbLookup.tmdbId),
      season: String(seriesSeasonEpisode.season),
      episode: String(seriesSeasonEpisode.episode),
    });
    void fetch(`/tmdb-episode-rating?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const rating = data?.rating != null ? String(data.rating) : null;
        setEpisodeRatingOverrides((prev) => ({ ...prev, [videoId]: rating }));
      })
      .catch(() => {
        if (!cancelled) {
          setEpisodeRatingOverrides((prev) => ({ ...prev, [videoId]: null }));
        }
      });
    return () => { cancelled = true; };
  }, [tmdbLookup, seriesSeasonEpisode, videoId, meta, episodeRatingOverrides]);

  // Once the House RD fallback is committed and playing, stop the Videasy
  // auto-switch cascade: each remaining server spins up the on-Mac resolver
  // browser, which steals CPU from the live ffmpeg transcode and stalls the
  // RD stream ("plays 5s then buffers forever"). These refs let the Videasy
  // effect see the committed fallback + abort its in-flight resolve WITHOUT
  // listing fallbackPlayUrl in its deps (which would restart Videasy). The
  // ref is kept in sync by an effect after fallbackPlayUrl's declaration.
  const fallbackPlayUrlRef = useRef<string | null>(null);
  // WHICH episode the committed fallback belongs to. On an episode change the
  // videasy effect runs BEFORE the reset effect clears fallbackPlayUrl, so
  // gating on the bare ref made the NEW episode skip its videasy resolve
  // entirely ("RD fallback already playing" — the PREVIOUS episode's). Gates
  // must compare this key against the current videoId.
  const fallbackVideoKeyRef = useRef<string | null>(null);
  const videasyAbortRef = useRef<AbortController | null>(null);

  // Fetch playable sources from Videasy once TMDB lookup and title
  // are available. Picks the highest-ranked stream and feeds its URL
  // to BlissfulPlayer. Falls back silently if nothing comes back.
  useEffect(() => {
    // RD modes ("Play with RealDebrid") — don't resolve Videasy at all; the
    // user goes straight to the torrent they pick, no waiting on Videasy.
    if (pickFirst || rdSelected) {
      setVideasyResolved(true);
      // These modes reuse the already-mounted player (a watch-party relay swap,
      // or "Play with RealDebrid"), so Videasy sources from the prior playback
      // would linger and make `activeSource` shadow the chosen `url`. Clear them
      // so the chosen stream actually plays and the picker shows torrent
      // releases, not stale Videasy qualities.
      setVideasySources([]);
      return;
    }
    // Profile has its own Real-Debrid key — RD-first, always. Videasy/Vidking
    // is strictly the no-RD affordance: when this profile can play RD
    // releases, skip the videasy resolve outright (resolved + zero sources)
    // so the parallel addon fallback commits the RD pick directly. A manual
    // pick from the Servers tab still forces a videasy try — same escape
    // hatch as the cooldown gate below.
    if (hasProfileRdKey && !userPickedServerRef.current) {
      sendPlayerLog('[player-page] videasy skip — profile has an RD key (RD-first)');
      setVideasySources([]);
      setVideasyResolved(true);
      return;
    }
    // Cooldown after a recent dead videasy source: resolve nothing and let
    // the addon fallback commit RD directly — no doomed videasy first act.
    // A manual server pick (userPickedServerRef) bypasses and clears it.
    if (videasyCooldownActive() && !userPickedServerRef.current) {
      sendPlayerLog('[player-page] videasy skip — cooldown after recent dead source (RD-first for now)');
      setVideasySources([]);
      setVideasyResolved(true);
      return;
    }
    if (!tmdbLookup) {
      sendPlayerLog('[player-page] videasy gate: no tmdbLookup yet');
      return;
    }
    // Short player URLs (/player/vidking/…) deliberately carry no title, so
    // fall back to the Cinemeta meta name (loads async — this effect re-runs
    // when it arrives). Without this, a short-URL movie has no title for the
    // videasy query and silently falls through to RD — the opposite of the
    // vidking-first behavior the short URL is supposed to give.
    const seriesTitle = metaTitle ?? title ?? meta?.meta?.name ?? null;
    if (!seriesTitle) {
      sendPlayerLog('[player-page] videasy gate: no seriesTitle');
      return;
    }
    if (tmdbLookup.mediaType === 'tv' && !seriesSeasonEpisode) {
      sendPlayerLog('[player-page] videasy gate: tv but no seriesSeasonEpisode');
      return;
    }

    const server = PLAYER_SERVERS.find((s) => s.id === selectedServer)
      ?? PLAYER_SERVERS.find((s) => s.id === DEFAULT_SERVER_ID)!;

    // RD fallback already committed & playing FOR THIS EPISODE — don't start
    // another Videasy resolve (it would spin up the resolver browser and
    // stall the transcode). A previous episode's commit doesn't count: the
    // reset effect clears it a beat later, and skipping here would strand
    // the new episode with videasyResolved=true + zero sources.
    if (fallbackPlayUrlRef.current && fallbackVideoKeyRef.current === (videoId ?? id ?? null)) {
      sendPlayerLog('[player-page] videasy skip — RD fallback already playing');
      setVideasyResolved(true);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    videasyAbortRef.current = ac;
    setVideasyResolved(false);
    setVideasySources([]);
    const params = new URLSearchParams({
      title: seriesTitle,
      mediaType: tmdbLookup.mediaType === 'tv' ? 'tv' : 'movie',
      tmdbId: String(tmdbLookup.tmdbId),
      imdbId: imdbId ?? '',
      provider: server.provider,
    });
    if (releaseYear) params.set('year', String(releaseYear));
    if (tmdbLookup.mediaType === 'tv' && seriesSeasonEpisode) {
      params.set('seasonId', String(seriesSeasonEpisode.season));
      params.set('episodeId', String(seriesSeasonEpisode.episode));
    }
    // Auto-switch chain — if the current server returns nothing or
    // errors, mark it unavailable and advance to the next playable
    // server. Matches bitcine's behavior of silently retrying with
    // alternates until one resolves.
    const tryNextServer = () => {
      // RD fallback is live for THIS episode — halt the server cascade. Each
      // further Videasy server drives the on-Mac resolver browser, starving
      // the ffmpeg transcode of CPU and stalling the RD stream.
      if (fallbackPlayUrlRef.current && fallbackVideoKeyRef.current === (videoId ?? id ?? null)) {
        sendPlayerLog('[player-page] videasy auto-switch halted — RD fallback playing');
        setVideasyResolved(true);
        return;
      }
      const tried = new Set([...unavailableServers, server.id]);
      setUnavailableServers(Array.from(tried));
      // If the user explicitly picked this server, don't cycle to
      // the next one — respect their choice and surface the failure
      // (the fallback effect will offer Real-Debrid streams). They
      // can pick another server themselves from the Servers tab.
      if (userPickedServerRef.current) {
        sendPlayerLog(`[player-page] videasy user-picked ${server.id} failed — staying`);
        setVideasyResolved(true);
        return;
      }
      const next = PLAYER_SERVERS.find((s) => !tried.has(s.id));
      if (next) {
        sendPlayerLog(`[player-page] videasy auto-switch ${server.id} → ${next.id}`);
        setSelectedServer(next.id);
      } else {
        sendPlayerLog('[player-page] videasy auto-switch exhausted all servers');
        setVideasyResolved(true);
      }
    };
    sendPlayerLog(`[player-page] videasy fetch start server=${server.id} provider=${server.provider} ?${params.toString()}`);
    void (async () => {
      try {
        const resp = await fetch(`/videasy-sources?${params.toString()}`, {
          signal: ac.signal,
        });
        if (!resp.ok) {
          sendPlayerLog(`[player-page] videasy fetch !ok server=${server.id} status=${resp.status}`);
          if (!cancelled) tryNextServer();
          return;
        }
        const data = (await resp.json()) as {
          sources?: VideasySource[];
          subtitles?: VideasySubtitle[];
        };
        if (cancelled) return;
        const sources = (data?.sources ?? []).filter((s) => s.quality);
        sendPlayerLog(
          `[player-page] videasy fetch ok server=${server.id} sources=${sources.length} qualities=${
            sources.map((s) => s.quality).join(',')
          }`
        );
        if (sources.length === 0) {
          tryNextServer();
          return;
        }
        const sorted = sources.slice().sort((a, b) => rankSource(b) - rankSource(a));
        setVideasySources(sorted);
        // Prefer the user's favorited quality when this title actually
        // has a source at that quality — otherwise fall through to the
        // top-ranked default. Case-insensitive so "4K" / "4k" / "2160p"
        // (and any future capitalization quirks) all match.
        const favQ = resolvedPlayerSettings.favoriteQuality;
        const favMatch = favQ
          ? sorted.find((s) => s.quality?.toLowerCase() === favQ.toLowerCase())
          : null;
        setSelectedQuality(favMatch?.quality ?? sorted[0]?.quality ?? null);
        setVideasySubs(data?.subtitles ?? []);
        setVideasyResolved(true);
      } catch (err) {
        sendPlayerLog(`[player-page] videasy fetch threw server=${server.id} err=${String((err as Error)?.message ?? err)}`);
        if (!cancelled) tryNextServer();
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  // unavailableServers intentionally omitted from deps — it's only
  // read inside tryNextServer to compute the next candidate, never
  // a trigger for re-running the fetch on its own. Including it
  // would cause an immediate refetch loop on auto-switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbLookup, metaTitle, title, meta?.meta?.name, imdbId, releaseYear, seriesSeasonEpisode, selectedServer, pickFirst, rdSelected, hasProfileRdKey]);

  // Reset the auto-switch chain whenever the title (imdbId) or
  // episode changes — previous "this server has no source" judgments
  // don't carry over to a new episode/movie.
  useEffect(() => {
    setUnavailableServers([]);
    setSelectedServer(initialServer);
    userPickedServerRef.current = false;
  }, [imdbId, seriesSeasonEpisode]);

  // Once Videasy actually returns a playable source, wipe the
  // "unavailable" list so the picker doesn't keep showing servers
  // greyed out from auto-switch failures earlier in the session.
  // Bitcine behaves the same way — every server is selectable from
  // the picker even if it 502'd on the initial chain. Reflects the
  // fact that Videasy provider availability is flappy minute-to-
  // minute and there's no value in pinning earlier-failure state.
  useEffect(() => {
    if (videasyResolved && videasySources.length > 0 && unavailableServers.length > 0) {
      setUnavailableServers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videasyResolved, videasySources.length]);

  // ── Addon-stream fallback ─────────────────────────────────────────
  // Fired IN PARALLEL with the Videasy chain — not gated on Videasy
  // exhaustion — because Videasy's auto-switch loop can thrash on
  // intermittent 503s and never actually reach "all exhausted" within
  // a reasonable window. Having the addon stream URL ready early
  // means the player can switch over the moment Videasy stalls or
  // gives up. If Videasy succeeds, we still prefer its source over
  // the fallback (see `playUrl` resolution below).
  const [fallbackPlayUrl, setFallbackPlayUrl] = useState<string | null>(null);
  // Mirror fallbackPlayUrl into the ref the Videasy effect consults, and abort
  // any in-flight Videasy resolve the moment RD commits — so the resolver
  // browser stops competing with the live transcode for the Mac's CPU.
  useEffect(() => {
    fallbackPlayUrlRef.current = fallbackPlayUrl;
    // Stamp WHICH episode this commit belongs to. Runs only when the URL
    // itself changes (videoId/id intentionally NOT deps — re-running on an
    // episode change would re-tag the stale URL with the new episode and
    // resurrect the very gate bug the key exists to fix).
    fallbackVideoKeyRef.current = fallbackPlayUrl ? (videoId ?? id ?? null) : null;
    if (fallbackPlayUrl) {
      try { videasyAbortRef.current?.abort(); } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackPlayUrl]);
  // Resume fallback: CW resume tries Vidking first (url=placeholder) but carries
  // the exact saved stream as `resume`. Commit the saved stream the moment
  // Vidking resolves with NO source — OR after a short grace window, because when
  // Vidking has no source for a title its resolver can take 60-168s PER server
  // and the player cycles several servers, leaving the user staring at a buffer
  // for minutes. The saved RD stream is what they asked for, so don't make them
  // wait that long. (Placed up here with the other hooks, ABOVE the loading
  // early-returns, so the hook count is stable across renders.)
  useEffect(() => {
    if (!resumeUrl || fallbackPlayUrl) return;
    if (videasyResolved && videasySources.length === 0) {
      setFallbackPlayUrl(resumeUrl); // Vidking resolved empty → use the saved stream now
      return;
    }
    if (videasySources.length > 0) return; // Vidking won — let it play
    // Grace window: give Vidking ~8s, then fall back to the saved stream
    // regardless (it's slow-resolving or down).
    const t = window.setTimeout(() => setFallbackPlayUrl(resumeUrl), 8000);
    return () => window.clearTimeout(t);
  }, [resumeUrl, videasyResolved, videasySources, fallbackPlayUrl]);
  // Once Videasy actually resolves sources, DROP any committed standby
  // fallback (chiefly the CW resume stream — often an RD torrent saved by the
  // desktop app). Selection already prefers Videasy, but the standby lingered:
  // every server switch empties videasySources for a beat, activeSource goes
  // null, and playback flickered onto the stale RD transcode just long enough
  // to 409 ("Not cached — pick another release" + a phantom Releases drawer)
  // before the new server resolved. The resume effect above re-commits the
  // saved stream if Videasy later resolves empty, so dropping it loses
  // nothing. rdSelected/pickFirst keep their explicitly-picked URL
  // (videasySources can linger from a previous playback in those modes).
  useEffect(() => {
    if (rdSelected || pickFirst) return;
    if (fallbackPlayUrl && videasySources.length > 0) setFallbackPlayUrl(null);
  }, [rdSelected, pickFirst, fallbackPlayUrl, videasySources]);
  // Audio tracks for a transcoded RD stream. The transcoder muxes ONE track at
  // a time (&a=N), so probe the source's tracks → the player offers a picker and
  // switching reloads the transcode at the same position. (Above the early
  // returns to keep the hook count stable.)
  // Resolve the real media URL to probe AND the audio track the URL already
  // selects. A guest's url is a transcode wrapper (`/transcode.m3u8?url=<inner>
  // &a=N`) — extract the inner http URL (so the probe works) and the baked-in
  // `&a=N` (so the picker + playback honor it instead of resetting to 0, which
  // was desyncing host↔guest audio).
  const { transcodeAudioSrc, urlAudioIdx } = (() => {
    const c = fallbackPlayUrl || (url && !/^(vidking|videasy):/i.test(url) ? url : null);
    if (!c) return { transcodeAudioSrc: null as string | null, urlAudioIdx: 0 };
    const m = c.match(/^\/transcode(?:\.m3u8)?\?url=([^&]+)(?:&a=(\d+))?/);
    if (m) {
      let inner = m[1];
      try { inner = decodeURIComponent(m[1]); } catch { /* keep raw */ }
      const ok = /^https?:\/\//i.test(inner) && TRANSCODE_CONTAINER_RE.test(inner);
      return { transcodeAudioSrc: ok ? inner : null, urlAudioIdx: m[2] ? parseInt(m[2], 10) : 0 };
    }
    const ok = /^https?:\/\//i.test(c) && TRANSCODE_CONTAINER_RE.test(c);
    return { transcodeAudioSrc: ok ? c : null, urlAudioIdx: 0 };
  })();
  const [audioTracks, setAudioTracks] = useState<
    { i: number; lang: string | null; title: string | null; channels: number | null; codec: string | null }[]
  >([]);
  const [audioTrackIdx, setAudioTrackIdx] = useState(0);
  useEffect(() => {
    setAudioTracks([]);
    setAudioTrackIdx(urlAudioIdx); // honor the track baked into the URL
    if (!transcodeAudioSrc) return;
    let cancelled = false;
    fetch(`/transcode-audio?url=${encodeURIComponent(transcodeAudioSrc)}`)
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((d: { tracks?: typeof audioTracks }) => {
        if (!cancelled) setAudioTracks(Array.isArray(d.tracks) ? d.tracks : []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [transcodeAudioSrc, urlAudioIdx]);
  // When Real-Debrid has no working stream for the title (every
  // candidate 302s to the takedown notice), set this flag so the
  // UI can show a helpful error overlay instead of a permanent
  // black screen.
  const [fallbackExhausted, setFallbackExhausted] = useState(false);
  // Consecutive fallback runs that found NO streams at all. Usually a
  // transient upstream condition (Torrentio/RD 429 throttle, network blip)
  // that succeeds seconds later — retried before declaring exhaustion.
  const emptyFallbackRetriesRef = useRef(0);
  // Full list of HTTPS addon streams (Torrentio + Torrentio RD)
  // captured during the fallback fetch. On mobile we surface this
  // directly as a stream picker when Vidking is unavailable — the
  // user can pick one and open it in VLC.
  const [addonStreams, setAddonStreams] = useState<AddonStreamEntry[]>([]);
  useEffect(() => {
    setFallbackPlayUrl(null);
    setFallbackExhausted(false);
    setAddonStreams([]);
    emptyFallbackRetriesRef.current = 0;
  }, [imdbId, seriesSeasonEpisode]);
  // Mobile width detection (re-evaluated on resize so rotating
  // the device flips back to the desktop layout).
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const h = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  // Recognise stored URLs that the browser can't decode — chiefly
  // HEVC/x265 — so we can route around them by re-running the
  // fallback even though the URL itself isn't a placeholder.
  const HEVC_RE = /(^|[^a-z])(x265|h\.?265|hevc)([^a-z]|$)/i;
  // HLS URLs (.m3u8 / stremio-service /hlsv2 / our party-relay) are already a
  // transcoded, SEGMENTED stream that hls.js plays directly, regardless of the
  // SOURCE codec. The source filename frequently rides inside a `mediaURL=`/
  // `url=` query param (e.g. a Layer-B relay
  // `…/hlsv2/…/master.m3u8?mediaURL=…From.S01E01.x265-BlackBit.mkv&k=…`), so
  // running HEVC_RE over the whole decoded URL false-positives on that inner
  // `x265` and would wrongly DROP the playable HLS URL (→ empty playUrl → the
  // player renders nothing and never fetches the playlist).
  const urlIsHls =
    !!url
    && (/\.m3u8(\?|#|$)/i.test(url) || url.includes('/hlsv2/') || url.includes('/party-relay/'));
  const urlIsHevc = !!url && !urlIsHls && HEVC_RE.test(decodeURIComponent(url));
  // Mirror "videasy currently has a playable (non-4K) source" into a ref so the
  // fallback effect can consult it WITHOUT listing videasySources /
  // videasyResolved in its deps. Those flip on every videasy server auto-switch
  // (setVideasySources([]) → setVideasySources(sorted)); when they were deps,
  // each flip cancelled + restarted the in-flight RD chain — so the House RD
  // pick took 90s+ on titles where videasy 502s across all servers, instead of
  // finishing in one ~6s pass.
  const videasyPlayableRef = useRef(false);
  useEffect(() => {
    videasyPlayableRef.current =
      videasyResolved && videasySources.some((s) => !/4k|2160p/i.test(s.quality ?? ''));
  }, [videasyResolved, videasySources]);
  // Videasy can "resolve" sources whose CDN is dead — the API hands out
  // URLs but the media origin never answers a byte (observed 2026-07-18:
  // every moon.ironwallnet.net path hung → /addon-proxy 504, on videasy's
  // own player too). hls.js then grinds through its 6×20s manifest retries
  // while the addon fallback stays skipped ("videasy resolved"), so the
  // user stares at an endless spinner even though RD has the title. Probe
  // what the player is about to use — the manifest AND its first segment
  // (same day, later: manifests stayed 200 while every segment host died,
  // so a manifest-only probe passes right into an unplayable stream). A
  // healthy source answers both in well under a second, so two failed 10s
  // attempts ⇒ dead. Then drop ALL videasy state for this episode (the
  // subtitles live on the same host) and bump the nonce so the addon-
  // fallback effect re-runs — with videasyPlayableRef now false it walks
  // its probe loop and commits the RD pick.
  const [videasyDeadNonce, setVideasyDeadNonce] = useState(0);
  // Sources already proven dead — if a manual server switch re-fetches
  // the same URLs (the API keeps returning them while the CDN is down),
  // kill them instantly instead of burning another 20s re-probing.
  const deadManifestsRef = useRef<Set<string>>(new Set());
  const videasySourcesRef = useRef<VideasySource[]>([]);
  useEffect(() => { videasySourcesRef.current = videasySources; }, [videasySources]);
  useEffect(() => {
    deadManifestsRef.current.clear(); // dead-CDN verdicts don't carry across episodes
  }, [imdbId, seriesSeasonEpisode]);
  const declareVideasyDead = useCallback((src: string, why: string) => {
    deadManifestsRef.current.add(src);
    // A death here means videasy's CDN is lying upstream-wide right now —
    // skip videasy on subsequent resolves for a while (see the cooldown
    // constants at the top of the file).
    startVideasyCooldown();
    sendPlayerLog(`[player-page] videasy source dead (${why}) — dropping videasy, engaging addon fallback url=…${src.slice(-60)}`);
    setVideasySources([]);
    setVideasySubs([]);
    setVideasyDeadNonce((n) => n + 1);
  }, []);
  // Mid-playback escape hatch: BlissfulPlayer reports a videasy source
  // whose fatal HLS network errors keep recurring (segment hosts died
  // AFTER the pre-play probe passed). Returns true when handled so the
  // player stops its own retry loop.
  const handleSourceDead = useCallback((deadSrc: string) => {
    if (!videasySourcesRef.current.length) return false;
    const known = videasySourcesRef.current.some((s) => s.url && deadSrc.startsWith(s.url));
    if (!known) return false;
    declareVideasyDead(deadSrc, 'fatal network errors in playback');
    return true;
  }, [declareVideasyDead]);
  useEffect(() => {
    if (pickFirst || rdSelected) return; // videasy never plays in RD modes
    // Mirrors the activeSource pick below — probe exactly what will play.
    const src =
      videasySources.find((s) => s.quality === selectedQuality)?.url
      ?? videasySources[0]?.url;
    // Only proxied videasy HLS; anything else has its own failure handling.
    if (!src || !src.startsWith('/addon-proxy')) return;
    let cancelled = false;
    if (deadManifestsRef.current.has(src)) {
      declareVideasyDead(src, 'known dead');
      return;
    }
    // First non-comment line of the rewritten playlist = the first proxied
    // segment URL. Read only its first chunk — enough to prove the segment
    // host answers, without downloading the segment.
    const probeFirstSegment = async (playlist: string): Promise<boolean> => {
      const segUrl = playlist
        .split(/\r?\n/)
        .find((l) => l.trim() && !l.trim().startsWith('#'))
        ?.trim();
      if (!segUrl) return false; // no segments = nothing playable
      try {
        const resp = await fetch(segUrl, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok || !resp.body) return false;
        const reader = resp.body.getReader();
        const first = await reader.read();
        void reader.cancel().catch(() => { /* already closed */ });
        return !first.done;
      } catch {
        return false;
      }
    };
    void (async () => {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const resp = await fetch(src, { signal: AbortSignal.timeout(10_000) });
          if (cancelled) return;
          if (resp.ok) {
            const body = await resp.text();
            if (cancelled) return;
            if (await probeFirstSegment(body)) return; // healthy — the player's own load takes it from here
            if (cancelled) return;
            sendPlayerLog(`[player-page] videasy segment probe failed attempt=${attempt}`);
            continue;
          }
          sendPlayerLog(`[player-page] videasy manifest probe !ok status=${resp.status} attempt=${attempt}`);
        } catch (err) {
          if (cancelled) return;
          sendPlayerLog(`[player-page] videasy manifest probe err attempt=${attempt} err=${String((err as Error)?.message ?? err)}`);
        }
      }
      if (!cancelled) declareVideasyDead(src, 'manifest/segment unreachable');
    })();
    return () => { cancelled = true; };
  }, [videasySources, selectedQuality, pickFirst, rdSelected, declareVideasyDead]);
  useEffect(() => {
    if (!type || !id) {
      sendPlayerLog(`[player-page] addon fallback gate: no type/id (type=${type} id=${id})`);
      return;
    }
    const isPlaceholder = !!url && /^(vidking|videasy):/i.test(url);
    // rdSelected (a torrent chosen in the unreleased selector, passed as `url`)
    // still FETCHES the release list — to populate the in-player torrent picker
    // and hide the Videasy server picker — it just doesn't auto-commit (the
    // chosen `url` is already playing).
    if (!isPlaceholder && !urlIsHevc && !rdSelected) {
      sendPlayerLog(`[player-page] addon fallback gate: url playable + not placeholder url.len=${url?.length ?? 0} urlIsHevc=${urlIsHevc} url=${url ?? 'null'}`);
      return;
    }
    if (fallbackPlayUrl) return;
    // NOTE: intentionally NOT gated on videasy state via deps — that made every
    // videasy server-switch cancel + restart this chain (RD pick took 90s+ when
    // videasy 502'd across all servers). We still FETCH once so addonStreams
    // (mobile picker / Releases list) populates, and consult videasyPlayableRef
    // at the await boundaries below to skip the expensive RD pick once videasy
    // has resolved a playable source. The selection layer prefers videasy
    // regardless (activeSource ?? fallbackPlayUrl), so a ready RD URL never
    // yanks a working videasy stream.
    if (!addons || addons.length === 0) {
      sendPlayerLog(`[player-page] addon fallback gate: no addons (len=${addons?.length ?? 'null'})`);
      return;
    }
    if (type !== 'movie' && type !== 'series') return;
    if (type === 'series' && !videoId) {
      sendPlayerLog(`[player-page] addon fallback gate: series without videoId`);
      return;
    }
    const streamId = (type === 'series' && videoId) ? videoId : id;
    sendPlayerLog(`[player-page] addon fallback START streamId=${streamId} addons=${addons.length}`);
    let cancelled = false;
    // baseFromTransportUrl: strip the trailing "/manifest.json" so
    // fetchStreams can append the correct /stream/<type>/<id>.json
    // path. Without this, the fetch hits /manifest.json/stream/...
    // and every addon returns 404 → "no playable streams".
    const stripManifest = (transportUrl: string) =>
      transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
    // House Real-Debrid fallback. The proxy resolves Torrentio-RD with a
    // server-side key and hands back key-free direct URLs, so a user with
    // NO RD key of their own still gets a playable stream when Videasy is
    // unavailable (the shared key never reaches the browser). Folded in as
    // one more source so it flows through the same filter/probe pipeline;
    // its streams arrive pre-resolved, so the probe loop just confirms
    // them. Empty `{ streams: [] }` when the proxy has no key configured.
    const rdFallbackEntry: Promise<{
      res: { streams: StremioStream[] };
      addon: { transportUrl: string; manifest: { name: string } };
    }> = fetch(`/rd-fallback?type=${type}&id=${encodeURIComponent(streamId)}`)
      .then((r) => (r.ok ? r.json() : { streams: [] }))
      .then((data: { streams?: StremioStream[] }) => ({
        res: { streams: data.streams ?? [] },
        addon: { transportUrl: 'rd-fallback', manifest: { name: 'Real-Debrid' } },
      }))
      .catch(() => ({
        res: { streams: [] as StremioStream[] },
        addon: { transportUrl: 'rd-fallback', manifest: { name: 'Real-Debrid' } },
      }));
    // Per-source timeout. fetchStreams here is passed NO AbortSignal, so a
    // hung/slow addon's fetch never settles — and `Promise.allSettled` waits for
    // ALL of them. With 15-20 addons installed, one dead addon strands the whole
    // chain, including the already-resolved House RD streams, so the player never
    // probes/commits a fallback and just sits on the Vidking placeholder ("not
    // falling back to RD" — observed on brand-new titles where Videasy 502s on
    // every server). Cap each source so allSettled settles in bounded time and
    // the RD pick can run. Mirrors fetchFallbackReleases' withTimeout.
    const SOURCE_TIMEOUT_MS = 8000;
    const settleWithin = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => { setTimeout(() => resolve(fallback), SOURCE_TIMEOUT_MS); }),
      ]);
    void Promise.allSettled([
      ...addons.map((a) =>
        settleWithin(
          fetchStreams({ type, id: streamId, baseUrl: stripManifest(a.transportUrl) })
            .then((res) => ({ res: { streams: res.streams ?? [] }, addon: a }))
            .catch(() => ({ res: { streams: [] as StremioStream[] }, addon: a })),
          { res: { streams: [] as StremioStream[] }, addon: a },
        )
      ),
      settleWithin(rdFallbackEntry, {
        res: { streams: [] as StremioStream[] },
        addon: { transportUrl: 'rd-fallback', manifest: { name: 'Real-Debrid' } },
      }),
    ]).then((results) => {
      if (cancelled) return;
      // Collect EVERY HTTPS stream (skip magnets/notWebReady — those need the
      // local stremio-service we don't run in the browser). The picker shows
      // ALL of them, including 4K HEVC/x265 — selecting any release routes
      // through /transcode.m3u8, which re-encodes HEVC→H.264. We tag HEVC so
      // the AUTO-pick can avoid it (H.264 transcodes ~free; 4K HEVC 10-bit →
      // H.264 is CPU-heavy and may not sustain realtime), only resorting to
      // HEVC if a title has nothing else.
      const allLabeled: Array<{ stream: StremioStream; addonName: string; isHevc: boolean }> = [];
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { res, addon } = r.value;
        const addonName = addon.manifest?.name ?? new URL(addon.transportUrl).hostname;
        for (const s of res.streams ?? []) {
          const isHttps = !!s.url && /^https?:\/\//i.test(s.url);
          if (!isHttps) continue;
          if (s.behaviorHints?.notWebReady === true) continue;
          // Drop fuzzy wrong-show matches (e.g. Comet returning "3rd Rock from
          // the Sun S04E07" for the show "From").
          if (metaTitle) {
            const pn = parseStreamDescription(s.description ?? s.title ?? '').torrentName;
            if (!releaseMatchesShow(pn || s.name || '', metaTitle)) continue;
          }
          const codecText = `${s.name ?? ''} ${s.title ?? ''} ${(s.behaviorHints as { filename?: string } | undefined)?.filename ?? ''}`;
          const isHevc = /(^|[^a-z])(x265|h\.?265|hevc)([^a-z]|$)/i.test(codecText);
          allLabeled.push({ stream: s, addonName, isHevc });
        }
      }
      // Quality preference for the AUTO-pick: 1080p > 720p > 2160p/4K > 480p.
      const scoreStream = (s: StremioStream) => {
        const t = `${s.name ?? ''} ${s.title ?? ''}`;
        let base = 60;
        if (/1080p/i.test(t)) base = 100;
        else if (/720p/i.test(t)) base = 85;
        else if (/2160p|4k/i.test(t)) base = 65;
        else if (/480p/i.test(t)) base = 50;
        // Container preference: .avi (XviD / ancient fansub) is the lowest
        // quality AND the flakiest source to transcode (mp3-in-avi seek glitches,
        // cold-RD-link segment failures). Sink it well below mkv/mp4 of the same
        // sub-tier — but don't exclude it, since some old anime episodes only
        // have an .avi sub rip. Checks filename + url too (the resolution/codec
        // tags live in the name/title, the extension often only in the file).
        const filename = (s.behaviorHints as { filename?: string } | undefined)?.filename ?? '';
        if (/\.avi(\b|$)/i.test(`${t} ${filename} ${s.url ?? ''}`)) base -= 45;
        return base;
      };
      // Auto-pick candidates: prefer non-HEVC (smooth transcode); if the title
      // ONLY has HEVC, fall back to it so the user still gets a stream.
      const nonHevc = allLabeled.filter((x) => !x.isHevc);
      const labeledHttps = (nonHevc.length ? nonHevc : allLabeled).slice();
      labeledHttps.sort((a, b) => scoreStream(b.stream) - scoreStream(a.stream));
      // Picker list = ALL streams (incl 4K HEVC). Parse the Stremio description
      // into the structured fields the detail-page stream list / Releases
      // picker use (torrent name, seeders, size, site).
      const exposed: AddonStreamEntry[] = allLabeled.map(({ stream, addonName }) => {
        const description = stream.description ?? stream.title ?? '';
        const parsed = parseStreamDescription(description);
        const hay = `${stream.name ?? ''} ${description}`;
        const qualMatch = hay.match(/\b(2160p|4k|1080p|720p|480p|360p)\b/i);
        const name = stream.name ?? addonName;
        const isRd = /\[RD\+?\]|realdebrid|real-?debrid/i.test(name) || /realdebrid/i.test(stream.url ?? '');
        return {
          name,
          torrentName: parsed.torrentName,
          description,
          url: stream.url ?? '',
          quality: qualMatch ? qualMatch[1].toLowerCase() : null,
          seeders: parsed.seeders,
          size: parsed.size,
          site: parsed.site,
          addonName,
          isRd,
          isMagnet: false,
        };
      });
      if (!cancelled) setAddonStreams(exposed);
      // RD-selected mode: the chosen torrent (`url`) is already playing — just
      // expose the rest for the in-player torrent picker; don't commit.
      if (rdSelected) {
        sendPlayerLog(`[player-page] rd-selected: ${exposed.length} releases exposed for the picker`);
        return;
      }
      // Resume mode: the EXACT saved stream is the fallback (committed by the
      // resume effect when Vidking fails) — expose the rest for the picker but
      // don't auto-pick a different one.
      if (resumeUrl) {
        sendPlayerLog(`[player-page] resume: ${exposed.length} releases exposed; saved stream is the fallback`);
        return;
      }
      // RD pick-first mode ("Play with RD"): expose the releases and let the
      // user choose — do NOT auto-probe or commit a stream. The Releases picker
      // auto-opens; selecting a torrent is what starts playback. (Videasy is
      // already skipped in this mode, so handle the no-streams case here.)
      if (pickFirst) {
        if (exposed.length > 0) {
          pickFirstBestRef.current = labeledHttps[0]?.stream.url ?? exposed[0]?.url ?? null;
          sendPlayerLog(`[player-page] pick-first: ${exposed.length} releases, awaiting user pick`);
        } else {
          sendPlayerLog('[player-page] pick-first: no releases found');
          if (!cancelled) setFallbackExhausted(true);
        }
        return;
      }
      if (labeledHttps.length === 0) {
        // Usually transient — Torrentio/RD throttling (429) or a network
        // blip returns an empty list once and works seconds later. Retry a
        // few times via the nonce before declaring exhaustion; giving up on
        // the first empty answer stranded sessions on an eternal black
        // screen with no overlay and no retry.
        const attempt = emptyFallbackRetriesRef.current + 1;
        emptyFallbackRetriesRef.current = attempt;
        if (attempt <= 3) {
          sendPlayerLog(`[player-page] addon fallback: no playable streams — retry ${attempt}/3 in ${attempt * 5}s`);
          window.setTimeout(() => setVideasyDeadNonce((n) => n + 1), attempt * 5000);
          return;
        }
        sendPlayerLog('[player-page] addon fallback: no playable streams after retries — exhausted');
        if (!cancelled && !videasyPlayableRef.current) setFallbackExhausted(true);
        return;
      }
      emptyFallbackRetriesRef.current = 0;
      // Videasy resolved a playable source while we were fetching streams —
      // selection prefers it, so don't spend RD probes or commit a fallback URL.
      if (videasyPlayableRef.current) {
        sendPlayerLog('[player-page] addon fallback: videasy resolved meanwhile — skipping RD pick');
        return;
      }
      void (async () => {
        // For series/anime, OpenSubtitles frequently has nothing — the only
        // subtitles may be EMBEDDED in a specific release. Probe the top
        // candidates (header read, ~fast) and float the ones that carry text
        // subs to the front, still quality-ordered among themselves. Bounded
        // + parallel so it adds only a few seconds, and only runs when the
        // fallback is actually engaged (Videasy unavailable).
        if (type === 'series' && labeledHttps.length > 1) {
          const topN = labeledHttps.slice(0, 8);
          const subResults = await Promise.all(
            topN.map(async (c) => {
              if (!c.stream.url) return [c, false] as const;
              try {
                const r = await fetch(`/probe-streams?url=${encodeURIComponent(c.stream.url)}`, { signal: AbortSignal.timeout(8000) });
                if (!r.ok) return [c, false] as const;
                const d = (await r.json()) as { subtitles?: Array<{ textBased?: boolean }> };
                return [c, (d.subtitles ?? []).some((s) => s.textBased)] as const;
              } catch { return [c, false] as const; }
            })
          );
          if (cancelled) return;
          const subSet = new Set(subResults.filter(([, has]) => has).map(([c]) => c));
          if (subSet.size) {
            labeledHttps.sort((a, b) => {
              const diff = (subSet.has(b) ? 1 : 0) - (subSet.has(a) ? 1 : 0);
              return diff !== 0 ? diff : scoreStream(b.stream) - scoreStream(a.stream);
            });
            sendPlayerLog(`[player-page] addon fallback: ${subSet.size}/${topN.length} top releases carry embedded subs — preferring them`);
          } else {
            sendPlayerLog('[player-page] addon fallback: no embedded subs in top releases — quality order');
          }
        }
        // Probe each candidate before committing — Torrentio's
        // /resolve/realdebrid/… 302-redirects DMCA'd files to a
        // 2 MB takedown notice MP4 ("failed_infringement_v2.mp4").
        // Drop any URL that ends up there and walk down the list.
        for (const cand of labeledHttps) {
          if (cancelled) return;
          // Videasy resolved mid-probe — stop committing an RD fallback.
          if (videasyPlayableRef.current) {
            sendPlayerLog('[player-page] addon fallback: videasy resolved mid-probe — aborting RD commit');
            return;
          }
          if (!cand.stream.url) continue;
          try {
            const probeResp = await fetch(`/resolve-url?url=${encodeURIComponent(cand.stream.url)}`);
            if (!probeResp.ok) continue;
            const probe = (await probeResp.json()) as { status?: number; finalUrl?: string; contentLength?: number };
            if (cancelled) return;
            // Real-Debrid throttled us (429) — the probe tells us nothing about
            // the stream, and probing the rest just hammers RD harder (making the
            // throttle worse). Commit THIS candidate and stop probing; the
            // transcode reconnects/backs off on 429 during playback. Skipping all
            // on 429 was the "loads forever" bug.
            if (probe.status === 429) {
              sendPlayerLog(`[player-page] addon fallback: RD throttled (429) — committing ${cand.addonName} without probing further`);
              setFallbackPlayUrl(cand.stream.url);
              return;
            }
            if (typeof probe.status !== 'number' || probe.status >= 400) {
              sendPlayerLog(`[player-page] addon fallback probe skip status=${probe.status} url=${cand.stream.url.slice(-60)}`);
              continue;
            }
            if (/failed_infringement/i.test(probe.finalUrl ?? '')) {
              sendPlayerLog(`[player-page] addon fallback probe skip DMCA url=${cand.stream.url.slice(-60)}`);
              continue;
            }
            sendPlayerLog(`[player-page] addon fallback PICK addon=${cand.addonName} url=${cand.stream.url}`);
            setFallbackPlayUrl(cand.stream.url);
            return;
          } catch (err) {
            sendPlayerLog(`[player-page] addon fallback probe err=${String((err as Error)?.message ?? err)}`);
          }
        }
        sendPlayerLog('[player-page] addon fallback: all candidates probed dead');
        // A late videasy resolve no longer cancels this effect (videasy state
        // isn't a dep anymore), so re-check the ref before raising the error
        // overlay — otherwise it would flash over a now-playable videasy source.
        if (cancelled || videasyPlayableRef.current) return;
        setFallbackExhausted(true);
      })();
    });
    return () => { cancelled = true; };
    // videasyResolved / videasySources are intentionally omitted — they flip on
    // every videasy server-switch and would cancel + restart this whole chain.
    // The fallback consults videasyPlayableRef (a ref) instead, so it runs ONCE
    // — plus once more per dead-manifest declaration (videasyDeadNonce), where
    // the ref has flipped false and the re-run commits the RD pick.
  }, [type, id, videoId, url, addons, fallbackPlayUrl, urlIsHevc, pickFirst, rdSelected, metaTitle, resumeUrl, videasyDeadNonce]);

  // Convert Videasy subtitles → SubtitleTrack shape the player expects.
  // Proxy already normalizes lang to an ISO code and rewrites URLs
  // through /addon-proxy with the cineby.sc origin spoof. (Embedded .mkv
  // subs are handled by BlissfulPlayer's own /probe-streams effect, which
  // unwraps the /transcode source URL — see index.tsx.)
  const builtinSubtitles = useMemo(
    () =>
      videasySubs
        .filter((s) => s.url)
        .map((s, i) => ({
          key: `builtin:${i}`,
          lang: (s.lang ?? 'und').toLowerCase(),
          label: s.label ?? s.lang ?? 'Subtitle',
          origin: 'Built-in',
          url: s.url as string,
        })),
    [videasySubs]
  );

  // Web: wait for TMDB + Videasy lookups to settle before mounting the
  // *real* player (otherwise BlissfulPlayer briefly mounts with the wrong
  // URL and unmounts when the resolved one arrives — "loads, then
  // reloads" flash). Return `null` during the wait — the persistent
  // PlayerBufferingScreen rendered at the AppShell level (keyed on
  // pathname.startsWith('/player')) stays visible across this gap, so
  // there's no flash between route mount → TMDB resolve → BlissfulPlayer.
  if (!tmdbResolved) {
    return null;
  }

  // ── Mobile-only stream picker ─────────────────────────────────
  // On phones, when Vidking is unavailable AND we have addon
  // streams ready, skip the in-browser playback path entirely —
  // surface the full Torrentio (+RD) stream list so the user can
  // pick one and open it in VLC. No quality picker, no settings,
  // just stream → VLC. This is the cleanest mobile-fallback UX.
  // Videasy considered "unavailable" if no _playable_ source came
  // back. 4K Videasy streams are HEVC (Chromium MSE rejects) so
  // they always black-screen. "Auto" is the adaptive ladder —
  // sometimes it locks onto the broken 4K bitrate and stalls, but
  // for plenty of titles it serves a clean 1080p/720p track, so
  // we don't pre-strip it. If Auto actually fails at runtime, the
  // RD fallback path takes over via the playback-error handler.
  // 4K filter disabled — any Videasy source is treated as playable now.
  const hasPlayableVideasySource = videasySources.length > 0;
  const vidkingUnavailable =
    !!url
    && /^(vidking|videasy):/i.test(url)
    && !hasPlayableVideasySource;
  // Mobile + Vidking unavailable: surface the stream picker
  // exclusively. The picker itself handles the empty-state copy
  // ("No streams available for this title") so we don't fall
  // through to the desktop "No playable stream" overlay. Give
  // Vidking a 5 s grace window first — show the player's buffer
  // logo (logo → poster → "Buffering" fallback) so the picker
  // doesn't flash on for shows where Vidking actually resolves
  // a moment later.
  // Mobile legacy stream picker — ONLY when there's genuinely nothing to play
  // inline: Vidking is down AND the RD fallback is exhausted with no committed
  // stream. Previously this fired for the WHOLE RD-fallback scenario (url stays
  // `vidking:placeholder` so vidkingUnavailable stays true even while RD plays),
  // so on mobile it replaced the working inline RD player with this picker — and
  // because `isMobile` flips at the 767px breakpoint on rotation, rotating
  // portrait↔landscape swapped between picker and player, remounting the player
  // and re-running the whole Vidking→fallback flow ("Vidking unavailable" again,
  // playback lost). Gating on `fallbackExhausted && !fallbackPlayUrl` makes both
  // orientations render BlissfulPlayer during playback → no remount on rotate.
  if (isMobile && vidkingUnavailable && fallbackExhausted && !fallbackPlayUrl) {
    return (
      <MobileStreamPicker
        streams={addonStreams}
        onBack={() => { window.history.back(); }}
      />
    );
  }
  // Desktop only: no working stream after exhausting both Videasy
  // AND the addon fallback probe loop — surface a clear error
  // with actionable buttons so the user isn't left staring at a
  // black screen.
  if (
    !isMobile
    && fallbackExhausted
    && !fallbackPlayUrl
    && (!url || /^(vidking|videasy):/i.test(url))
  ) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black p-6 text-center text-white">
        <div className="max-w-md space-y-4">
          <div className="text-2xl font-semibold">No playable stream</div>
          <div className="text-sm text-white/70">
            Vidking is currently unavailable and every Real-Debrid
            link for this title returned a takedown notice. Pick a
            different stream from the detail page.
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              className="cursor-pointer rounded-full bg-[var(--bliss-accent)] px-5 py-3 text-sm font-semibold text-black hover:bg-[#14dbb8]"
              onClick={() => {
                if (type && id) window.location.href = `/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
              }}
            >
              Pick a stream from the detail page
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-full bg-white/10 px-5 py-3 text-sm font-medium text-white hover:bg-white/15"
              onClick={() => { window.history.back(); }}
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }
  // Hold the black screen until we have SOMETHING playable: a Videasy
  // source, an addon-stream fallback URL, OR a real playable URL
  // already in the query string (continue-watching / next-episode
  // re-uses the previously-resolved RD link). Skipping the wait when
  // url is already playable avoids the case where Videasy keeps
  // thrashing in the background and traps the player on black even
  // though the existing URL works fine.
  const urlIsPlayable =
    !!url
    && !/^(vidking|videasy):/i.test(url)
    && !urlIsHevc;
  // Once BlissfulPlayer has rendered with a real stream at least
  // once we never unmount it again — falling through with a
  // placeholder URL keeps the watch-party WebSocket connection
  // alive across episode changes (otherwise the host disconnects
  // mid-transition and host migration kicks in). The HLS effect in
  // BlissfulPlayer skips loading on placeholder URLs and holds the
  // in-player buffering overlay instead.
  if (
    tmdbLookup
    && !videasyResolved
    && !fallbackPlayUrl
    && !urlIsPlayable
    && !hasShownPlayerRef.current
  ) {
    return <div className="fixed inset-0 z-[60] bg-black" />;
  }

  // Resolved a Videasy source — play it directly in BlissfulPlayer.
  // Same player path as everything else, just with the .m3u8 URL the
  // Videasy backend returned. Quality selection is lifted here so we
  // can swap props.url when the user picks a different one; BlissfulPlayer
  // preserves currentTime across the swap.
  // 4K filter temporarily disabled — including 2160p variants to see
  // whether Videasy's CDN now serves non-HEVC 4K for some titles
  // (historically Hydrogen-provider 4K was HEVC Main 10 which Chromium
  // MSE rejects with bufferAddCodecError; if the source is actually
  // H.264 4K it should just play). If a 4K stream fails the fallback
  // chain takes over to swap in a lower variant.
  const playableSources = videasySources;
  const activeSource =
    playableSources.find((s) => s.quality === selectedQuality) ??
    playableSources[0] ??
    null;
  // Resolution priority: Videasy source → addon-stream fallback (when
  // Videasy is down) → raw URL from query params (back-compat with
  // direct ?url=… entry points). The raw URL is dropped if it's a
  // known-unplayable codec (HEVC); the fallback effect above is
  // already running to replace it.
  // Real-Debrid fallback (and direct .mkv URLs) can't play in-browser —
  // Matroska/AVI container, AC3/DTS audio, sometimes 10-bit or HEVC video.
  // Route them through the proxy's /transcode.m3u8 endpoint, which serves an
  // HLS VOD (H.264 + AAC, HEVC/10-bit re-encoded as needed). This works on iOS
  // too: /transcode.m3u8 is HLS (iOS's native format) fetched as discrete
  // segments, so the old "iOS keeps the raw URL" carve-out (which left iPad/
  // iPhone trying to play a raw .mkv → endless buffering) is gone. The player
  // routes the /transcode HLS through hls.js where MSE exists (iPad), native
  // HLS otherwise.
  const rawPlay =
    // RD-selected / watch-party relay mode: an exact URL was chosen and passed
    // as `url` — play THAT, nothing else. It must take precedence over
    // `activeSource` (Videasy): navigating into rdsel reuses this mounted
    // component, so a Videasy source from the previous (non-rdsel) playback
    // lingers in `videasySources` and would otherwise override the chosen URL —
    // the "watch-party guest reverts to its own EPIX stream instead of the
    // host's relay" bug. (The HEVC-drop is skipped too: the user explicitly
    // chose this stream; /transcode re-encodes it downstream if needed.)
    rdSelected
      ? (url ?? '')
      : activeSource?.url
        ?? fallbackPlayUrl
        // Drop a bare HEVC URL (Chrome can't decode it) UNLESS it's a container
        // we'll transcode anyway — then keep it so /transcode re-encodes it.
        ?? (urlIsHevc && !TRANSCODE_CONTAINER_RE.test(url ?? '') ? null : url)
        ?? '';
  const basePlayUrl =
    // Already a transcode URL (e.g. a Continue-Watching `resume` that was saved
    // wrapped) — play it as-is; re-wrapping would double-encode the inner URL
    // and the proxy 400s ("bad url").
    rawPlay && /^\/transcode(\.m3u8)?\?/.test(rawPlay)
      ? rawPlay
      : rawPlay && (rawPlay === fallbackPlayUrl || TRANSCODE_CONTAINER_RE.test(rawPlay))
        ? `/transcode.m3u8?url=${encodeURIComponent(rawPlay)}`
        : rawPlay;
  // Selected audio track → the transcode muxes it (&a=N). The &a always
  // reflects audioTrackIdx (which itself is seeded from any &a already in the
  // URL), so strip a pre-existing &a first to avoid doubling it — keeps the
  // played track, the picker, and the host's broadcast all consistent.
  const playUrl = (() => {
    if (!basePlayUrl.startsWith('/transcode.m3u8')) return basePlayUrl;
    const stripped = basePlayUrl.replace(/&a=\d+/g, '');
    return audioTrackIdx > 0 ? `${stripped}&a=${audioTrackIdx}` : stripped;
  })();
  if (!playUrl) return null;
  if (playUrl && !/^(vidking|videasy):/i.test(playUrl)) {
    hasShownPlayerRef.current = true;
  }
  // NOTE: previously we returned a black div whenever playUrl was
  // still a placeholder. That unmounted BlissfulPlayer between
  // episodes, which closed the watch-party WebSocket and triggered
  // a host-migration cycle whenever the host advanced to a new
  // episode (everybody appearing to "rejoin"). Now we pass the
  // placeholder URL through; BlissfulPlayer's HLS effect skips
  // loading on a placeholder while keeping the component (and the
  // useWatchParty WS) mounted. As soon as Videasy resolves, the
  // new URL flows in and the HLS loader takes over.
  if (/^(vidking|videasy):/i.test(playUrl)) {
    sendPlayerLog(
      `[player-page] placeholder url — keeping player mounted, ` +
        `tmdbResolved=${tmdbResolved} tmdbLookup=${JSON.stringify(tmdbLookup)} ` +
        `videasyResolved=${videasyResolved} sources=${videasySources.length}`
    );
  }

  const qualityOptions = playableSources
    .filter((s) => s.quality)
    .map((s) => ({ label: s.quality as string, quality: s.quality as string }));

  return (
    <BlissfulPlayer
      url={playUrl}
      title={title}
      metaTitle={metaTitle}
      poster={poster}
      logo={logo}
      startTimeSeconds={startTime}
      type={type}
      id={id}
      videoId={videoId}
      addons={addons}
      authKey={authKey}
      playerSettings={resolvedPlayerSettings}
      nextEpisodeInfo={nextEpisodeInfo}
      qualityOptions={qualityOptions.length > 1 ? qualityOptions : undefined}
      selectedQuality={selectedQuality}
      onSelectQuality={setSelectedQuality}
      audioTracks={audioTracks.length > 1 ? audioTracks : undefined}
      selectedAudioTrack={audioTrackIdx}
      onSelectAudioTrack={setAudioTrackIdx}
      builtinSubtitles={builtinSubtitles}
      selectedServer={selectedServer}
      onSelectServer={handleSelectServer}
      onSourceDead={handleSourceDead}
      sessionSearch={searchParams.toString()}
      unavailableServers={unavailableServers}
      hideServerPicker={(!!fallbackPlayUrl || pickFirst || rdSelected) && !activeSource}
      releases={(!!fallbackPlayUrl || pickFirst || rdSelected) && !activeSource && addonStreams.length ? addonStreams : undefined}
      selectedReleaseUrl={fallbackPlayUrl ?? (rdSelected ? url : null)}
      onSelectRelease={setFallbackPlayUrl}
      fallbackActive={!!fallbackPlayUrl && !activeSource}
      rdMode={pickFirst || rdSelected}
      autoOpenReleases={pickFirst}
      onReleasesDismissed={() => {
        if (pickFirst && !fallbackPlayUrl && pickFirstBestRef.current) {
          setFallbackPlayUrl(pickFirstBestRef.current);
        }
      }}
      compact={compact}
      onMinimize={minimize}
      onExpand={expand}
      onClosePlayer={closeMiniPlayer}
      roomCode={roomCode}
      description={meta?.meta?.description ?? null}
      imdbRating={
        meta?.meta?.imdbRating != null ? String(meta.meta.imdbRating) : null
      }
      released={meta?.meta?.released ?? meta?.meta?.releaseInfo ?? null}
      background={background ?? null}
      tmdbId={tmdbLookup?.tmdbId ?? null}
      videos={(meta?.meta?.videos ?? []).map((v) => {
        // Cinemeta returns `rating` (string) per episode, with "0"
        // standing in for "no rating". Other addons sometimes ship
        // `imdbRating`. Normalize: treat anything that parses to
        // zero / NaN as missing, then layer the TMDB
        // `episodeRatingOverrides` cache on top so shows Cinemeta
        // doesn't rate still get a per-episode score.
        const ev = v as { rating?: string | number; imdbRating?: string | number };
        const raw = ev.rating ?? ev.imdbRating ?? null;
        const num = raw != null ? Number(raw) : NaN;
        const cinemetaRating = Number.isFinite(num) && num > 0 ? String(raw) : null;
        const rating = cinemetaRating ?? episodeRatingOverrides[v.id] ?? null;
        return {
          id: v.id,
          title: v.title ?? v.name ?? null,
          season: v.season ?? null,
          episode: v.episode ?? v.number ?? null,
          thumbnail: v.thumbnail ?? null,
          released: v.released ?? null,
          description:
            v.description
            ?? (v as { overview?: string }).overview
            ?? null,
          rating,
        };
      })}
    />
  );
}
