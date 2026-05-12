import { useMemo, useState } from 'react';
import type { WhatToDoPrompt } from '../../../components/WhatToDoDrawer';
import { resolveProgress, formatTimecode } from '../../../lib/progress';
import type { StreamRow } from '../streams';
import { isElectronDesktopApp } from '../../../lib/platform';
import { isIos } from '../utils';
import { PlayCircleIcon } from '../../../icons/PlayCircleIcon';
import { Accordion, Separator } from '@heroui/react';
import { ResumeOrStartOverModal } from '../../../components/ResumeOrStartOverModal';

// Resolution bucket for stream grouping. Below the "Top picks" section
// the order is fixed: 4K → 1080p → 720p → SD → Other. Within each bucket
// streams are ranked by the global score (seeders / sqrt(sizeGB + 1)).
type ResolutionBucket = '4K' | '1080p' | '720p' | 'SD' | 'Other';
const BUCKET_ORDER: ResolutionBucket[] = ['4K', '1080p', '720p', 'SD', 'Other'];

function bucketOf(row: StreamRow): ResolutionBucket {
  const hay = `${row.leftLabel} ${row.rightTitle} ${row.metaLine ?? ''}`.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(hay)) return '4K';
  if (/\b(1440p|2k|1080p|fhd|full ?hd)\b/.test(hay)) return '1080p';
  if (/\b(720p|hd)\b/.test(hay)) return '720p';
  if (/\b(480p|sd)\b/.test(hay)) return 'SD';
  return 'Other';
}

type ExternalOpenPrompt = {
  title: string;
  url: string;
  reason: string;
  internalPlayerLink: string | null;
};

type StreamListProps = {
  rows: StreamRow[];
  variant: 'mobile' | 'desktop';
  type: string;
  id: string;
  selectedVideoId: string | null;
  metaName: string | null;
  metaPoster?: string | null;
  episodeLabel?: string | null;
  onlyTorrentioRdResolve: boolean;
  // Merged progress source (local progressStore + Stremio library state).
  // The sidebar Continue Watching uses Stremio library state directly —
  // localStorage often hasn't been populated yet for series episodes, so
  // looking only at progressStore here yields 0%. The detail page's
  // useLibraryState hook already merges both sources; we delegate to it.
  getEpisodeProgressInfo?: (videoId: string) => {
    percent: number;
    hasProgress: boolean;
    watched: boolean;
    timeSeconds: number;
    durationSeconds: number;
  };
  onNavigate: (playerLink: string) => void;
  onOpenIosPrompt: (prompt: WhatToDoPrompt) => void;
  onOpenExternalPrompt: (prompt: ExternalOpenPrompt) => void;
};

