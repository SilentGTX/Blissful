import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAddons } from '../context/AddonsProvider';
import { useAuth } from '../context/AuthProvider';
import { useStorage } from '../context/StorageProvider';
import NativeMpvPlayer from '../components/NativeMpvPlayer';
import { isNativeShell } from '../lib/desktop';
import type { PlayerSettings } from '../lib/playerSettings';
import { useMetaDetails } from '../models/useMetaDetails';
import { parseStreamDescription } from '../features/detail/utils';
import { fetchStreams, type StremioStream } from '../lib/stremioAddon';
import { buildMagnetUrl } from '../lib/deepLinks';
import { normalizeStremioImage } from '../lib/mediaTypes';
import type { ReleaseOption } from '../components/NativeMpvPlayer/SettingsPanel';

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
    nextReleased: v.released ?? null,
  };
}

export default function PlayerPage() {
  const { addons } = useAddons();
  const { authKey } = useAuth();
  const { playerSettings, savePlayerSettings } = useStorage();
  const [searchParams] = useSearchParams();
  const [resolvedPlayerSettings, setResolvedPlayerSettings] = useState<PlayerSettings>(playerSettings);

  useEffect(() => {
    setResolvedPlayerSettings(playerSettings);
  }, [playerSettings]);

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

  const type = searchParams.get('type');
  const id = searchParams.get('id');
  const videoId = searchParams.get('videoId');
  const roomCode = searchParams.get('room');
  const isSeriesLike = type === 'series' || type === 'anime';

  const startTime = useMemo(() => {
    const raw = searchParams.get('t');
    if (!raw) return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);

  // Fetch series metadata so we can compute next-episode for chained auto-advance
  // (ep1 → ep2 → ep3 without returning to DetailPage). The metadata is cached in
  // stremioAddon's in-memory cache, so repeated calls for the same series are instant.
  const { meta } = useMetaDetails({
    type: type ?? '',
    id: id ?? '',
    addons,
    enableStreams: false,
  });

  // Show-level presentation metadata — the wordmark logo, title, poster and
  // 16:9 backdrop the buffering veil + PauseOverlay paint. These normally ride
  // in on the `/player?...` query the detail page builds, but not every entry
  // point threads them through (CW resume edge cases, a hand-built deep link,
  // a pre-thin-shell shell), which left the buffering veil stuck on the bare
  // spinner and the PauseOverlay with no wordmark. This page already fetches
  // the same `meta` (for next-episode + description), so fall back to it and
  // keep the native player self-sufficient no matter how it was opened.
  const logo = searchParams.get('logo') ?? normalizeStremioImage(meta?.meta?.logo) ?? null;
  const metaTitle = searchParams.get('metaTitle') ?? meta?.meta?.name ?? null;
  const poster = searchParams.get('poster') ?? normalizeStremioImage(meta?.meta?.poster) ?? null;
  const background =
    searchParams.get('background')
    ?? normalizeStremioImage(meta?.meta?.background)
    ?? normalizeStremioImage(meta?.meta?.poster)
    ?? null;

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

  // Real-Debrid fallback "change torrent" releases. The house RD fallback
  // proxy (/rd-fallback, forwarded by the shell's ui_server) resolves
  // Torrentio-RD with a server-side key and returns key-free direct URLs,
  // already filtered server-side for DMCA-removed (failed_infringement)
  // entries so dead torrents can't be picked. We surface them in the player's
  // "Releases" picker so the user can swap to another release without leaving
  // the player. Only fetched in the native shell (the picker is desktop-only).
  const [releases, setReleases] = useState<ReleaseOption[]>([]);
  useEffect(() => {
    setReleases([]);
    if (!isNativeShell()) return;
    if (!type || !id || (type !== 'movie' && type !== 'series')) return;
    const streamId = type === 'series' && videoId ? videoId : id;
    let cancelled = false;

    // Map a raw stream → ReleaseOption. Prefer a direct http(s) URL; for
    // infoHash-only (P2P) torrents fall back to a magnet URL — the same shape
    // the detail page offers and that the native player resolves via the
    // streaming server — so the picker lists every torrent the detail page does.
    const toRelease = (s: StremioStream): ReleaseOption | null => {
      const directUrl = typeof s.url === 'string' && /^https?:\/\//i.test(s.url) ? s.url : null;
      const url = directUrl ?? buildMagnetUrl(s, s.title ?? s.name ?? 'Torrent');
      if (!url) return null;
      const description = s.description ?? s.title ?? '';
      const parsed = parseStreamDescription(description);
      const hay = `${s.name ?? ''} ${description}`;
      const qualMatch = hay.match(/\b(2160p|4k|1080p|720p|480p|360p)\b/i);
      return {
        name: s.name ?? 'Real-Debrid',
        torrentName: parsed.torrentName ?? (s.title ?? null),
        quality: qualMatch ? qualMatch[1].toLowerCase() : null,
        size: parsed.size,
        seeders: parsed.seeders,
        url,
      };
    };

    const seen = new Set<string>();
    const merge = (list: StremioStream[]) => {
      if (cancelled || list.length === 0) return;
      let added = false;
      setReleases((prev) => {
        const next = prev.slice();
        for (const s of list) {
          const rel = toRelease(s);
          if (!rel || seen.has(rel.url)) continue;
          seen.add(rel.url);
          next.push(rel);
          added = true;
        }
        return added ? next : prev;
      });
    };

    // 1) Addon streams — the SAME source the detail page used, so these are
    //    already in fetchStreams' 5-min cache and resolve INSTANTLY when you
    //    arrived from the detail page. Strip /manifest.json (fetchStreams
    //    appends /stream/<type>/<id>.json to the base). Each addon merges in
    //    as it lands — the picker fills immediately, no waiting on the slow bit.
    for (const a of addons) {
      fetchStreams({
        type,
        id: streamId,
        baseUrl: a.transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, ''),
      })
        .then((r) => merge(r.streams ?? []))
        .catch(() => {});
    }
    // 2) House RD fallback (DMCA-filtered) — uncached + slow (server-side HEAD
    //    probing), so fire it SEPARATELY and merge whenever it arrives. It must
    //    never block the instant addon list above.
    //    Real-Debrid is per-profile: only supplement with the house RD fallback
    //    when THIS profile actually has RD (an RD-configured addon is present).
    //    A no-RD profile (e.g. one whose Torrentio was de-debrided in
    //    useAddonsManager) must not get RD releases leaking in here.
    const hasRd = addons.some((a) => /realdebrid=|\/realdebrid\//i.test(a.transportUrl ?? ''));
    if (hasRd) {
      fetch(`/rd-fallback?type=${type}&id=${encodeURIComponent(streamId)}`)
        .then((r) => (r.ok ? r.json() : { streams: [] }))
        .then((d: { streams?: Array<{ name?: string; title?: string; url?: string }> }) => merge(d.streams ?? []))
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [type, id, videoId, addons]);

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

  if (!url) return null;

  // This page is the DESKTOP player route. Browsers never reach it: the
  // /player route dispatches to <PlayerSeeder/> outside the shell, and the
  // web player (PlayerPageWeb + BlissfulPlayer) renders inside
  // PersistentPlayerHost. The guard is defense-in-depth only.
  if (!isNativeShell()) return null;
  {
    if (!type || !id || (type !== 'movie' && type !== 'series')) return null;
    return (
      <NativeMpvPlayer
        url={url}
        title={title ?? undefined}
        metaTitle={metaTitle ?? undefined}
        poster={poster ?? undefined}
        background={background ?? undefined}
        logo={logo ?? undefined}
        startTimeSeconds={startTime ?? 0}
        type={type}
        id={id}
        videoId={videoId}
        addons={addons}
        authKey={authKey}
        playerSettings={resolvedPlayerSettings}
        savePlayerSettings={savePlayerSettings}
        nextEpisodeInfo={nextEpisodeInfo}
        description={meta?.meta?.description ?? undefined}
        imdbRating={meta?.meta?.imdbRating != null ? String(meta.meta.imdbRating) : undefined}
        releaseInfo={(meta?.meta as Record<string, unknown>)?.releaseInfo as string ?? (meta?.meta as Record<string, unknown>)?.year as string ?? undefined}
        videos={meta?.meta?.videos}
        roomCode={roomCode}
        releases={releases}
      />
    );
  }
}
