import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import SimplePlayer from '../components/SimplePlayer';
import NativeMpvPlayer from '../components/NativeMpvPlayer';
import { isNativeShell } from '../lib/desktop';
import type { PlayerSettings } from '../lib/playerSettings';
import { useMetaDetails } from '../models/useMetaDetails';

export type NextEpisodeInfo = {
  nextVideoId: string;
  nextEpisodeTitle: string;
  nextSeason: number | null;
  nextEpisode: number | null;
  nextThumbnail: string | null;
};

type MetaVideo = {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  thumbnail?: string;
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
  };
}

export default function PlayerPage() {
  const { addons, authKey, playerSettings } = useAppContext();
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
  const poster = searchParams.get('poster');
  const background = searchParams.get('background');
  const metaTitle = searchParams.get('metaTitle');
  const logo = searchParams.get('logo');

  const type = searchParams.get('type');
  const id = searchParams.get('id');
  const videoId = searchParams.get('videoId');
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

  if (!url) return null;

  // Native Rust shell → libmpv-backed NativeMpvPlayer (non-nullable
  // props, coerce-or-bail at the boundary).
  // Browser/web → SimplePlayer (accepts nullables throughout because
  // it had to handle url-only entry paths before).
  if (isNativeShell()) {
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
        nextEpisodeInfo={nextEpisodeInfo}
      />
    );
  }

  return (
    <SimplePlayer
      url={url}
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
    />
  );
}