export function StreamList({
  rows,
  variant,
  type,
  id,
  selectedVideoId,
  metaName,
  metaPoster,
  episodeLabel,
  onlyTorrentioRdResolve,
  getEpisodeProgressInfo,
  onNavigate,
  onOpenIosPrompt,
  onOpenExternalPrompt,
}: StreamListProps) {
  const isMobile = variant === 'mobile';
  const displayRows = rows;
  const rowClassName = isMobile
    ? 'group relative flex w-full items-start gap-3 rounded-2xl px-3 py-2 text-left transition '
    : 'group relative flex w-full items-start gap-4 rounded-2xl px-4 py-2.5 text-left transition ';

  const metaGridClassName = isMobile
    ? 'grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1'
    : 'grid grid-cols-[8.25rem_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1';

  const playIconSize = isMobile ? 18 : 22;
  const playIconWrapper = isMobile
    ? 'grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white/90 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'
    : 'grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/90 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100';

  // Single resolver across the app — works for movies (no videoId) and
  // series episodes alike, and merges Stremio library state with the
  // local progress store under the hood. Prefer the parent-supplied
  // hook (it has access to the library item) but fall through to the
  // shared resolver if the prop wasn't passed.
  const progressInfo = useMemo(() => {
    if (selectedVideoId && getEpisodeProgressInfo) {
      return getEpisodeProgressInfo(selectedVideoId);
    }
    return resolveProgress({ type, id, videoId: selectedVideoId ?? undefined });
  }, [getEpisodeProgressInfo, selectedVideoId, type, id]);
  const moviePercent = progressInfo.percent;
  // Only the "Continue watching" row (isLastPlayed) gets a progress bar.
  // Other rows are fresh stream candidates — showing the same bar on all
  // of them is visual noise.
  const progress = useMemo(
    () => displayRows.map((row) => (row.isLastPlayed ? moviePercent : 0)),
    [displayRows, moviePercent]
  );

  // Add `?t=<seconds>` to a player URL so clicking the progress bar
  // resumes exactly where we left off. PlayerPage reads `t` from
  // searchParams and seeks mpv to that timestamp after loadfile.
  const buildResumeLink = (baseLink: string, seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return baseLink;
    const [path, query = ''] = baseLink.split('?');
    const params = new URLSearchParams(query);
    params.set('t', String(Math.floor(seconds)));
    return `${path}?${params.toString()}`;
  };

  // Group rows by resolution bucket. The bucket header order below is
  // FIXED (4K → 1080p → 720p → SD → Other); within each bucket rows
  // preserve the upstream score-based order.
  const grouped = useMemo(() => {
    const lastPlayedRows: StreamRow[] = [];
    const buckets: Record<ResolutionBucket, StreamRow[]> = {
      '4K': [],
      '1080p': [],
      '720p': [],
      SD: [],
      Other: [],
    };
    for (const row of displayRows) {
      if (row.isLastPlayed) {
        lastPlayedRows.push(row);
        continue;
      }
      buckets[bucketOf(row)].push(row);
    }
    return { lastPlayedRows, buckets };
  }, [displayRows]);

  // HeroUI Accordion's expandedKeys API — Set of bucket names currently
  // expanded. Multiple buckets can be open simultaneously.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Continue Watching click pops the shared ResumeOrStartOverModal so the
  // user can pick "Resume hh:mm:ss" or "Start over" before navigating.
  // We stash the row we want to play next; null means modal closed.
  const [resumePromptRow, setResumePromptRow] = useState<StreamRow | null>(null);

  const indexOfRow = useMemo(() => {
    const m = new Map<StreamRow, number>();
    displayRows.forEach((row, i) => m.set(row, i));
    return m;
  }, [displayRows]);

  const renderRow = (row: StreamRow, idx: number) => {
        const {
          addonName,
          stream,
          leftLabel,
          rightTitle,
          metaLine,
          metaSeeders,
          metaSize,
          metaProvider,
          effectiveUrl,
          externalStreaming,
          externalWeb,
          likelyPlayableInBrowser,
          unplayableReason,
        } = row;
        const deepLinks = (stream as any).deepLinks as
          | {
              player?: string | null;
              externalPlayer?: {
                web?: string | null;
                streaming?: string | null;
              };
            }
          | undefined;
        const playerLink = deepLinks?.player ?? null;
        const isDisabled = !playerLink;

        const p = progress[idx] ?? 0;
        const metaParts = [metaSeeders, metaSize, metaProvider].filter(
          (v): v is string => typeof v === 'string' && v.length > 0
        );

        return (
          <div key={`${addonName}-${idx}`}>
            <button
            type="button"
            className={
              rowClassName +
              (isDisabled
                ? 'cursor-not-allowed bg-white/3 opacity-60'
                : 'cursor-pointer bg-white/0 hover:bg-white/10 focus-visible:bg-white/10')
            }
            disabled={isDisabled}
            onClick={() => {
              if (!playerLink) return;

              if (isIos()) {
                const bestExternal = externalStreaming ?? externalWeb ?? effectiveUrl;
                if (bestExternal) {
                  onOpenIosPrompt({
                    title: rightTitle,
                    url: bestExternal,
                    playerLink,
                    metaLine,
                    metaParts,
                    itemInfo: {
                      id,
                      type,
                      name: metaName || rightTitle,
                      videoId: selectedVideoId ?? undefined,
                    },
                  });
                  return;
                }
              }

              if (!isElectronDesktopApp() && !isIos() && !onlyTorrentioRdResolve && !likelyPlayableInBrowser) {
                const bestExternal = externalStreaming ?? externalWeb ?? effectiveUrl;
                if (bestExternal) {
                  onOpenExternalPrompt({
                    title: rightTitle,
                    url: bestExternal,
                    reason: unplayableReason ?? 'This stream may not work in the web player.',
                    internalPlayerLink: playerLink,
                  });
                  return;
                }
              }

              // Continue Watching row → pop the resume/start-over modal
              // first. For non-resume rows just open as usual.
              if (row.isLastPlayed && progressInfo.timeSeconds > 0) {
                setResumePromptRow(row);
                return;
              }
              onNavigate(playerLink);
            }}
          >
            <div className="w-full">
              <div className={metaGridClassName}>
                {!isMobile ? (
                  <div
                    className="whitespace-pre-line text-sm font-semibold leading-tight text-white/90"
                    title={leftLabel}
                  >
                    {leftLabel}
                  </div>
                ) : null}

                <div
                  className="min-w-0 text-sm font-semibold leading-snug text-white line-clamp-2 break-words"
                  title={rightTitle}
                >
                  {rightTitle}
                </div>

                <div className="justify-self-end self-center pt-1">
                  <div className={playIconWrapper}>
                    <PlayCircleIcon size={playIconSize} />
                  </div>
                </div>
              </div>

              <div
                className={
                  'mt-1 flex w-full flex-wrap items-center text-xs text-white/60 ' +
                  (isMobile ? 'gap-x-2 gap-y-0.5' : 'gap-x-3 gap-y-1')
                }
              >
                {metaParts.length > 0 ? (
                  metaParts.map((part) => (
                    <div key={part} className="min-w-0 truncate" title={metaLine ?? undefined}>
                      {part}
                    </div>
                  ))
                ) : metaLine ? (
                  <div className="min-w-0 flex-1 truncate" title={metaLine}>
                    {metaLine}
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
              </div>
              {p > 0 ? (
                <div className="mt-2 flex items-center gap-2 text-[10px] text-white/55">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-emerald-400 transition-[width]"
                      style={{ width: `${p}%` }}
                    />
                  </div>
                  <span className="tabular-nums">
                    {progressInfo.timeSeconds > 0
                      ? formatTimecode(progressInfo.timeSeconds)
                      : `${Math.round(p)}%`}
                  </span>
                </div>
              ) : null}
            </div>
            </button>
             {idx < displayRows.length - 1 ? <Separator className="my-1 bg-white/10" /> : null}
           </div>
         );
  };

  // Always-visible top picks: the highest-ranked 4K and 1080p stream. They
  // appear regardless of whether they would have been in the visible
  // top-2 of their bucket below — point is to guarantee the user always
  // sees one of each resolution if such streams exist. Their bucket
  // entries get a "pinned" flag to avoid showing the same row twice.
  const pinned4K = grouped.buckets['4K'][0] ?? null;
  const pinned1080p = grouped.buckets['1080p'][0] ?? null;
  const pinnedRows = [pinned4K, pinned1080p].filter((r): r is StreamRow => r !== null);

  const dedupKey = (r: StreamRow) => `${r.stream.url ?? ''}::${r.stream.infoHash ?? ''}`;
  const pinnedKeys = new Set(pinnedRows.map(dedupKey));
  const filteredBuckets: typeof grouped.buckets = {
    '4K': grouped.buckets['4K'].filter((r) => !pinnedKeys.has(dedupKey(r))),
    '1080p': grouped.buckets['1080p'].filter((r) => !pinnedKeys.has(dedupKey(r))),
    '720p': grouped.buckets['720p'],
    SD: grouped.buckets.SD,
    Other: grouped.buckets.Other,
  };

  // Each bucket renders as a HeroUI Accordion.Item — header shows the
  // resolution + stream count; body shows every stream in that bucket
  // (pinned top-picks excluded since they're already on the page above).
  const bucketsToRender = BUCKET_ORDER.filter(
    (bucket) => filteredBuckets[bucket].length > 0,
  );

  return (
    <div className="space-y-1">
      {grouped.lastPlayedRows.length > 0 ? (
        <div className="space-y-1">
          <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/55">
            Continue watching
          </div>
          {grouped.lastPlayedRows.map((row) => renderRow(row, indexOfRow.get(row) ?? 0))}
        </div>
      ) : null}
      {pinnedRows.length > 0 ? (
        <div className="space-y-1">
          <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/55">
            Top picks
          </div>
          {pinnedRows.map((row) => renderRow(row, indexOfRow.get(row) ?? 0))}
        </div>
      ) : null}
      <ResumeOrStartOverModal
        isOpen={resumePromptRow !== null}
        title={metaName ?? resumePromptRow?.rightTitle ?? ''}
        episodeLabel={episodeLabel ?? null}
        subtitle={resumePromptRow?.leftLabel ?? null}
        poster={metaPoster ?? null}
        resumeSeconds={progressInfo.timeSeconds}
        onResume={() => {
          if (!resumePromptRow) return;
          const link = (resumePromptRow.stream as { deepLinks?: { player?: string | null } })
            .deepLinks?.player;
          if (link) onNavigate(buildResumeLink(link, progressInfo.timeSeconds));
        }}
        onStartOver={() => {
          if (!resumePromptRow) return;
          const link = (resumePromptRow.stream as { deepLinks?: { player?: string | null } })
            .deepLinks?.player;
          if (link) {
            // Strip any pre-existing `t` (the deepLink may have baked it
            // in from the local progressStore) so playback starts at 0.
            const [path, query = ''] = link.split('?');
            const params = new URLSearchParams(query);
            params.delete('t');
            const url = params.toString().length > 0 ? `${path}?${params.toString()}` : path;
            onNavigate(url);
          }
        }}
        onClose={() => setResumePromptRow(null)}
      />
      {bucketsToRender.length > 0 ? (
        <Accordion
          expandedKeys={expandedKeys}
          onExpandedChange={(keys) => {
            setExpandedKeys(new Set(Array.from(keys, String)));
          }}
          className="px-0"
        >
          {bucketsToRender.map((bucket) => {
            const rows = filteredBuckets[bucket];
            return (
              <Accordion.Item key={bucket} id={bucket}>
                <Accordion.Heading>
                  <Accordion.Trigger className="px-3 py-2 hover:bg-white/5">
                    <div className="mr-auto flex items-center gap-2">
                      <span className="text-sm font-semibold text-white/90">{bucket}</span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
                        {rows.length}
                      </span>
                    </div>
                    <Accordion.Indicator className="ml-auto" />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body className="px-0 pb-2 pt-1">
                    <div className="space-y-1">
                      {rows.map((row) => renderRow(row, indexOfRow.get(row) ?? 0))}
                    </div>
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      ) : null}
    </div>
  );
}
