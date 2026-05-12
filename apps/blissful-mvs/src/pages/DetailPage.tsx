import { Button } from '@heroui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { datastorePutLibraryItems, normalizeStremioImage } from '../lib/stremioApi';
import { getLastStreamSelection } from '../lib/streamHistory';
import { useMetaDetails } from '../models/useMetaDetails';
import { DesktopActionButtons, MobileActionButtons } from '../features/detail/components/ActionButtons';
import { MetaPanel } from '../features/detail/components/MetaPanel';
import { MobileHero } from '../features/detail/components/MobileHero';
import { DetailStreamsPanel } from '../features/detail/components/DetailStreamsPanel';
import { DetailModals } from '../features/detail/components/DetailModals';
import { useEpisodeSelection } from '../features/detail/hooks/useEpisodeSelection';
import { useStreamFilters } from '../features/detail/hooks/useStreamFilters';
import { useExternalOpenPrompt } from '../features/detail/hooks/useExternalOpenPrompt';
import { useIosPlayPrompt } from '../features/detail/hooks/useIosPlayPrompt';
import { useLibraryState } from '../features/detail/hooks/useLibraryState';
import { formatDate, getDisplayName, getEpisodeTitle, openInVlc, parseNumber } from '../features/detail/utils';
import { buildStreamsView } from '../features/detail/streams';
import { isElectronDesktopApp } from '../lib/platform';
import { useImdbRating } from '../lib/useImdbRating';

