import { useMemo } from 'react';
import type { StreamRow } from '../streams';
import { isIos } from '../utils';
import { isNativeShell } from '../../../lib/desktop';
import { BananasPicker, type BananaOption } from '../../../components/BananasPicker';
import { EpisodePanel } from './EpisodePanel';
import { SeasonHeader } from './SeasonHeader';
import { StreamFilters } from './StreamFilters';

type DetailStreamsPanelProps = {
  variant: 'mobile' | 'desktop';
  isSeriesLike: boolean;
  rightMode: 'episodes' | 'streams';
  selectedVideoId: string | null;
  selectedEpisodeLabel: string | null;
  nextEpisode: { id: string } | null;
  onBackToEpisodes: () => void;
  onNextEpisode: () => void;
  season: number | null;
  seasonSelectItems: Array<{ key: string; label: string }>;
  onSeasonChange: (season: number) => void;
  canPrevSeason: boolean;
  canNextSeason: boolean;
  onPrevSeason: () => void;
  onNextSeason: () => void;
  episodeSearch: string;
  onEpisodeSearchChange: (value: string) => void;
  videosForSeason: Array<{
    id: string;
    thumbnail?: string | null;
    released?: string | null;
    episode?: number;
    title?: string;
    name?: string;
    number?: number;
    description?: string;
    runtime?: string;
    rating?: number | string | null;
  }>;
  /** Show-level runtime fallback for per-episode display. */
  showRuntime?: string | null;
  /** Show-level IMDB rating — used as a per-episode fallback when
   *  Cinemeta returns "0" / no rating for the episode (very common). */
  showRating?: number | string | null;
  /** Show's IMDB id (tt-prefixed). Lets the per-episode Rating
   *  component fetch IMDB → TMDB fallback when no inline rating is
   *  available. */
  showImdbId?: string | null;
  /** Per-episode TMDB rating map for the current season: `{ [episode]: vote_average }`.
   *  Populated by DetailPage when the user picks a season (lazy
   *  /tmdb-season-info fetch). */
  episodeRatings?: Record<number, number> | undefined;
  /** Per-episode TMDB still URLs for the current season: `{ [episode]: url }`.
   *  Used as the episode-card thumbnail fallback when metahub 404s. */
  episodeStills?: Record<number, string> | undefined;
  /** True while the season's TMDB still fetch is in flight (keeps the
   *  episode-card skeleton up instead of flashing the show poster). */
  episodeStillsPending?: boolean;
  /** Full episode list across all seasons — drives the EpisodesDrawer
   *  (which manages season selection internally). */
  allVideos: Array<{
    id: string;
    title?: string | null;
    season?: number | null;
    episode?: number | null;
    thumbnail?: string | null;
    released?: string | null;
    description?: string | null;
  }>;
  /** Optional TMDB id for per-season metadata enrichment. */
  tmdbId?: number | null;
  onSelectEpisode: (id: string) => void;
  getEpisodeProgressInfo: (id: string) => {
    percent: number;
    hasProgress: boolean;
    watched: boolean;
    timeSeconds: number;
    durationSeconds: number;
  };
  normalizeImage: (value?: string | null) => string | null | undefined;
  formatDate: (value?: string) => string | null;
  getEpisodeTitle: (video: { title?: string; name?: string; id: string }) => string;
  addonSelectItems: Array<{ key: string; label: string }>;
  selectedAddon: string;
  onSelectAddon: (key: string) => void;
  onlyTorrentioRdResolve: boolean;
  onToggleWebReady: () => void;
  streamsLoading: boolean;
  streamRows: StreamRow[];
  type: string;
  id: string;
  metaName: string | null;
  metaPoster?: string | null;
  onNavigate: (playerLink: string) => void;
  onOpenExternalPrompt: (prompt: { title: string; url: string; reason: string; internalPlayerLink: string | null }) => void;
  /** The last-played stream from local history (`getLastStreamSelection`),
   *  with a ready-to-play resume link. Pinned as the "Progress Banana" row even
   *  when the current per-episode results don't include it (e.g. a season pack
   *  the episode query didn't return) — so the pin always reflects what you
   *  were watching, like the in-player picker does. */
  lastPlayed?: { url: string; title: string | null; playerLink: string } | null;
  /** How many stream addons haven't reported back yet. When > 0 the panel keeps
   *  showing whatever's arrived and surfaces a "N addons still loading" bar at
   *  the bottom (Stremio-style) instead of blocking on the slowest addon. */
  streamsPending?: number;
};

