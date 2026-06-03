import { Button } from '@heroui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { useAddons } from '../context/AddonsProvider';
import { useAuth } from '../context/AuthProvider';
import { useUI } from '../context/UIProvider';
import { normalizeStremioImage } from '../lib/mediaTypes';
import { getLibraryEntry } from '../lib/libraryStore';
import { useContinueWatchingContext } from '../context/ContinueWatchingProvider';
import { showHeroTransition } from '../lib/heroTransition';
import { consumeClickedPoster, metahubPosterToBackdrop } from '../lib/transitionPoster';
import { getLastStreamSelection } from '../lib/streamHistory';
import { proxyUrl } from '../lib/proxyBase';
import { useMetaDetails } from '../models/useMetaDetails';
import { DesktopActionButtons, MobileActionButtons } from '../features/detail/components/ActionButtons';
import { MetaPanel } from '../features/detail/components/MetaPanel';
import { MobileHero } from '../features/detail/components/MobileHero';
import { DetailStreamsPanel } from '../features/detail/components/DetailStreamsPanel';
import { DetailModals } from '../features/detail/components/DetailModals';
import { useEpisodeSelection } from '../features/detail/hooks/useEpisodeSelection';
import { useStreamFilters } from '../features/detail/hooks/useStreamFilters';
import { useLibraryState } from '../features/detail/hooks/useLibraryState';
import { formatDate, getEpisodeTitle, parseNumber } from '../features/detail/utils';
import { buildStreamsView } from '../features/detail/streams';
import { useImdbRating } from '../lib/useImdbRating';
import { fetchTmdbId, type TmdbLookup } from '../lib/tmdb';
import { UnreleasedEpisodeModal } from '../components/UnreleasedEpisodeModal';
import { StreamUnavailableModal } from '../components/StreamUnavailableModal';
import { useTvFocusable } from '../spatial/useTvFocusable';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { isAndroidTv, isTvMode } from '../lib/platform';
import { isAndroidPlayableUrl, RD_REQUIRED_MESSAGE } from '../lib/androidPlayable';
import { TvDetailLayout } from '../features/detail/tv/TvDetailLayout';
import { computeNextToWatch } from '../features/detail/nextToWatch';



// Back control, extracted so it can own a TV focus node without adding a hook
// to DetailPage's large (conditional-return) body. Reachable via D-pad Up from
// the action row; also responds to the global Esc/Back handler.
function DetailBackButton() {
  const navigate = useNavigate();
  const goBack = () => {
    // Never navigate(-1) — use the tracked safe-back route (AppShell sets it),
    // which avoids landing on /player when arriving from the player back button.
    const safeBack = sessionStorage.getItem('bliss:safe-back') ?? '/';
    navigate(safeBack);
  };
  const { ref } = useTvFocusable({ onPress: goBack });
  return (
    <div ref={ref} className="fixed left-4 top-4 z-50 lg:absolute lg:left-5 lg:top-5 lg:z-20">
      <Button
        variant="ghost"
        className="rounded-full bg-black/50 text-white backdrop-blur lg:bg-white/10"
        onPress={goBack}
      >
        Back
      </Button>
    </div>
  );
}