export default function DetailPage() {
  const { addons, authKey, setQuery, uiStyle } = useAppContext();
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNetflix = uiStyle === 'netflix';

  const type = (params.type ?? 'movie') as string;
  const id = params.id ? decodeURIComponent(params.id) : '';
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  const {
    selectedAddon,
    setSelectedAddon,
    streamSortKey,
    onlyTorrentioRdResolve,
    setOnlyTorrentioRdResolve,
  } = useStreamFilters();

  const { externalOpenPrompt, openExternalPrompt, closeExternalPrompt } = useExternalOpenPrompt();

  const [logoFailed, setLogoFailed] = useState(false);

  const { iosPlayPrompt, openIosPrompt, closeIosPrompt } = useIosPlayPrompt();
  const isSeriesLike = type === 'series' || type === 'anime';

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
        }),
      );
    } catch { /* sessionStorage may be unavailable */ }
  }, [isSeriesLike, id, type, nextEpisode]);

  const {
    inLibrary,
    handleToggleLibrary,
    getEpisodeProgressInfo,
    libraryVersion,
  } = useLibraryState({
    authKey,
    id,
    type,
    metaName: meta?.meta?.name ?? null,
    metaPoster: meta?.meta?.poster ?? null,
  });

  const streamsViewDesktop = useMemo(
    () =>
      buildStreamsView(streamsByAddon, {
        selectedAddon,
        onlyTorrentioRdResolve: isElectronDesktopApp() ? false : onlyTorrentioRdResolve,
        streamSortKey,
        lastStreamUrl: lastStream?.url ?? null,
      }),
    [lastStream, onlyTorrentioRdResolve, selectedAddon, streamSortKey, streamsByAddon]
  );

  const streamsViewMobile = useMemo(
    () =>
      buildStreamsView(streamsByAddon, {
        selectedAddon,
        onlyTorrentioRdResolve: false,
        streamSortKey,
        lastStreamUrl: lastStream?.url ?? null,
      }),
    [lastStream, selectedAddon, streamSortKey, streamsByAddon]
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

  const background = normalizeStremioImage(meta?.meta?.background) ?? normalizeStremioImage(meta?.meta?.poster);
  const poster = normalizeStremioImage(meta?.meta?.poster) ?? background;
  const logo = normalizeStremioImage(meta?.meta?.logo);

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
  const displayName = getDisplayName(meta?.meta, id, type) ?? (metaLoading ? 'Loading…' : id);
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

  // Mobile hero poster (poster is preferred over background for clarity)
  const heroPoster = normalizeStremioImage(meta?.meta?.background) ?? normalizeStremioImage(meta?.meta?.poster);

  const handleNavigateToPlayer = useCallback(
    (playerLink: string, options?: { replace?: boolean }) => {
      const url = new URL(playerLink, window.location.origin);
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

      // sessionStorage for next-episode is now written by useEffect above

      navigate(`${url.pathname}?${url.searchParams.toString()}`, {
        replace: options?.replace === true,
      });
    },
    [poster, background, meta?.meta?.name, logo, navigate]
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
    episodeSearch,
    onEpisodeSearchChange: setEpisodeSearch,
    videosForSeason,
    onSelectEpisode,
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
    onOpenIosPrompt: openIosPrompt,
    onOpenExternalPrompt: openExternalPrompt,
  } as const;

  const TorrentsContent = (
    <div className="block px-4 pb-6 lg:hidden">
      {isSeriesLike || type === 'movie' || type === 'tv' || type === 'channel' ? (
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
        displayName={displayName}
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
          {logo || poster ? (
            <img
              className="bliss-buffering-loader"
              src={logo ?? poster ?? undefined}
              alt=" "
            />
          ) : (
            <div className="bliss-buffering-fallback">Loading</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        'relative z-10 min-h-screen w-full overflow-x-hidden lg:h-screen lg:overflow-hidden' +
        (isNetflix ? ' netflix-detail' : '')
      }
    >
      {/* Desktop background image layer */}
      {background ? (
        <div className="background-image-layer-wJa90 hidden lg:block">
          <img
            className="background-image-tSjYu"
            src={background}
            alt=" "
            loading="lazy"
          />
        </div>
      ) : null}
      {/* Desktop gradient overlay */}
      <div className="absolute inset-0 z-[1] hidden bg-gradient-to-b from-black/65 via-black/40 to-black/80 lg:block" />

      <div className="relative z-[2] min-h-full lg:h-full">
        {/* Back button - visible on all sizes */}
        <div className="fixed left-4 top-4 z-50 lg:absolute lg:left-5 lg:top-5 lg:z-20">
          <Button
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
          </Button>
        </div>

        {/* Mobile action buttons - fixed top right on mobile, hidden on desktop */}
        <MobileActionButtons
          inLibrary={inLibrary}
          hasTrailer={Boolean(firstTrailerId)}
          onToggleLibrary={handleToggleLibrary}
          onOpenTrailer={handleOpenTrailer}
          onShare={handleShare}
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
              displayName={displayName}
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
                />
              </div>
            </div>{/* End of px-4 wrapper */}
          </div>




          {/* Desktop sidebar - fixed position on right */}
          {isSeriesLike || type === 'movie' || type === 'tv' || type === 'channel' ? (
            <aside className="fixed inset-y-0 right-0 z-20 hidden h-screen w-[420px] lg:block">
              <div
                key={`${type}-${id}`}
                className="detail-streams-drawer h-full overflow-hidden rounded-none border-l border-white/10 bg-black/35 backdrop-blur"
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
          iosPlayPrompt={iosPlayPrompt}
          onCloseIosPrompt={closeIosPrompt}
          onPlayIosVlc={(url, itemInfo) => {
            // Launch external app immediately to preserve iOS user-gesture context.
            openInVlc(url);
            closeIosPrompt();

            if (itemInfo && authKey) {
              void (async () => {
                try {
                  const nowIso = new Date().toISOString();
                  await datastorePutLibraryItems({
                    authKey,
                    changes: [
                      {
                        _id: itemInfo.id,
                        name: itemInfo.name,
                        type: itemInfo.type,
                        poster: meta?.meta?.poster ?? null,
                        posterShape: 'poster',
                        removed: false,
                        temp: true,
                        _ctime: nowIso,
                        _mtime: nowIso,
                        state: {
                          timeOffset: 0,
                          duration: 1,
                          lastWatched: nowIso,
                          timeWatched: 0,
                          overallTimeWatched: 0,
                          timesWatched: 0,
                          flaggedWatched: 0,
                          video_id: itemInfo.videoId ?? null,
                          watched: null,
                          lastVidReleased: null,
                          noNotif: false,
                        },
                      },
                    ],
                  });
                } catch {
                  // ignore
                }
              })();
            }
          }}
          onPlayIosWeb={(playerLink) => {
            navigate(playerLink);
            closeIosPrompt();
          }}
        />
      </div>
    </div>
  );
}