export function DetailStreamsPanel({
  variant,
  isSeriesLike,
  rightMode,
  selectedVideoId,
  selectedEpisodeLabel,
  nextEpisode,
  onBackToEpisodes,
  onNextEpisode,
  season,
  seasonSelectItems,
  onSeasonChange,
  canPrevSeason,
  canNextSeason,
  onPrevSeason,
  onNextSeason,
  episodeSearch,
  onEpisodeSearchChange,
  videosForSeason,
  showRuntime,
  showRating,
  showImdbId,
  episodeRatings,
  episodeStills,
  episodeStillsPending,
  onSelectEpisode,
  getEpisodeProgressInfo,
  normalizeImage,
  formatDate,
  getEpisodeTitle,
  addonSelectItems,
  selectedAddon,
  onSelectAddon,
  onlyTorrentioRdResolve,
  onToggleWebReady,
  streamsLoading,
  streamRows,
  metaName,
  metaPoster,
  onNavigate,
  onOpenExternalPrompt,
  lastPlayed,
  streamsPending = 0,
}: DetailStreamsPanelProps) {
  const isDesktop = variant === 'desktop';
  const seasonHeaderClassName = isDesktop ? 'p-4' : 'p-3';
  const episodeListClassName = isDesktop
    ? 'h-[calc(100%-7rem)] overflow-auto px-4 pb-4 pt-3 hide-scrollbar'
    : 'max-h-[60vh] overflow-auto px-3 pb-3 pt-2 hide-scrollbar';
  const filterClassName = isDesktop ? 'px-4 pb-4' : 'px-3 pb-3';
  // Desktop: a fixed-height flex column — the list scrolls inside `flex-1`, and
  // the "addons still loading" bar sits as a footer pinned to the container's
  // bottom (so it's there even when the list is short).
  const streamListOuterClassName = isDesktop ? 'flex h-[calc(100%-10.75rem)] flex-col' : '';
  const streamListScrollClassName = isDesktop
    ? 'min-h-0 flex-1 overflow-auto px-4 pb-2 hide-scrollbar'
    : '';
  const streamEmptyClassName = isDesktop
    ? 'rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70'
    : '';

  // Streams → the shared BananasPicker shape (same picker the player Releases
  // drawer + unreleased modal use). Keep a url→row map so onSelect can run the
  // detail's play logic. `url` is the raw stream URL (carries the infohash for
  // BananasPicker's dedup); we navigate via the row's /player deep link.
  const releaseOptions = useMemo<BananaOption[]>(() => {
    const opts: BananaOption[] = streamRows
      .map((row) => ({
        name: row.leftLabel,
        torrentName: row.rightTitle,
        quality: null,
        // metaSize is "💾 5.84 GB" — strip the emoji to the raw size.
        size: row.metaSize ? row.metaSize.replace(/^\D+/, '').trim() || null : null,
        seeders: row.seedersNum != null ? String(row.seedersNum) : null,
        url: row.effectiveUrl ?? row.playerLink ?? '',
      }))
      .filter((r) => r.url);
    // Pin the last-played release even when the current per-episode results
    // don't include it (e.g. a season pack the episode query didn't return).
    // Inject a synthetic option from stored history; the picker pins it via
    // `selectedReleaseUrl` and dedups against a real row by infohash if present.
    if (lastPlayed?.url && !opts.some((o) => o.url === lastPlayed.url)) {
      opts.unshift({
        name: '',
        torrentName: lastPlayed.title,
        quality: null,
        size: null,
        seeders: null,
        url: lastPlayed.url,
      });
    }
    return opts;
  }, [streamRows, lastPlayed]);
  const rowByUrl = useMemo(() => {
    const m = new Map<string, StreamRow>();
    for (const row of streamRows) {
      const key = row.effectiveUrl ?? row.playerLink ?? '';
      if (key && !m.has(key)) m.set(key, row);
    }
    return m;
  }, [streamRows]);
  const lastPlayedUrl = useMemo(() => {
    const r = streamRows.find((x) => x.isLastPlayed);
    return r ? r.effectiveUrl ?? r.playerLink ?? null : null;
  }, [streamRows]);
  const handleSelectRelease = (url: string) => {
    const row = rowByUrl.get(url);
    // Real row → its /player deep link. Synthetic Progress Banana pin (not in
    // the current results) → the pre-built resume link from stored history.
    const playerLink =
      row?.playerLink ?? (lastPlayed && url === lastPlayed.url ? lastPlayed.playerLink : null);
    if (!playerLink) return;
    // Non-browser-playable on WEB → offer an external player (VLC). In the
    // desktop shell mpv plays everything (rows are flagged playable and the
    // web-ready filter is off there), so this branch never trips. Only applies
    // when we have a real row (the synthetic pin has no playability metadata).
    if (row && !isIos() && !onlyTorrentioRdResolve && !row.likelyPlayableInBrowser) {
      const bestExternal = row.externalStreaming ?? row.externalWeb ?? row.effectiveUrl;
      if (bestExternal) {
        onOpenExternalPrompt({
          title: row.rightTitle,
          url: bestExternal,
          reason: row.unplayableReason ?? 'This stream may not work in the web player.',
          internalPlayerLink: playerLink,
        });
        return;
      }
    }
    onNavigate(playerLink);
  };

  return (
    <>
      <SeasonHeader
        isSeriesLike={isSeriesLike}
        rightMode={rightMode}
        selectedVideoId={selectedVideoId}
        selectedEpisodeLabel={selectedEpisodeLabel}
        nextEpisode={nextEpisode}
        onBackToEpisodes={onBackToEpisodes}
        onNextEpisode={onNextEpisode}
        season={season}
        seasonSelectItems={seasonSelectItems}
        onSeasonChange={onSeasonChange}
        canPrevSeason={canPrevSeason}
        canNextSeason={canNextSeason}
        onPrevSeason={onPrevSeason}
        onNextSeason={onNextSeason}
        episodeSearch={episodeSearch}
        onEpisodeSearchChange={onEpisodeSearchChange}
        className={seasonHeaderClassName}
      />

      {isSeriesLike && rightMode === 'episodes' ? (
        <EpisodePanel
          videosForSeason={videosForSeason}
          onSelectVideo={onSelectEpisode}
          getEpisodeProgressInfo={getEpisodeProgressInfo}
          normalizeImage={normalizeImage}
          formatDate={formatDate}
          getEpisodeTitle={getEpisodeTitle}
          listContainerClassName={episodeListClassName}
          fallbackPoster={metaPoster ?? null}
          showRuntime={showRuntime ?? null}
          showRating={showRating ?? null}
          showImdbId={showImdbId ?? null}
          episodeRatings={episodeRatings}
          episodeStills={episodeStills}
          episodeStillsPending={episodeStillsPending}
        />
      ) : (
        <>
          <StreamFilters
            addonSelectItems={addonSelectItems}
            selectedAddon={selectedAddon}
            onSelectAddon={onSelectAddon}
            showAddonSelect={isDesktop}
            onlyTorrentioRdResolve={onlyTorrentioRdResolve}
            onToggleWebReady={onToggleWebReady}
            className={filterClassName}
            addonWidthClassName={isDesktop ? undefined : 'w-[120px]'}
            // "Web Ready" filters to RD-resolvable (browser-playable) streams — a
            // web-only concept; mpv in the desktop shell plays raw torrents, so
            // hide the toggle there and show every release.
            showWebReadyToggle={isDesktop && !isNativeShell()}
          />

          <div data-testid="detail-streams-list" className={streamListOuterClassName}>
            <div className={streamListScrollClassName}>
              {/* Show results progressively (Stremio-style): the picker renders
                  as soon as anything has arrived; a slow addon never blocks it.
                  No centered spinner — while results are still loading the only
                  indicator is the "addons still loading" bar at the bottom. */}
              {releaseOptions.length > 0 ? (
                <BananasPicker
                  releases={releaseOptions}
                  selectedReleaseUrl={lastPlayed?.url ?? lastPlayedUrl}
                  onSelectRelease={handleSelectRelease}
                  reselectable
                  verifyCache
                  relevanceTitle={metaName}
                />
              ) : !streamsLoading ? (
                <div className={streamEmptyClassName}>No streams found.</div>
              ) : null}
            </div>
            {/* "N addons are still loading" — text + an accent indeterminate
                slider, pinned to the bottom of the container (footer, outside the
                scroll area) while more results trickle in. No box of its own. */}
            {streamsLoading && streamsPending > 0 ? (
              <div className={isDesktop ? 'shrink-0 px-4 pb-3 pt-1.5' : 'pt-3'}>
                <div className="text-center text-[13px] font-medium text-white/70">
                  {streamsPending === 1
                    ? '1 addon is still loading'
                    : `${streamsPending} addons are still loading`}
                </div>
                <div className="relative mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="absolute top-0 h-full rounded-full bg-[var(--bliss-accent)]"
                    style={{ animation: 'bliss-indeterminate 1.1s ease-in-out infinite' }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
