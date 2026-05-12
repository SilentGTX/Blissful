import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { formatDate, getEpisodeTitle } from '../utils';

type EpisodeVideo = {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  released?: string;
  thumbnail?: string;
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
    if (videos.some((v) => v.id === decoded)) {
      setSelectedVideoId(decoded);
    }
  }, [searchParams, videos, isSeriesLike]);

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
        const title = getEpisodeTitle(v).toLowerCase();
        const date = formatDate(v.released)?.toLowerCase() ?? '';
        return title.includes(needle) || date.includes(needle);
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
