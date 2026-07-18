import { BlissButton } from '../components/base';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { useAddons } from '../context/AddonsProvider';
import { useAuth } from '../context/AuthProvider';
import { useUI } from '../context/UIProvider';
import { normalizeStremioImage } from '../lib/mediaTypes';
import { proxiedImage, preloadImage } from '../lib/imageProxy';
import { getLibraryEntry } from '../lib/libraryStore';
import { useContinueWatchingContext } from '../context/ContinueWatchingProvider';
import { showHeroTransition } from '../lib/heroTransition';
import { consumeClickedPoster, metahubPosterToBackdrop } from '../lib/transitionPoster';
import { getLastStreamSelection } from '../lib/streamHistory';
import { buildPlayerPath, parsePlayerPath } from '../lib/playerUrl';
import { useMetaDetails } from '../models/useMetaDetails';
import { DesktopActionButtons, MobileActionButtons } from '../features/detail/components/ActionButtons';
import { MetaPanel } from '../features/detail/components/MetaPanel';
import { MobileHero } from '../features/detail/components/MobileHero';
import { DetailStreamsPanel } from '../features/detail/components/DetailStreamsPanel';
import { DetailModals } from '../features/detail/components/DetailModals';
import { useEpisodeSelection } from '../features/detail/hooks/useEpisodeSelection';
import { useStreamFilters } from '../features/detail/hooks/useStreamFilters';
import { useExternalOpenPrompt } from '../features/detail/hooks/useExternalOpenPrompt';
import { useLibraryState } from '../features/detail/hooks/useLibraryState';
import { formatDate, getEpisodeTitle, parseNumber } from '../features/detail/utils';
import { buildStreamsView } from '../features/detail/streams';
import { useImdbRating } from '../lib/useImdbRating';
import { fetchTmdbId, type TmdbLookup } from '../lib/tmdb';
import { ResumeOrStartOverModal } from '../components/ResumeOrStartOverModal';
import { UnreleasedEpisodeModal } from '../components/UnreleasedEpisodeModal';
import { type BananaOption } from '../components/BananasPicker';
import { fetchFallbackReleases } from '../lib/fallbackReleases';
import { getResumeSeconds } from '../layout/app-shell/utils';
import { isNativeShell } from '../lib/desktop';

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
    onlyTorrentioRdResolve,
    setOnlyTorrentioRdResolve,
  } = useStreamFilters();

  const { externalOpenPrompt, openExternalPrompt, closeExternalPrompt } = useExternalOpenPrompt();

  const [logoFailed, setLogoFailed] = useState(false);

  const isSeriesLike = type === 'series' || type === 'anime';

  const lastStream = useMemo(() => {
    if (!type || !id) return null;
    const vid = isSeriesLike ? (selectedVideoId ?? null) : null;
    return getLastStreamSelection({ authKey, type, id, videoId: vid });
  }, [authKey, id, selectedVideoId, type, isSeriesLike]);

  // The last-played release as a ready-to-pin "Progress Banana" with a resume
  // link. Lets the streams panel show what you were watching even when the
  // current per-episode results don't include that exact release (e.g. a
  // season pack), mirroring the in-player picker.
  const lastPlayedPin = useMemo(() => {
    if (!lastStream?.url || !type || !id) return null;
    const vid = isSeriesLike && selectedVideoId ? selectedVideoId : null;
    // Web resume is ALWAYS vidking-first: the pin is a short /player/vidking/…
    // URL, not the exact saved (often RD) stream. When vidking is up you get
    // vidking; when its CDN is down the player self-falls-back to RD. Desktop
    // keeps the exact saved container so mpv plays it natively at full quality.
    const playerLink = isNativeShell()
      ? `/player?${(() => {
          const p = new URLSearchParams({ url: lastStream.url, type, id });
          if (vid) p.set('videoId', vid);
          return p.toString();
        })()}`
      : buildPlayerPath({ source: 'vidking', id, videoId: vid, title: lastStream.title ?? null });
    return {
      url: lastStream.url,
      title: lastStream.title ?? null,
      playerLink,
    };
  }, [lastStream, type, id, isSeriesLike, selectedVideoId]);

  const [isTrailerOpen, setIsTrailerOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  // progress is used via the streams model's deepLinks.

  // Series: streams should only appear after explicit episode selection.
  const enableStreams = !isSeriesLike || selectedVideoId !== null;

  const { meta, metaLoading, streamsByAddon, streamsLoading, streamsTotal } = useMetaDetails({
    type,
    id,
    streamVideoId: selectedVideoId,
    addons,
    enableStreams,
  });

  const videos = meta?.meta?.videos ?? [];

  const {
    season,
    setSeason,
    episodeSearch,
    setEpisodeSearch,
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

  const {
    inLibrary,
    handleToggleLibrary,
    getEpisodeProgressInfo,
    libraryVersion,
    stremioLibraryItem,
  } = useLibraryState({
    authKey,
    id,
    type,
    metaName: meta?.meta?.name ?? null,
    metaPoster: meta?.meta?.poster ?? null,
  });

  // Web-only: filter to the single best release that direct-plays in
  // Chrome (H.264 video + non-EAC3 audio per title hints). Falls back
  // to unfiltered if no title matches.
  // Web wants ONE instantly browser-playable (H.264/AAC) stream; the desktop
  // shell plays raw torrents in mpv, so show the FULL list there instead.
  const webInstantOnly = !isNativeShell();

  const streamsViewDesktop = useMemo(
    () =>
      buildStreamsView(streamsByAddon, {
        selectedAddon,
        // Desktop shell (mpv) plays raw torrents — don't filter to RD-resolve
        // browser-playable streams; show every release like the player's drawer.
        onlyTorrentioRdResolve: isNativeShell() ? false : onlyTorrentioRdResolve,
        streamSortKey,
        lastStreamUrl: lastStream?.url ?? null,
        webInstantOnly,
      }),
    [lastStream, onlyTorrentioRdResolve, selectedAddon, streamSortKey, streamsByAddon, webInstantOnly]
  );

  const streamsViewMobile = useMemo(
    () =>
      buildStreamsView(streamsByAddon, {
        selectedAddon,
        onlyTorrentioRdResolve: false,
        streamSortKey,
        lastStreamUrl: lastStream?.url ?? null,
        webInstantOnly,
      }),
    [lastStream, selectedAddon, streamSortKey, streamsByAddon, webInstantOnly]
  );

  const desktopRows = streamsViewDesktop.rows;

  const mobileTorrentioRows = useMemo(
    () => streamsViewMobile.rows.filter((row) => row.addonName === 'Torrentio RD'),
    [streamsViewMobile.rows]
  );

  const handleToggleWebReady = useCallback(() => {
    setOnlyTorrentioRdResolve((v) => !v);
  }, [setOnlyTorrentioRdResolve]);

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
    img.src = proxiedImage(highResBackdrop);
  }, [flipPoster, highResBackdrop, guessedBackdrop]);

  useEffect(() => {
    if (!heroImageFromNav) return;
    const safety = setTimeout(() => showHeroTransition(null), 1500);
    return () => clearTimeout(safety);
  }, [heroImageFromNav]);
  useEffect(() => {
    if (!heroImageFromNav || !background) return;
    const img = new Image();
    img.src = proxiedImage(background);
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

  // How many stream addons haven't reported back yet — drives the panel's
  // "N addons still loading" bar so results can show progressively instead of
  // waiting for the slowest addon.
  const streamsPending = useMemo(() => {
    if (!streamsLoading) return 0;
    if (selectedAddon !== 'ALL') return streamsByAddon[selectedAddon] ? 0 : 1;
    return Math.max(0, streamsTotal - Object.keys(streamsByAddon).length);
  }, [streamsLoading, selectedAddon, streamsByAddon, streamsTotal]);

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

  // Look up TMDB id (vidking.net uses TMDB IDs, not IMDb). Cached in
  // sessionStorage by lib/tmdb.ts. Null until lookup completes or if
  // no TMDB API key is configured in Settings.
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
  // Per-season TMDB still URLs: { [season]: { [episodeNumber]: url } }.
  // Fallback episode-card artwork when metahub's thumbnail 404s (newer
  // seasons metahub hasn't generated stills for). Populated alongside the
  // ratings map from the same /tmdb-season-info fetch.
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
      fetch(`/tmdb-season-info?tmdbId=${tid}&season=${n}`)
        .then((r) => r.json())
        .then((d: { episodes?: TmdbEp[] }) => d.episodes ?? [])
        .catch(() => []);
    void (async () => {
      // Cinemeta and TMDB often disagree on how a show is split into
      // seasons — especially anime (TMDB numbers absolutely or uses
      // different season boundaries, e.g. Naruto is 35/48/48/48/41 on
      // Cinemeta but 52/52/54 on TMDB). So we ignore per-season episode
      // numbers and map by absolute episode POSITION (the Nth episode
      // overall), which both sides share since they follow broadcast
      // order. `offset` = episodes in this show's earlier Cinemeta seasons.
      const counts: Record<number, number> = {};
      for (const v of videos) {
        if (typeof v.season === 'number' && v.season > 0) {
          counts[v.season] = (counts[v.season] ?? 0) + 1;
        }
      }
      const seasonCount = counts[s] ?? 0;
      let offset = 0;
      for (const key of Object.keys(counts)) {
        const n = Number(key);
        if (n > 0 && n < s) offset += counts[n];
      }
      const maxAbs = offset + (seasonCount || 60);

      // Concatenate TMDB seasons in order, assigning each episode a running
      // absolute index, until we've covered this Cinemeta season's range.
      const absStill: Record<number, string> = {};
      const absRating: Record<number, number> = {};
      let running = 0;
      for (let ts = 1; ts <= 60 && running < maxAbs; ts++) {
        const eps = await fetchSeason(ts);
        if (cancelled) return;
        if (eps.length === 0) break;
        for (const e of eps) {
          running += 1;
          if (e.still) absStill[running] = e.still;
          if (e.vote_average != null) absRating[running] = e.vote_average;
        }
      }
      if (cancelled) return;
      const stills: Record<number, string> = {};
      const ratings: Record<number, number> = {};
      for (let ep = 1; ep <= seasonCount; ep++) {
        const abs = offset + ep;
        if (absStill[abs]) stills[ep] = absStill[abs];
        if (absRating[abs] != null) ratings[ep] = absRating[abs];
      }
      setEpisodeStillsBySeason((prev) => ({ ...prev, [s]: stills }));
      setEpisodeRatingsBySeason((prev) => ({ ...prev, [s]: ratings }));
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

  // Parse "tt9813792:4:3" -> { season: 4, episode: 3 } from the
  // currently-selected episode id (Stremio format).
  const seriesSeasonEpisode = useMemo(() => {
    if (!isSeriesLike || !selectedVideoId) return null;
    const parts = selectedVideoId.split(':');
    if (parts.length < 3) return null;
    const season = Number.parseInt(parts[parts.length - 2], 10);
    const episode = Number.parseInt(parts[parts.length - 1], 10);
    if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
    return { season, episode };
  }, [isSeriesLike, selectedVideoId]);

  // Vidking iframe playback gate. TMDB lookup must succeed, and for
  // TV the user must have an episode selected.
  const canPlayWithVidking = useMemo(() => {
    if (!tmdbLookup) return false;
    if (tmdbLookup.mediaType === 'tv') return !!seriesSeasonEpisode;
    return tmdbLookup.mediaType === 'movie';
  }, [tmdbLookup, seriesSeasonEpisode]);

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
      videoId: string | null;
      playerLink: string | null;
    } | null
  >(null);
  // Early/leaked torrents often exist before the air date. When the unreleased
  // modal opens, fetch the house RD fallback releases: null = checking,
  // [] = none, [...] = available → the modal lists them under "Play with
  // RealDebrid" and picking one plays it directly.
  const [unreleasedRdStreams, setUnreleasedRdStreams] = useState<BananaOption[] | null>(null);
  useEffect(() => {
    const vid = unreleasedEpisode?.videoId;
    if (!vid) {
      setUnreleasedRdStreams(unreleasedEpisode ? [] : null);
      return;
    }
    let cancelled = false;
    setUnreleasedRdStreams(null);
    fetchFallbackReleases({
      type: 'series',
      id: vid,
      addons,
      showTitle: meta?.meta?.name ?? undefined,
      onPartial: (list) => { if (!cancelled && list.length > 0) setUnreleasedRdStreams(list); },
    })
      .then((list) => { if (!cancelled) setUnreleasedRdStreams(list); })
      .catch(() => { if (!cancelled) setUnreleasedRdStreams([]); });
    return () => { cancelled = true; };
  }, [unreleasedEpisode, addons, meta?.meta?.name]);

  const handleNavigateToPlayer = useCallback(
    (playerLink: string, options?: { replace?: boolean; bypassUnreleased?: boolean; pickReleases?: boolean; rdUrl?: string }) => {
      const url = new URL(playerLink, window.location.origin);
      let shortTarget = parsePlayerPath(url.pathname);
      // A torrent picked in the unreleased selector → play it EXACTLY (skip
      // Videasy). That's an explicit stream, so drop to the query form even if
      // the incoming link was short. Implies bypassing the unreleased gate.
      if (options?.rdUrl) {
        const q = new URLSearchParams();
        if (shortTarget) {
          q.set('type', shortTarget.type);
          q.set('id', shortTarget.id);
          if (shortTarget.videoId) q.set('videoId', shortTarget.videoId);
        } else {
          for (const [k, v] of url.searchParams) q.set(k, v);
        }
        q.set('url', options.rdUrl);
        q.set('rdsel', '1');
        url.pathname = '/player';
        url.search = q.toString();
        shortTarget = null;
        options = { ...options, bypassUnreleased: true };
      }
      // Block playback of unreleased TV episodes (unless explicitly bypassed
      // via the modal's "Play with RD"). Works for both the short path (videoId
      // parsed from the URL) and the legacy query form.
      // Desktop: no block at all — early/leaked torrents often exist before
      // the air date and the stream picker is simply empty when none do
      // (deliberate desktop decision, 402b53c).
      const targetVideoId = shortTarget?.videoId ?? url.searchParams.get('videoId');
      const onPlayerRoute = shortTarget != null || url.pathname === '/player';
      if (!isNativeShell() && !options?.bypassUnreleased && targetVideoId && onPlayerRoute) {
        const vmeta = (meta?.meta?.videos ?? []).find((v) => v.id === targetVideoId);
        const releasedAt = vmeta?.released ? Date.parse(vmeta.released) : NaN;
        if (Number.isFinite(releasedAt) && releasedAt > Date.now()) {
          setUnreleasedEpisode({
            season: vmeta?.season ?? null,
            episode: vmeta?.episode ?? null,
            title: vmeta?.title ?? vmeta?.name ?? null,
            released: vmeta?.released ?? null,
            thumbnail: vmeta?.thumbnail ?? null,
            videoId: targetVideoId,
            playerLink,
          });
          return;
        }
      }
      // Short URL: keep it clean — the player looks up poster/background/title
      // from Cinemeta (cached from this page, so no veil flash). Just warm the
      // logo cache and preserve any tiny flag already on it (e.g. ?t=0).
      if (shortTarget) {
        if (logo) preloadImage(logo);
        let dest = url.pathname + (url.search || '');
        if (options?.pickReleases) dest += (dest.includes('?') ? '&' : '?') + 'pickReleases=1';
        navigate(dest, { replace: options?.replace === true });
        return;
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
      // Warm the buffering-veil logo at click so it's painted on player entry
      // (it already renders on this page, so this is usually a cache hit — but
      // it guarantees the fetch is in flight even on a cold paint).
      if (logo) preloadImage(logo);

      // sessionStorage for next-episode is now written by useEffect above

      // "Play with RD" → land directly in the torrent (Releases) selector.
      if (options?.pickReleases) url.searchParams.set('pickReleases', '1');
      navigate(`${url.pathname}?${url.searchParams.toString()}`, {
        replace: options?.replace === true,
      });
    },
    [poster, background, meta, logo, navigate]
  );

  // Resume-or-start-over flow. When the user taps Play on a title
  // with saved progress, we pop the shared modal first (bitcine-
  // style). Movies use the LibraryItem's top-level timeOffset; series
  // use the per-episode progress from `getEpisodeProgressInfo`.
  const [resumeModalState, setResumeModalState] = useState<{
    videoId: string | null;
    seconds: number;
  } | null>(null);

  const navigateToPlayer = useCallback(
    (overrideVideoId: string | null, resumeAtSec: number) => {
      if (!type || !id) return;
      // Short, vidking-first URL. The resume position stays OUT of the URL —
      // the player looks it up from Continue-Watching progress. `start-over`
      // (resumeAtSec <= 0) forces t=0 so that lookup is skipped.
      let link = buildPlayerPath({
        source: 'vidking',
        id,
        videoId: overrideVideoId ?? null,
        title: meta?.meta?.name ?? null,
      });
      if (!(resumeAtSec > 0)) link += '?t=0';
      handleNavigateToPlayer(link);
    },
    [handleNavigateToPlayer, id, type, meta]
  );

  const handlePlayWithVidking = useCallback(
    (overrideVideoId?: string | null) => {
      if (!type || !id) return;
      const useVideoId = overrideVideoId ?? selectedVideoId;
      // Compute saved-progress seconds for whatever the user is about
      // to play. Movies → LibraryItem.timeOffset via getResumeSeconds.
      // Series → per-episode progress via getEpisodeProgressInfo.
      let resumeSec = 0;
      if (isSeriesLike && useVideoId) {
        const info = getEpisodeProgressInfo(useVideoId);
        if (info?.hasProgress && info.timeSeconds > 0) resumeSec = info.timeSeconds;
      } else if (stremioLibraryItem) {
        const s = getResumeSeconds(stremioLibraryItem);
        if (typeof s === 'number' && Number.isFinite(s) && s > 0) resumeSec = s;
      }
      // No saved progress → play directly. Otherwise bounce through
      // the Resume / Start-over modal.
      if (resumeSec <= 0) {
        navigateToPlayer(useVideoId ?? null, 0);
        return;
      }
      setResumeModalState({ videoId: useVideoId ?? null, seconds: resumeSec });
    },
    [
      type,
      id,
      selectedVideoId,
      isSeriesLike,
      getEpisodeProgressInfo,
      stremioLibraryItem,
      navigateToPlayer,
    ]
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
        `/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}${
          fallbackQs ? `?${fallbackQs}` : ''
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
      `/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}${
        cleanedQs ? `?${cleanedQs}` : ''
      }`,
      { replace: true },
    );

    const [path, qs = ''] = link.split('?');
    const params = new URLSearchParams(qs);
    if (autoplayTimeRaw && Number.parseInt(autoplayTimeRaw, 10) > 0) {
      params.set('t', autoplayTimeRaw);
    }
    // Carry the watch-party room through the autoplay bounce. A desktop party
    // join for a title with no stored stream routes here
    // (buildRoomPlayerUrl → /detail/…?autoplay=1&room=CODE); without this the
    // stream's deepLink player URL has no room, so the player starts the movie
    // but never joins the party — "plays alone, no room indication".
    const roomParam = searchParams.get('room');
    if (roomParam) params.set('room', roomParam);
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
    // Web series: force the panel to stay on the episode-list view so
    // users never see the stream picker — episode click goes straight
    // to /player (Vidking).
    // On WEB, series lock to the episode list (clicking an episode goes to
    // Vidking, never a torrent list). In the desktop shell mpv needs a torrent,
    // so let the hook's rightMode flow: episode list -> pick episode -> its
    // torrents -> back. (Movies use the hook's 'streams' on both.)
    rightMode: isSeriesLike && !isNativeShell() ? ('episodes' as const) : rightMode,
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
    episodeSearch,
    onEpisodeSearchChange: setEpisodeSearch,
    videosForSeason,
    showRuntime: (meta?.meta?.runtime as string | null | undefined) ?? null,
    showRating: meta?.meta?.imdbRating ?? null,
    showImdbId: /^tt\d{5,}$/.test(id) ? id : null,
    episodeRatings: currentSeasonRatings,
    episodeStills: currentSeasonStills,
    episodeStillsPending,
    allVideos: videos,
    tmdbId: tmdbLookup?.tmdbId ?? null,
    onSelectEpisode:
      isSeriesLike && !isNativeShell()
        ? (vid: string) => {
            // WEB series: set the selected episode AND immediately navigate to
            // /player (Vidking iframe) — the user never sees a stream picker.
            // The desktop shell falls through to onSelectEpisode instead, which
            // selects the episode and shows its torrent list (mpv can't play
            // Vidking), so picking an episode no longer pops the resume modal.
            setSelectedVideoId(vid);
            handlePlayWithVidking(vid);
          }
        : onSelectEpisode,
    getEpisodeProgressInfo,
    normalizeImage: normalizeStremioImage,
    formatDate,
    getEpisodeTitle,
    addonSelectItems,
    selectedAddon,
    onSelectAddon: handleSelectAddon,
    onlyTorrentioRdResolve,
    onToggleWebReady: handleToggleWebReady,
    streamsLoading: streamsLoadingFiltered,
    type,
    id,
    metaName: meta?.meta?.name ?? null,
    metaPoster: meta?.meta?.poster ?? null,
    onNavigate: handleNavigateToPlayer,
    onOpenExternalPrompt: openExternalPrompt,
    lastPlayed: lastPlayedPin,
    streamsPending,
  } as const;

  // Hide the mobile stream picker entirely for movies on web (Play
  // button on detail page replaces it). Series keep the panel — it
  // hosts the episode list — but its rightMode is locked to 'episodes'
  // so the stream view never appears.
  const hideMobileStreamPicker = !isSeriesLike;
  // The desktop streams aside is the ONLY play path for movies in the desktop
  // shell — the "Play with Vidking" button is web-only (!isNativeShell()), so
  // without this a movie there has no Play button AND no picker (unplayable).
  // Show the aside for series always, and for movies/tv/channels in the native
  // shell; web movies still use the Play button instead of the picker.
  const showDesktopStreamsAside =
    isSeriesLike || (isNativeShell() && (type === 'movie' || type === 'tv' || type === 'channel'));
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
    // Prefer the meta logo; until the meta fetch resolves, fall back to a
    // `?logo=` hint passed by the Continue-Watching handler (which already
    // resolved it before navigating here). Without the hint, the veil is
    // plain black for the meta-fetch duration — the visible "black screen,
    // no logo" gap in the CW resume chain.
    const veilLogo = logo ?? searchParams.get('logo');
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black">
        {/* Logo only, no fallback — titles without a meta logo paint
            a clean black backdrop while the auto-pick effect resolves
            and the player loads. */}
        {veilLogo ? (
          <div className="bliss-buffering-panel">
            <img className="bliss-buffering-loader" src={proxiedImage(veilLogo)} alt=" " />
          </div>
        ) : null}
      </div>
    );
  }

  // Graceful empty state. Some ids exist on IMDB but have no entry in
  // any of our meta sources (Cinemeta only indexes titles above a
  // popularity threshold; fringe/niche titles — often reached via a
  // stale link or a leftover Kitsu Continue-Watching row — return
  // `{}`). Without this guard the page renders its full layout against
  // a null `meta` and the user sees a black void with no way to tell
  // what happened. Show a "couldn't load" card with a Back button
  // instead. Only triggers once loading is done AND there's no
  // fallback poster to paint (so a known title mid-load still shows
  // its backdrop).
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
        <BlissButton
          variant="ghost"
          className="mt-2 rounded-full bg-white/10 text-white"
          onPress={() => {
            const safeBack = sessionStorage.getItem('bliss:safe-back') ?? '/';
            navigate(safeBack);
          }}
        >
          Back
        </BlissButton>
      </div>
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
            src={proxiedImage(background ?? heroImageFromNav)}
            alt=" "
            loading={heroImageFromNav ? 'eager' : 'lazy'}
          />
        </div>
      ) : null}
      {/* Desktop gradient overlay */}
      <div className="absolute inset-0 z-[1] hidden bg-gradient-to-b from-black/65 via-black/40 to-black/80 lg:block" />

      <div className="relative z-[2] min-h-full lg:h-full">
        {/* Back button - visible on all sizes */}
        <div className="fixed left-4 top-4 z-50 lg:absolute lg:left-5 lg:top-5 lg:z-20">
          <BlissButton
            variant="ghost"
            className="rounded-full bg-black/50 text-white backdrop-blur lg:bg-white/10"
            onPress={() => {
              // Never `navigate(-1)` — that walks history and would land
              // on /player when the user came from the player back
              // button. AppShell tracks the most recent non-player,
              // non-detail route in sessionStorage; use that as the
              // back target. Falls back to "/" on a fresh open.
              const safeBack = sessionStorage.getItem('bliss:safe-back') ?? '/';
              navigate(safeBack);
            }}
          >
            Back
          </BlissButton>
        </div>

        {/* Mobile action buttons - fixed top right on mobile, hidden on desktop.
            Play button included as the primary teal CTA when web auto-play
            is available (movies only — series use episode click). */}
        <MobileActionButtons
          inLibrary={inLibrary}
          hasTrailer={Boolean(firstTrailerId)}
          onToggleLibrary={handleToggleLibrary}
          onOpenTrailer={handleOpenTrailer}
          onShare={handleShare}
          onPlay={!isNativeShell() && !isSeriesLike && canPlayWithVidking ? () => handlePlayWithVidking() : null}
          isLoggedIn={Boolean(authKey)}
        />

        {/* Desktop: Content with sidebar, Mobile: Hero with content overlays */}
        <div className="flex min-h-full flex-col lg:h-full lg:flex-row lg:pb-6 lg:pt-14">
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
                  onPlay={!isNativeShell() && !isSeriesLike && canPlayWithVidking ? () => handlePlayWithVidking() : null}
                  isLoggedIn={Boolean(authKey)}
                />
              </div>
            </div>{/* End of px-4 wrapper */}
          </div>




          {/* Desktop sidebar - fixed position on right. Hidden on web
              for movies (Play button replaces it). Series keep the
              aside for episode selection. */}
          {showDesktopStreamsAside ? (
            /* Panel sits inset from the viewport edges so it visually
               lines up with the back button (top-5) and the action
               buttons row (bottom matches via inset). Width scales
               with the viewport, clamped to a comfortable min/max
               instead of a 420px fixed value. */
            <aside
              className="fixed right-5 top-10 bottom-10 z-20 hidden lg:block"
              style={{ width: 'clamp(360px, 28vw, 560px)' }}
            >
              <div
                key={`${type}-${id}`}
                className="detail-streams-drawer h-full overflow-hidden rounded-[28px] border border-white/10 bg-black/35 backdrop-blur"
              >
                <DetailStreamsPanel
                  variant="desktop"
                  streamRows={desktopRows}
                  {...sharedStreamsPanelProps}
                />
              </div>
            </aside>
          ) : null}
        </div>

        <ResumeOrStartOverModal
          isOpen={resumeModalState !== null}
          title={meta?.meta?.name ?? ''}
          episodeLabel={(() => {
            const vid = resumeModalState?.videoId;
            if (!isSeriesLike || !vid) return null;
            const parts = vid.split(':');
            const s = parts[parts.length - 2];
            const e = parts[parts.length - 1];
            return s && e
              ? `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`
              : null;
          })()}
          poster={normalizeStremioImage(meta?.meta?.poster ?? null) ?? null}
          resumeSeconds={resumeModalState?.seconds ?? 0}
          onResume={() => {
            const s = resumeModalState;
            setResumeModalState(null);
            if (s) navigateToPlayer(s.videoId, s.seconds);
          }}
          onStartOver={() => {
            const s = resumeModalState;
            setResumeModalState(null);
            if (s) navigateToPlayer(s.videoId, 0);
          }}
          onClose={() => setResumeModalState(null)}
        />

        <DetailModals
          isTrailerOpen={isTrailerOpen}
          onTrailerOpenChange={(open) => setIsTrailerOpen(open)}
          firstTrailerId={firstTrailerId}
          isShareOpen={isShareOpen}
          onShareOpenChange={(open) => setIsShareOpen(open)}
          externalOpenPrompt={externalOpenPrompt}
          onCloseExternalPrompt={closeExternalPrompt}
          onOpenExternalPlayer={(streamUrl, title) => {
            const safeTitle = title.replace(/[\\/:*?"<>|]+/g, '-').trim();
            const body = `#EXTM3U\n#EXTINF:-1,${safeTitle}\n${streamUrl}\n`;
            const blob = new Blob([body], { type: 'audio/x-mpegurl' });
            const href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            a.download = `${safeTitle || 'stream'}.m3u`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => URL.revokeObjectURL(href), 1000);
            closeExternalPrompt();
          }}
          onTryWebPlayer={(playerLink) => {
            if (playerLink) navigate(playerLink);
            closeExternalPrompt();
          }}
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
          releases={unreleasedRdStreams}
          onPickTorrent={
            unreleasedEpisode?.playerLink
              ? (rdUrl) => {
                  const link = unreleasedEpisode.playerLink!;
                  setUnreleasedEpisode(null);
                  handleNavigateToPlayer(link, { rdUrl });
                }
              : undefined
          }
          onClose={() => setUnreleasedEpisode(null)}
        />
      </div>
    </div>
  );
}