export default function DetailPage() {
  const { addons } = useAddons();
  const { authKey } = useAuth();
  const { setQuery, uiStyle } = useUI();
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const heroImageFromNav: string | undefined = (location.state as { heroImage?: string } | null)?.heroImage;
  const isNetflix = uiStyle === 'netflix';

  const type = (params.type ?? 'movie') as string;
  const id = params.id ? decodeURIComponent(params.id) : '';
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  // Click context captured from the MediaCard the user just clicked.
  // `posterUrl` is the small card poster (last-resort fallback); `backdropUrl`
  // is the deterministically-derived high-res landscape URL (metahub) that
  // was already preloaded at click time. When this is null (e.g. back-nav
  // from /player) the FLIP layer is suppressed — there's no card source to
  // animate from.
  const [flipClick] = useState(() => consumeClickedPoster(type, id));
  const flipPoster = flipClick?.posterUrl ?? null;
  const guessedBackdrop = flipClick?.backdropUrl ?? null;

  // Prefetch the PlayerPage chunk as soon as the user lands on DetailPage —
  // by the time they click Play, the lazy chunk is already in the browser
  // cache so Suspense resolves on the first frame, leaving the
  // `bliss-player-enter` scale animation as the only visible delay.
  useEffect(() => {
    void import('./PlayerPage');
  }, []);

  const {
    selectedAddon,
    setSelectedAddon,
    streamSortKey,
  } = useStreamFilters();

  const [logoFailed, setLogoFailed] = useState(false);

  const isSeriesLike = type === 'series' || type === 'anime';

  // The TV layout (full-bleed + stream popup) is a separate component below; the
  // desktop layout keeps its right aside. This boundary is inert now (TV uses
  // TvDetailLayout, desktop doesn't run Norigin) but the ref/key are still
  // referenced by the desktop aside JSX.
  const tvMode = isTvMode();
  const { ref: asideFocusRef, focusKey: asideFocusKey } = useFocusable({
    focusable: false,
    saveLastFocusedChild: true,
    trackChildren: true,
  });

  const lastStream = useMemo(() => {
    if (!type || !id) return null;
    const vid = isSeriesLike ? (selectedVideoId ?? null) : null;
    return getLastStreamSelection({ authKey, type, id, videoId: vid });
  }, [authKey, id, selectedVideoId, type, isSeriesLike]);

  const [isTrailerOpen, setIsTrailerOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  // progress is used via the streams model's deepLinks.

  // Series: streams should only appear after explicit episode selection.
  const enableStreams = !isSeriesLike || selectedVideoId !== null;

  const { meta, metaLoading, streamsByAddon, streamsLoading } = useMetaDetails({
    type,
    id,
    streamVideoId: selectedVideoId,
    addons,
    enableStreams,
  });

  const videos = meta?.meta?.videos ?? [];

  // Stremio WatchedBitField is indexed by each video's position in the
  // ordered meta `videos` list, so feed those ids (native order, not
  // re-sorted) into the library hook for decoding. Memoized so its identity
  // is stable across renders that don't change the episode list.
  const orderedVideoIds = useMemo(() => videos.map((v) => v.id), [videos]);

  const {
    inLibrary,
    handleToggleLibrary,
    getEpisodeProgressInfo,
    libraryVersion,
    watchedVideoIds,
    watchedDecoded,
    stremioLibraryItem,
  } = useLibraryState({
    authKey,
    id,
    type,
    metaName: meta?.meta?.name ?? null,
    metaPoster: meta?.meta?.poster ?? null,
    orderedVideoIds,
  });

  // The last-played episode id, from the cloud/Blissful library state — the
  // same field useContinueWatchingActions reads. Drives the resume-vs-advance
  // "next to watch" decision below.
  const lastPlayedVideoId =
    ((stremioLibraryItem?.state as { video_id?: string | null } | undefined)?.video_id ??
      (stremioLibraryItem?.behaviorHints?.defaultVideoId ?? null)) ||
    null;

  // The library decode (watchedVideoIds) is async; gate any consumption of
  // `nextToWatch` on BOTH the library item having loaded AND the WatchedBitField
  // having actually decoded — otherwise computeNextToWatch sees an empty watched
  // set, transiently picks episode 1, and latches the wrong season (breaking the
  // next-to-watch landing for cross-season shows + causing a focus flash).
  const watchedReady = stremioLibraryItem !== null && watchedDecoded;

  const nextToWatch = useMemo(() => {
    if (!isSeriesLike) return null;
    if (!watchedReady) return null;
    const lp = lastPlayedVideoId ? getEpisodeProgressInfo(lastPlayedVideoId) : null;
    return computeNextToWatch({
      videos,
      watchedIds: watchedVideoIds,
      lastPlayedVideoId,
      lastPlayedProgress: lp
        ? { timeSeconds: lp.timeSeconds, durationSeconds: lp.durationSeconds }
        : null,
    });
  }, [isSeriesLike, watchedReady, videos, watchedVideoIds, lastPlayedVideoId, getEpisodeProgressInfo]);

  const {
    season,
    setSeason,
    rightMode,
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
  } = useEpisodeSelection({
    type,
    id,
    isSeriesLike,
    videos,
    searchParams,
    navigate,
    selectedVideoId,
    setSelectedVideoId,
  });

  // Keep sessionStorage in sync with the computed nextEpisode so that any
  // navigation path to the player (web player, external prompt, iOS drawer)
  // will find the data already written.
  useEffect(() => {
    if (!isSeriesLike || !id) return;
    if (!nextEpisode) {
      try { sessionStorage.removeItem(`bliss:nextEpisode:${type}:${id}`); } catch { /* ignore */ }
      return;
    }
    try {
      const s = typeof nextEpisode.season === 'number' ? nextEpisode.season : null;
      const e = typeof nextEpisode.episode === 'number' ? nextEpisode.episode : null;
      const title = nextEpisode.title ?? nextEpisode.name ?? nextEpisode.id;
      const prefix = s !== null && e !== null ? `S${s}E${e}` : '';
      const nextLabel = `${prefix}${prefix && title ? ' \u2014 ' : ''}${title}`.trim();
      sessionStorage.setItem(
        `bliss:nextEpisode:${type}:${id}`,
        JSON.stringify({
          nextVideoId: nextEpisode.id,
          nextEpisodeTitle: nextLabel,
          nextSeason: s,
          nextEpisode: e,
          nextThumbnail: nextEpisode.thumbnail ?? null,
          nextReleased: typeof (nextEpisode as { released?: string }).released === 'string'
            ? (nextEpisode as { released?: string }).released
            : null,
        }),
      );
    } catch { /* sessionStorage may be unavailable */ }
  }, [isSeriesLike, id, type, nextEpisode]);

  // TV: when a series is opened WITHOUT an explicit ?videoId (from a poster, or
  // the Continue-Watching "advance" flow when there's no meaningful resume),
  // land the episodes rail on the next-to-watch episode's SEASON. We do NOT set
  // selectedVideoId (that would force the stream popup open) — TvDetailLayout
  // then focuses the next-to-watch card in the bottom rail. TV-gated; desktop
  // untouched.
  const nextSeason = useMemo(() => {
    if (!nextToWatch) return null;
    const v = videos.find((x) => x.id === nextToWatch.videoId);
    return typeof v?.season === 'number' ? v.season : null;
  }, [nextToWatch, videos]);
  // Keyed by id (not a bare boolean) so navigating detail->detail (e.g. a
  // similar-titles press, which reuses this DetailPage instance — the route has
  // no key) re-applies the next-to-watch season for the NEW series instead of
  // staying latched on the previous one.
  const defaultSeasonAppliedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tvMode || !isSeriesLike) return;
    if (defaultSeasonAppliedForRef.current === id) return;
    if (selectedVideoId || searchParams.get('videoId')) return;
    if (nextSeason == null) return;
    defaultSeasonAppliedForRef.current = id;
    setSeason(nextSeason);
  }, [tvMode, isSeriesLike, selectedVideoId, searchParams, nextSeason, setSeason, id]);

  const streamsViewDesktop = useMemo(
    () =>
      buildStreamsView(streamsByAddon, {
        selectedAddon,
        streamSortKey,
        lastStreamUrl: lastStream?.url ?? null,
      }),
    [lastStream, selectedAddon, streamSortKey, streamsByAddon]
  );

  const streamsViewMobile = useMemo(
    () =>
      buildStreamsView(streamsByAddon, {
        selectedAddon,
        streamSortKey,
        lastStreamUrl: lastStream?.url ?? null,
      }),
    [lastStream, selectedAddon, streamSortKey, streamsByAddon]
  );

  const desktopRows = streamsViewDesktop.rows;

  // Desktop app: show ALL addon streams, not just Torrentio RD.
  const mobileTorrentioRows = streamsViewMobile.rows;

  const addonSelectItems = useMemo(() => {
    const items: Array<{ key: string; label: string }> = [{ key: 'ALL', label: 'All addons' }];
    for (const [transportUrl, group] of Object.entries(streamsByAddon)) {
      if (group.streams.length === 0) continue;
      items.push({ key: transportUrl, label: group.addonName });
    }
    return items;
  }, [streamsByAddon]);

  // Fallback poster: when the addon meta doesn't ship a poster /
  // background (rare but happens), reuse whatever the ResumeOrStart
  // modal would have shown — i.e. the poster the user already saw
  // in Continue Watching or in their local library. Keeps the page
  // from being a black slab in that edge case.
  const { continueWatching } = useContinueWatchingContext();
  const fallbackPoster = useMemo(() => {
    if (!id) return null;
    const cw = continueWatching.find((it) => it._id === id && it.type === type)?.poster;
    if (cw) return normalizeStremioImage(cw);
    const lib = getLibraryEntry({ type, id })?.poster;
    return lib ? normalizeStremioImage(lib) : null;
  }, [continueWatching, id, type]);

  // When meta is still loading on a fresh mount (e.g. back-nav from /player),
  // the only image we have is the CW/library poster — which on metahub is the
  // tiny `poster/small/...` URL stretched across the viewport. Derive the
  // matching `background/medium/...` URL from it so the persistent backdrop
  // renders high-res from frame 1 instead of a blurry small poster.
  const fallbackBackdropFromUrl = metahubPosterToBackdrop(fallbackPoster);
  const background =
    normalizeStremioImage(meta?.meta?.background)
    ?? normalizeStremioImage(meta?.meta?.poster)
    ?? fallbackBackdropFromUrl
    ?? fallbackPoster;
  const poster =
    normalizeStremioImage(meta?.meta?.poster)
    ?? fallbackPoster
    ?? background;
  const logo = normalizeStremioImage(meta?.meta?.logo);
  // High-res landscape backdrop from addon meta (no low-res fallback).
  // This is the image the FLIP layer should morph into — same URL the
  // persistent `background-image-tSjYu` backdrop renders, so the layer's
  // fade-out is a seamless handoff. Falls back to `meta.meta.poster` only
  // if no background is provided by the addon.
  const highResBackdrop =
    normalizeStremioImage(meta?.meta?.background)
    ?? normalizeStremioImage(meta?.meta?.poster);

  // Preload the meta-supplied backdrop (network-warm the bitmap) so the
  // persistent `.background-image-tSjYu` layer's dim-in animation has
  // something to paint as soon as it mounts, rather than running on
  // an empty `<img>` slot for the first few hundred ms.
  useEffect(() => {
    if (!flipPoster || !highResBackdrop || highResBackdrop === guessedBackdrop) {
      return;
    }
    const img = new Image();
    img.src = highResBackdrop;
  }, [flipPoster, highResBackdrop, guessedBackdrop]);

  useEffect(() => {
    if (!heroImageFromNav) return;
    const safety = setTimeout(() => showHeroTransition(null), 1500);
    return () => clearTimeout(safety);
  }, [heroImageFromNav]);
  useEffect(() => {
    if (!heroImageFromNav || !background) return;
    const img = new Image();
    img.src = background;
    const clear = () => showHeroTransition(null);
    if (img.complete) { clear(); return; }
    img.onload = clear;
    img.onerror = clear;
    return () => { img.onload = null; img.onerror = null; };
  }, [background, heroImageFromNav]);

  const streamsLoadingFiltered = useMemo(() => {
    if (!streamsLoading) return false;
    if (selectedAddon === 'ALL') return true;
    return !streamsByAddon[selectedAddon];
  }, [selectedAddon, streamsByAddon, streamsLoading]);

  const handleSelectAddon = useCallback(
    (key: string) => {
      setSelectedAddon(key);
    },
    [setSelectedAddon]
  );

  const runtime = meta?.meta?.runtime ?? null;
  const released = formatDate(meta?.meta?.released);
  const releaseInfo = meta?.meta?.releaseInfo ?? null;
  const imdbRating = parseNumber(meta?.meta?.imdbRating);
  const imdbId = meta?.meta?.imdb_id ?? (id.startsWith('tt') ? id : null);
  const resolvedImdbRating = useImdbRating(imdbId, imdbRating);
  const genres: string[] = meta?.meta?.genres ?? meta?.meta?.genre ?? [];
  const cast: string[] = meta?.meta?.cast ?? [];
  const logoTitle = meta?.meta?.name ?? '';

  void libraryVersion;
  const trailerStreams = meta?.meta?.trailerStreams ?? [];
  const firstTrailerId = trailerStreams[0]?.ytId ?? null;

  const handleOpenTrailer = useCallback(() => {
    if (!firstTrailerId) return;
    setIsTrailerOpen(true);
  }, [firstTrailerId]);

  const handleShare = useCallback(() => {
    setIsShareOpen(true);
  }, []);

  // Look up TMDB id for per-episode ratings. Cached in sessionStorage
  // by lib/tmdb.ts. Null until lookup completes.
  const [tmdbLookup, setTmdbLookup] = useState<TmdbLookup | null>(null);
  useEffect(() => {
    if (!imdbId) return;
    let cancelled = false;
    void fetchTmdbId(imdbId).then((result) => {
      if (!cancelled) setTmdbLookup(result);
    });
    return () => {
      cancelled = true;
    };
  }, [imdbId]);

  // Per-season TMDB metadata cache: { [season]: { [episodeNumber]: rating } }.
  // Fetched when the user picks a season; powers the per-episode rating
  // chip in EpisodePanel since Cinemeta's `rating` field is "0" for
  // most episodes.
  const [episodeRatingsBySeason, setEpisodeRatingsBySeason] = useState<
    Record<number, Record<number, number>>
  >({});
  const [episodeStillsBySeason, setEpisodeStillsBySeason] = useState<
    Record<number, Record<number, string>>
  >({});
  useEffect(() => {
    if (!isSeriesLike) return;
    const tid = tmdbLookup?.tmdbId;
    if (!tid) return;
    if (season == null) return;
    if (episodeStillsBySeason[season] != null) return;
    const s = season;
    let cancelled = false;
    type TmdbEp = { episode_number: number | null; vote_average: number | null; still?: string | null };
    const fetchSeason = (n: number): Promise<TmdbEp[]> =>
      fetch(proxyUrl(`/tmdb-season-info?tmdbId=${tid}&season=${n}`))
        .then((r) => r.json())
        .then((d: { episodes?: TmdbEp[] }) => d.episodes ?? [])
        .catch(() => []);
    void (async () => {
      let eps = await fetchSeason(s);
      // Many anime are listed on TMDB as a single absolute-numbered
      // season, so a per-season request for S2+ comes back empty. Detect
      // that, refetch season 1 (absolute), and shift episode numbers by
      // the count of earlier Cinemeta episodes so the maps stay keyed by
      // the in-season episode number EpisodePanel looks up.
      let offset = 0;
      if (eps.length === 0 && s > 1) {
        offset = videos.filter(
          (v) => typeof v.season === 'number' && v.season > 0 && v.season < s,
        ).length;
        eps = await fetchSeason(1);
      }
      if (cancelled) return;
      const map: Record<number, number> = {};
      const stills: Record<number, string> = {};
      for (const e of eps) {
        if (e.episode_number == null) continue;
        const ep = e.episode_number - offset;
        if (ep < 1) continue;
        if (e.vote_average != null) map[ep] = e.vote_average;
        if (e.still) stills[ep] = e.still;
      }
      setEpisodeRatingsBySeason((prev) => ({ ...prev, [s]: map }));
      setEpisodeStillsBySeason((prev) => ({ ...prev, [s]: stills }));
    })();
    return () => {
      cancelled = true;
    };
  }, [isSeriesLike, tmdbLookup?.tmdbId, season, videos, episodeStillsBySeason]);
  const currentSeasonRatings = season != null ? episodeRatingsBySeason[season] : undefined;
  const currentSeasonStills = season != null ? episodeStillsBySeason[season] : undefined;
  // True while the season's TMDB still fetch is still in flight, so the
  // episode cards keep a skeleton up instead of flashing the show poster.
  const episodeStillsPending =
    isSeriesLike && !!tmdbLookup?.tmdbId && season != null && episodeStillsBySeason[season] == null;

  // Mobile hero poster (poster is preferred over background for clarity)
  const heroPoster = normalizeStremioImage(meta?.meta?.background) ?? normalizeStremioImage(meta?.meta?.poster);

  // Modal shown when the user tries to play an episode that hasn't
  // aired yet. Cinemeta lists every scheduled episode with a future
  // `released` timestamp; trying to resolve a stream for it just
  // burns the whole pipeline only to fail. Block it at the source
  // and tell the user when it'll be available.
  const [unreleasedEpisode, setUnreleasedEpisode] = useState<
    {
      season: number | null;
      episode: number | null;
      title: string | null;
      released: string | null;
      thumbnail: string | null;
    } | null
  >(null);

  // RD-ONLY Android: shown when the user taps a stream that needs the
  // (absent) local torrent server — i.e. a magnet or /stremio-server URL.
  const [rdRequired, setRdRequired] = useState(false);

  const handleNavigateToPlayer = useCallback(
    // Returns true if it actually navigated to the player, false if it bailed
    // to a modal (RD-required / unreleased). The TV stream popup uses this to
    // decide whether to close itself: closing navigates to /detail with
    // `replace`, which would clobber a just-issued /player push and bounce the
    // user straight back — so it must only close on the bail paths.
    (playerLink: string, options?: { replace?: boolean }): boolean => {
      const url = new URL(playerLink, window.location.origin);
      // RD-ONLY Android: block magnet / local-server streams that cannot
      // play without the (absent) torrent server. Desktop/browser are
      // unaffected (isAndroidTv() === false → guard skipped entirely).
      if (isAndroidTv()) {
        const targetUrl = url.searchParams.get('url');
        if (!isAndroidPlayableUrl(targetUrl)) {
          setRdRequired(true);
          return false;
        }
      }
      // Block playback of unreleased TV episodes. Only kicks in for
      // /player URLs that target a series videoId we can look up in
      // meta.videos.
      const targetVideoId = url.searchParams.get('videoId');
      if (targetVideoId && url.pathname === '/player') {
        const vmeta = (meta?.meta?.videos ?? []).find((v) => v.id === targetVideoId);
        const releasedAt = vmeta?.released ? Date.parse(vmeta.released) : NaN;
        if (Number.isFinite(releasedAt) && releasedAt > Date.now()) {
          setUnreleasedEpisode({
            season: vmeta?.season ?? null,
            episode: vmeta?.episode ?? null,
            title: vmeta?.title ?? vmeta?.name ?? null,
            released: vmeta?.released ?? null,
            thumbnail: vmeta?.thumbnail ?? null,
          });
          return false;
        }
      }
      if (poster && !url.searchParams.get('poster')) {
        url.searchParams.set('poster', poster);
      }
      // Wide 16:9 backdrop — used by the player's buffering veil so
      // the initial loading screen isn't a stretched vertical poster.
      if (background && !url.searchParams.get('background')) {
        url.searchParams.set('background', background);
      }
      if (meta?.meta?.name && !url.searchParams.get('metaTitle')) {
        url.searchParams.set('metaTitle', meta.meta.name);
      }
      if (logo && !url.searchParams.get('logo')) {
        url.searchParams.set('logo', logo);
      }
      // Carry the room code through so the player joins the party
      // after picking a stream from the detail page.
      const roomCode = searchParams.get('room');
      if (roomCode && !url.searchParams.get('room')) {
        url.searchParams.set('room', roomCode);
      }

      // sessionStorage for next-episode is now written by useEffect above

      navigate(`${url.pathname}?${url.searchParams.toString()}`, {
        replace: options?.replace === true,
      });
      return true;
    },
    [poster, background, meta, logo, navigate]
  );

  // Auto-resume from Continue Watching when there's no locally-stored
  // stream URL. The sidebar's `useContinueWatchingActions` lands the
  // user here with `?autoplay=1&t=<sec>` (+ videoId for series). Once
  // streams resolve, we grab the highest-ranked row's playerLink and
  // forward to /player. Fires exactly once per landing. Declared AFTER
  // `handleNavigateToPlayer` so the closure isn't a TDZ trap on render.
  const autoplayFlag = searchParams.get('autoplay');
  const autoplayTimeRaw = searchParams.get('t');
  const autoplaySkipUrls = searchParams.getAll('skip');
  const autoplayConsumedRef = useRef(false);
  useEffect(() => {
    if (autoplayFlag !== '1') return;
    if (autoplayConsumedRef.current) return;
    if (streamsLoadingFiltered) return;
    if (!desktopRows || desktopRows.length === 0) return;
    // Walk the ranked rows in order, skipping any URL that the player
    // already proved dead and bounced back with via `?skip=`. This is
    // the loop-breaker: without it, the same top row keeps getting
    // re-selected and the player keeps bouncing back to detail.
    const skipSet = new Set(autoplaySkipUrls.filter((s) => s && s.length > 0));
    const top = desktopRows.find((row) => {
      const link =
        (row.stream as { deepLinks?: { player?: string | null } }).deepLinks?.player ?? null;
      if (!link) return false;
      try {
        const u = new URL(link, window.location.origin);
        const candidate = u.searchParams.get('url') ?? '';
        return !skipSet.has(candidate);
      } catch {
        return true;
      }
    });
    if (!top) {
      autoplayConsumedRef.current = true;
      // Every ranked stream was already proven dead. Strip the autoplay /
      // skip params via `replace` so the URL is clean and the next Back
      // press lands on the entry the user came from instead of replaying
      // this dead-end auto-fallback. Without this the user is stuck on a
      // URL like `?autoplay=1&skip=A&skip=B` and Back appears to do
      // nothing because the previous history entry is also /detail.
      const fallbackCleaned = new URLSearchParams(searchParams);
      fallbackCleaned.delete('autoplay');
      fallbackCleaned.delete('t');
      fallbackCleaned.delete('skip');
      const fallbackQs = fallbackCleaned.toString();
      navigate(
        `/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}${fallbackQs ? `?${fallbackQs}` : ''
        }`,
        { replace: true },
      );
      return;
    }
    const link =
      (top.stream as { deepLinks?: { player?: string | null } }).deepLinks?.player ?? null;
    if (!link) return;
    autoplayConsumedRef.current = true;

    // Strip ?autoplay=1&t=...&skip=... from the DetailPage URL via
    // `replace` so the back button from the player lands on a clean
    // detail URL — otherwise this effect re-runs on re-mount and
    // bounces the user straight back into the player in an infinite
    // loop. The skip list is now baked into the player URL itself.
    const cleaned = new URLSearchParams(searchParams);
    cleaned.delete('autoplay');
    cleaned.delete('t');
    cleaned.delete('skip');
    const cleanedQs = cleaned.toString();
    navigate(
      `/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}${cleanedQs ? `?${cleanedQs}` : ''
      }`,
      { replace: true },
    );

    const [path, qs = ''] = link.split('?');
    const params = new URLSearchParams(qs);
    if (autoplayTimeRaw && Number.parseInt(autoplayTimeRaw, 10) > 0) {
      params.set('t', autoplayTimeRaw);
    }
    for (const skipUrl of skipSet) params.append('skip', skipUrl);
    // `replace: true` so the chain of dead-stream redirects doesn't pile
    // up history entries. Each cycle (detail-autoplay -> player -> detail-
    // autoplay -> ...) stays at the same history slot. Back from detail
    // after this chain lands on whatever the user clicked from (sidebar,
    // home, etc.), not on a stack of redundant /detail entries.
    handleNavigateToPlayer(`${path}?${params.toString()}`, { replace: true });
  }, [
    autoplayFlag,
    autoplayTimeRaw,
    autoplaySkipUrls,
    streamsLoadingFiltered,
    desktopRows,
    handleNavigateToPlayer,
    navigate,
    searchParams,
    type,
    id,
  ]);

  const sharedStreamsPanelProps = {
    isSeriesLike,
    // Desktop: let the panel switch between episodes and streams
    // so users can pick a torrent source after selecting an episode.
    rightMode,
    selectedVideoId,
    selectedEpisodeLabel,
    nextEpisode,
    onBackToEpisodes,
    onNextEpisode,
    season,
    seasonSelectItems,
    onSeasonChange: (next: number | null) => setSeason(next),
    canPrevSeason,
    canNextSeason,
    onPrevSeason: () => {
      if (!canPrevSeason) return;
      setSeason(seasons[seasonIndex - 1] ?? null);
    },
    onNextSeason: () => {
      if (!canNextSeason) return;
      setSeason(seasons[seasonIndex + 1] ?? null);
    },
    videosForSeason,
    showRuntime: (meta?.meta?.runtime as string | null | undefined) ?? null,
    showRating: meta?.meta?.imdbRating ?? null,
    showImdbId: /^tt\d{5,}$/.test(id) ? id : null,
    episodeRatings: currentSeasonRatings,
    episodeStills: currentSeasonStills,
    episodeStillsPending,
    fallbackPoster,
    allVideos: videos,
    tmdbId: tmdbLookup?.tmdbId ?? null,
    // Select an episode → switch to stream picker so the user can
    // choose a torrent source. No auto-play.
    onSelectEpisode,
    getEpisodeProgressInfo,
    normalizeImage: normalizeStremioImage,
    formatDate,
    getEpisodeTitle,
    addonSelectItems,
    selectedAddon,
    onSelectAddon: handleSelectAddon,
    streamsLoading: streamsLoadingFiltered,
    type,
    id,
    metaName: meta?.meta?.name ?? null,
    metaPoster: meta?.meta?.poster ?? null,
    onNavigate: handleNavigateToPlayer,
  } as const;

  // Hide the mobile stream picker entirely for movies on web (Play
  // button on detail page replaces it). Series keep the panel — it
  // hosts the episode list — but its rightMode is locked to 'episodes'
  // so the stream view never appears.
  const hideMobileStreamPicker = false;
  const TorrentsContent = (
    <div className="block px-4 pb-6 lg:hidden">
      {!hideMobileStreamPicker && (isSeriesLike || type === 'movie' || type === 'tv' || type === 'channel') ? (
        <div className="rounded-[20px] bg-transparent backdrop-blur-sm">
          <DetailStreamsPanel
            variant="mobile"
            streamRows={mobileTorrentioRows}
            {...sharedStreamsPanelProps}
          />
        </div>
      ) : null}
    </div>
  );


  const MetaContent = (
    <div className={isSeriesLike ? 'h-full overflow-hidden' : 'h-full overflow-auto hide-scrollbar'}>
      <MetaPanel
        logo={logo ?? null}
        logoTitle={logoTitle}
        logoFailed={logoFailed}
        onLogoError={() => setLogoFailed(true)}
        runtime={runtime}
        released={released}
        releaseInfo={releaseInfo}
        imdbRating={resolvedImdbRating}
        genres={genres}
        onGenreClick={(g) => {
          setQuery('');
          const qs = new URLSearchParams({ genre: g });
          navigate(
            `/discover/${encodeURIComponent('https://v3-cinemeta.strem.io/manifest.json')}/${type}/top?${qs.toString()}`
          );
        }}
        cast={cast}
        onCastClick={(c) => navigate(`/search?search=${encodeURIComponent(c)}`)}
        description={meta?.meta?.description ?? null}
        isLoading={metaLoading}
      />
      {TorrentsContent}
      <div className="mt-6 lg:mt-10" />
    </div>
  );


  // Autoplay short-circuit: when we arrived via the Continue-Watching
  // auto-resume flow (sidebar HEAD probe failed, or post-load auto-
  // fallback from a dead player URL), DON'T render the detail page at
  // all. Just paint a black screen with the pulsing movie logo —
  // identical to the player's buffering veil — so when the auto-pick
  // effect navigates to /player the swap is invisible.
  //
  // Crucially: the previous fade-in approach still rendered the picker
  // on frame 1 (overlay was opacity:0 → 1). Returning early eliminates
  // that frame entirely. All hooks above keep running so the auto-pick
  // effect still fires.
  if (autoplayFlag === '1') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black">
        <div className="bliss-buffering-panel">
          {/* Logo only — a vertical poster painted at logo dimensions
              looks like the wrong image; titles without a meta logo
              fall through to the "Loading" text. */}
          {logo ? (
            <img
              className="bliss-buffering-loader"
              src={logo}
              alt=" "
            />
          ) : null}
        </div>
      </div>
    );
  }

  // Graceful empty state. Some ids exist on IMDB but have no entry in
  // any of our meta sources (Cinemeta only indexes titles above a
  // popularity threshold; fringe/niche titles — often reached via a
  // stale link or a leftover Kitsu Continue-Watching row — return `{}`).
  // Without this guard the page renders its full layout against a null
  // `meta` and the user sees a black void with no way out. Only triggers
  // once loading is done AND there's no fallback poster to paint (so a
  // known title mid-load still shows its backdrop).
  if (!metaLoading && !meta?.meta && !fallbackPoster) {
    return (
      <div className="relative z-10 flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <div className="font-[Instrument_Serif] text-2xl font-semibold text-white">
          Title unavailable
        </div>
        <div className="max-w-md text-sm text-foreground/60">
          We couldn&rsquo;t find details for this title. It may be too obscure for
          our metadata sources, or the link may be out of date.
        </div>
        <Button
          variant="ghost"
          className="mt-2 rounded-full bg-white/10 text-white"
          onPress={() => {
            const safeBack = sessionStorage.getItem('bliss:safe-back') ?? '/';
            navigate(safeBack);
          }}
        >
          Back
        </Button>
      </div>
    );
  }

  // TV: full-bleed 10-foot layout (hero + bottom episodes/similar row + stream
  // popup). Rendered AFTER the autoplay + empty-state early returns so those
  // still fire. Desktop keeps the existing layout below.
  if (tvMode) {
    return (
      <TvDetailLayout
        background={background ?? null}
        logo={logo ?? null}
        logoTitle={logoTitle}
        logoFailed={logoFailed}
        onLogoError={() => setLogoFailed(true)}
        runtime={runtime}
        released={released}
        releaseInfo={releaseInfo}
        resolvedImdbRating={resolvedImdbRating}
        genres={genres}
        onGenreClick={(g) => {
          setQuery('');
          const qs = new URLSearchParams({ genre: g });
          navigate(
            `/discover/${encodeURIComponent('https://v3-cinemeta.strem.io/manifest.json')}/${type}/top?${qs.toString()}`
          );
        }}
        cast={cast}
        onCastClick={(c) => navigate(`/search?search=${encodeURIComponent(c)}`)}
        description={meta?.meta?.description ?? null}
        type={type}
        id={id}
        isSeriesLike={isSeriesLike}
        metaName={meta?.meta?.name ?? null}
        metaPoster={meta?.meta?.poster ?? null}
        inLibrary={inLibrary}
        onToggleLibrary={handleToggleLibrary}
        isLoggedIn={Boolean(authKey)}
        hasTrailer={Boolean(firstTrailerId)}
        onOpenTrailer={handleOpenTrailer}
        onShare={handleShare}
        onBack={() => navigate(sessionStorage.getItem('bliss:safe-back') ?? '/')}
        streamRows={desktopRows}
        streamsLoading={streamsLoadingFiltered}
        addonSelectItems={addonSelectItems}
        selectedAddon={selectedAddon}
        onSelectAddon={handleSelectAddon}
        selectedVideoId={selectedVideoId}
        selectedEpisodeLabel={selectedEpisodeLabel}
        onBackToEpisodes={onBackToEpisodes}
        onNavigate={handleNavigateToPlayer}
        getEpisodeProgressInfo={getEpisodeProgressInfo}
        season={season}
        seasonSelectItems={seasonSelectItems}
        onSeasonChange={(next) => setSeason(next)}
        canPrevSeason={canPrevSeason}
        canNextSeason={canNextSeason}
        onPrevSeason={() => {
          if (canPrevSeason) setSeason(seasons[seasonIndex - 1] ?? null);
        }}
        onNextSeason={() => {
          if (canNextSeason) setSeason(seasons[seasonIndex + 1] ?? null);
        }}
        videosForSeason={videosForSeason}
        autoFocusVideoId={nextToWatch?.videoId ?? null}
        episodeRatings={currentSeasonRatings}
        episodeStills={currentSeasonStills}
        episodeStillsPending={episodeStillsPending}
        fallbackPoster={fallbackPoster}
        showRuntime={(meta?.meta?.runtime as string | null | undefined) ?? null}
        normalizeImage={normalizeStremioImage}
        formatDate={formatDate}
        getEpisodeTitle={getEpisodeTitle}
        onSelectEpisode={onSelectEpisode}
        onSimilarPress={(item) => navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`)}
        modals={
          <>
            <DetailModals
              isTrailerOpen={isTrailerOpen}
              onTrailerOpenChange={(open) => setIsTrailerOpen(open)}
              firstTrailerId={firstTrailerId}
              isShareOpen={isShareOpen}
              onShareOpenChange={(open) => setIsShareOpen(open)}
            />
            <UnreleasedEpisodeModal
              isOpen={unreleasedEpisode != null}
              title={meta?.meta?.name ?? ''}
              episodeLabel={
                unreleasedEpisode &&
                unreleasedEpisode.season != null &&
                unreleasedEpisode.episode != null
                  ? `S${String(unreleasedEpisode.season).padStart(2, '0')}E${String(unreleasedEpisode.episode).padStart(2, '0')}` +
                    (unreleasedEpisode.title ? ` · ${unreleasedEpisode.title}` : '')
                  : null
              }
              poster={unreleasedEpisode?.thumbnail ?? poster ?? null}
              releaseDate={unreleasedEpisode?.released ?? null}
              onClose={() => setUnreleasedEpisode(null)}
            />
            <StreamUnavailableModal
              isOpen={rdRequired}
              title={meta?.meta?.name ?? ''}
              episodeLabel={selectedEpisodeLabel ?? null}
              poster={meta?.meta?.poster ?? null}
              message={RD_REQUIRED_MESSAGE}
              onPickAnother={() => setRdRequired(false)}
              onClose={() => setRdRequired(false)}
            />
          </>
        }
      />
    );
  }

  return (
    <div
      className={
        // dvh, not vh: iOS Safari's `100vh` is the LARGEST viewport
        // (chrome hidden). With the URL/tab bar visible the wrapper
        // ends up taller than the visible area and the page scrolls
        // even though everything fits. `dvh` tracks the current visible
        // viewport so the wrapper matches what the user actually sees.
        'relative z-10 min-h-dvh w-full overflow-x-hidden lg:h-dvh lg:overflow-hidden' +
        (isNetflix ? ' netflix-detail' : '')
      }
    >
      {/* FLIP shared-element morph removed — was causing weirdness on
          /home → /detail (snappy, faster-than-intended morph) without
          providing enough value over the route-level fade alone. The
          "dim" effect users expect is now driven by a CSS animation on
          the persistent `background-image-tSjYu` backdrop layer below
          (see `detail-backdrop-dim` keyframe in index.css). */}
      {/* Desktop background image layer */}
      {(background ?? heroImageFromNav) ? (
        <div className="background-image-layer-wJa90 hidden lg:block">
          <img
            className="background-image-tSjYu"
            src={background ?? heroImageFromNav}
            alt=" "
            loading={heroImageFromNav ? 'eager' : 'lazy'}
          />
        </div>
      ) : null}
      {/* Desktop gradient overlay */}
      <div className="absolute inset-0 z-[1] hidden bg-gradient-to-b from-black/65 via-black/40 to-black/80 lg:block" />

      <div className="relative z-[2] min-h-full lg:h-full">
        {/* Back button - visible on all sizes */}
        <DetailBackButton />

        {/* Mobile action buttons - fixed top right on mobile, hidden on desktop.
            Play button included as the primary teal CTA when web auto-play
            is available (movies only — series use episode click). */}
        <MobileActionButtons
          inLibrary={inLibrary}
          hasTrailer={Boolean(firstTrailerId)}
          onToggleLibrary={handleToggleLibrary}
          onOpenTrailer={handleOpenTrailer}
          onShare={handleShare}
          isLoggedIn={Boolean(authKey)}
          onPlay={null}
        />

        {/* Desktop: Content with sidebar, Mobile: Hero with content overlays */}
        <div className="flex min-h-full flex-col lg:h-full lg:flex-row lg:pb-6 lg:pt-24">
          {/* Mobile: Hero image as background, content overlay */}
          <div className="flex-1 lg:px-8 lg:pb-0 lg:pt-0">
            <MobileHero
              heroPoster={heroPoster ?? null}
              logo={logo ?? null}
              logoTitle={logoTitle}
              logoFailed={logoFailed}
              onLogoError={() => setLogoFailed(true)}
            >
              {MetaContent}
            </MobileHero>


            {/* Desktop content, mobile content below hero */}
            <div className="hidden h-full px-4 lg:flex lg:flex-col lg:px-0">
              <div className="min-h-0 flex-1">{MetaContent}</div>

              <div className="mt-auto pb-2">
                <DesktopActionButtons
                  inLibrary={inLibrary}
                  hasTrailer={Boolean(firstTrailerId)}
                  onToggleLibrary={handleToggleLibrary}
                  onOpenTrailer={handleOpenTrailer}
                  onShare={handleShare}
                  isLoggedIn={Boolean(authKey)}
                  onPlay={null}
                />
              </div>
            </div>{/* End of px-4 wrapper */}
          </div>




          {/* Desktop sidebar - fixed position on right. Hidden on web
              for movies (Play button replaces it). Series keep the
              aside for episode selection. */}
          {!hideMobileStreamPicker && (isSeriesLike || type === 'movie' || type === 'tv' || type === 'channel') ? (
            /* Panel sits inset from the viewport edges so it visually
               lines up with the back button (top-5) and the action
               buttons row (bottom matches via inset). Width scales
               with the viewport, clamped to a comfortable min/max
               instead of a 420px fixed value. */
            <aside
              className="fixed right-5 top-10 bottom-10 z-20 hidden lg:block"
              style={{ width: 'clamp(360px, 28vw, 560px)' }}
            >
              <FocusContext.Provider value={asideFocusKey}>
                <div
                  ref={asideFocusRef}
                  key={`${type}-${id}`}
                  className="detail-streams-drawer h-full overflow-hidden rounded-[28px] border border-white/10 bg-black/35 backdrop-blur"
                >
                  <DetailStreamsPanel
                    variant="desktop"
                    streamRows={desktopRows}
                    {...sharedStreamsPanelProps}
                  />
                </div>
              </FocusContext.Provider>
            </aside>
          ) : null}
        </div>

        <DetailModals
          isTrailerOpen={isTrailerOpen}
          onTrailerOpenChange={(open) => setIsTrailerOpen(open)}
          firstTrailerId={firstTrailerId}
          isShareOpen={isShareOpen}
          onShareOpenChange={(open) => setIsShareOpen(open)}
        />

        {/* Unreleased-episode info modal — shared component with
            the player's Episodes drawer so both surfaces show the
            same dialog when a user clicks a future-dated episode. */}
        <UnreleasedEpisodeModal
          isOpen={unreleasedEpisode != null}
          title={meta?.meta?.name ?? ''}
          episodeLabel={
            unreleasedEpisode
              && unreleasedEpisode.season != null
              && unreleasedEpisode.episode != null
              ? `S${String(unreleasedEpisode.season).padStart(2, '0')}E${String(unreleasedEpisode.episode).padStart(2, '0')}`
              + (unreleasedEpisode.title ? ` · ${unreleasedEpisode.title}` : '')
              : null
          }
          poster={unreleasedEpisode?.thumbnail ?? poster ?? null}
          releaseDate={unreleasedEpisode?.released ?? null}
          onClose={() => setUnreleasedEpisode(null)}
        />

        {/* RD-only Android: shown when a magnet / local-server stream is
            tapped (it cannot play without the absent torrent server).
            Inert on desktop/browser — rdRequired only ever becomes true
            under isAndroidTv(). */}
        <StreamUnavailableModal
          isOpen={rdRequired}
          title={meta?.meta?.name ?? ''}
          episodeLabel={selectedEpisodeLabel ?? null}
          poster={meta?.meta?.poster ?? null}
          message={RD_REQUIRED_MESSAGE}
          onPickAnother={() => setRdRequired(false)}
          onClose={() => setRdRequired(false)}
        />
      </div>
    </div>
  );
}
