import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { getEpisodeTitle } from '../utils';

type EpisodeVideo = {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  released?: string;
  thumbnail?: string;
  description?: string;
  runtime?: string;
  /** Cinemeta ships per-episode rating under the `rating` field (string;
   *  "0" for unrated). The Rating component skips 0 automatically. */
  rating?: number | string | null;
};

type UseEpisodeSelectionParams = {
  type: string;
  id: string;
  isSeriesLike: boolean;
  videos: EpisodeVideo[];
  searchParams: URLSearchParams;
  navigate: NavigateFunction;
  selectedVideoId: string | null;
  setSelectedVideoId: (value: string | null) => void;
};

export function useEpisodeSelection({
  type,
  id,
  isSeriesLike,
  videos,
  searchParams,
  navigate,
  selectedVideoId,
  setSelectedVideoId,
}: UseEpisodeSelectionParams) {
  const [season, setSeason] = useState<number | null>(null);
  const [episodeSearch, setEpisodeSearch] = useState('');
  const [rightMode, setRightMode] = useState<'episodes' | 'streams'>('episodes');

  useEffect(() => {
    if (!isSeriesLike) return;
    const qpVideoId = searchParams.get('videoId');
    if (!qpVideoId) return;
    const decoded = decodeURIComponent(qpVideoId);
    // Exact match first — happens when both Blissful's catalog and the
    // source agree on the videoId shape (typical for Cinemeta).
    if (videos.some((v) => v.id === decoded)) {
      setSelectedVideoId(decoded);
      return;
    }
    // Fallback: Stremio's libraryItem video_id is always
    // `<imdbId>:<season>:<episode>`. When the meta provider uses a
    // different id shape for the same episode (some addons), match by
    // (season, episode) instead so a Continue Watching resume from a
    // Stremio-sourced row still auto-selects the right episode.
    const tail = decoded.split(':').slice(-2);
    if (tail.length === 2) {
      const s = Number.parseInt(tail[0], 10);
      const e = Number.parseInt(tail[1], 10);
      if (Number.isFinite(s) && Number.isFinite(e)) {
        const byNumber = videos.find((v) => v.season === s && v.episode === e);
        if (byNumber) {
          setSelectedVideoId(byNumber.id);
        }
      }
    }
  }, [searchParams, videos, isSeriesLike, setSelectedVideoId]);

  const seasons = useMemo(() => {
    if (!isSeriesLike) return [] as number[];
    const all = new Set<number>();
    for (const v of videos) {
      if (typeof v.season === 'number' && Number.isFinite(v.season)) all.add(v.season);
    }
    return Array.from(all).sort((a, b) => a - b);
  }, [videos, isSeriesLike]);

  useEffect(() => {
    if (!isSeriesLike) {
      setSeason(null);
      setSelectedVideoId(null);
      return;
    }

    if (seasons.length === 0) return;
    if (selectedVideoId) {
      const selected = videos.find((v) => v.id === selectedVideoId) ?? null;
      if (selected && typeof selected.season === 'number' && Number.isFinite(selected.season)) {
        setSeason(selected.season);
        return;
      }
    }
    setSeason((prev) => (prev !== null && seasons.includes(prev) ? prev : seasons.find((s) => s !== 0) ?? seasons[0] ?? null));
  }, [seasons, isSeriesLike, selectedVideoId, videos]);

  const videosForSeason = useMemo(() => {
    if (!isSeriesLike) return [] as EpisodeVideo[];
    const filtered = season === null ? videos : videos.filter((v) => v.season === season);
    return filtered
      .slice()
      .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
      .filter((v) => {
        const needle = episodeSearch.trim().toLowerCase();
        if (!needle) return true;
        // Numeric query — match the episode number exactly. Accepts
        // "3" or "3." (mimicking how episodes are labeled in the UI:
        // "3. The One Where…"). Strip a trailing period before parsing.
        const numericNeedle = needle.replace(/\.$/, '');
        if (/^\d+$/.test(numericNeedle)) {
          const n = Number.parseInt(numericNeedle, 10);
          const ep = typeof v.episode === 'number'
            ? v.episode
            : typeof (v as { number?: number }).number === 'number'
              ? (v as { number?: number }).number!
              : null;
          return ep === n;
        }
        const title = getEpisodeTitle(v).toLowerCase();
        return title.includes(needle);
      });
  }, [episodeSearch, season, videos, isSeriesLike]);

  const selectedEpisodeLabel = useMemo(() => {
    if (!isSeriesLike) return null;
    if (!selectedVideoId) return null;
    const v = videos.find((x) => x.id === selectedVideoId) ?? null;
    const s = typeof v?.season === 'number' ? v.season : null;
    const e = typeof v?.episode === 'number' ? v.episode : typeof (v as any)?.number === 'number' ? (v as any).number : null;
    const title = v ? getEpisodeTitle(v) : selectedVideoId;
    const prefix = s !== null && e !== null ? `S${s}E${e} ` : '';
    return `${prefix}${title}`.trim();
  }, [selectedVideoId, videos, isSeriesLike]);

  const nextEpisode = useMemo(() => {
    if (!isSeriesLike || !selectedVideoId) return null;
    const currentIdx = videosForSeason.findIndex((v) => v.id === selectedVideoId);
    // Next episode in the same season
    if (currentIdx !== -1 && currentIdx < videosForSeason.length - 1) {
      return videosForSeason[currentIdx + 1] ?? null;
    }
    // Last episode in current season — try first episode of the next season
    if (season !== null && seasons.length > 0) {
      const seasonIdx = seasons.indexOf(season);
      if (seasonIdx >= 0 && seasonIdx < seasons.length - 1) {
        const nextSeason = seasons[seasonIdx + 1];
        const nextSeasonVideos = videos
          .filter((v) => v.season === nextSeason)
          .slice()
          .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
        return nextSeasonVideos[0] ?? null;
      }
    }
    return null;
  }, [selectedVideoId, videosForSeason, isSeriesLike, season, seasons, videos]);

  const onSelectEpisode = useCallback(
    (videoId: string) => {
      setSelectedVideoId(videoId);
      navigate(
        `/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}?videoId=${encodeURIComponent(videoId)}`,
        { replace: true }
      );
    },
    [id, navigate, type]
  );

  const onBackToEpisodes = useCallback(() => {
    setSelectedVideoId(null);
    setRightMode('episodes');
    navigate(`/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { replace: true });
  }, [id, navigate, type]);

  const onNextEpisode = useCallback(() => {
    if (!nextEpisode) return;
    setSelectedVideoId(nextEpisode.id);
    navigate(
      `/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}?videoId=${encodeURIComponent(nextEpisode.id)}`,
      { replace: true }
    );
  }, [nextEpisode, type, id, navigate, setSelectedVideoId]);

  useEffect(() => {
    if (!isSeriesLike) return;
    if (selectedVideoId && !videos.some((v) => v.id === selectedVideoId)) {
      setSelectedVideoId(null);
    }
  }, [selectedVideoId, videos, isSeriesLike]);

  useEffect(() => {
    if (!isSeriesLike) return;
    setRightMode(selectedVideoId ? 'streams' : 'episodes');
  }, [selectedVideoId, isSeriesLike]);

  useEffect(() => {
    if (isSeriesLike) return;
    setRightMode('streams');
  }, [type, isSeriesLike]);

  const seasonSelectItems = useMemo(() => {
    return seasons.map((s) => ({ key: String(s), label: s === 0 ? 'Specials' : `Season ${s}` }));
  }, [seasons]);

  const seasonIndex = season === null ? -1 : seasons.indexOf(season);
  const canPrevSeason = seasonIndex > 0;
  const canNextSeason = seasonIndex >= 0 && seasonIndex < seasons.length - 1;

  return {
    season,
    setSeason,
    episodeSearch,
    setEpisodeSearch,
    selectedVideoId,
    setSelectedVideoId,
    rightMode,
    setRightMode,
    seasons,
    seasonIndex,
    canPrevSeason,
    canNextSeason,
    seasonSelectItems,
    videosForSeason,
    selectedEpisodeLabel,
    nextEpisode,
    onSelectEpisode,
    onBackToEpisodes,
    onNextEpisode,
  };
}
