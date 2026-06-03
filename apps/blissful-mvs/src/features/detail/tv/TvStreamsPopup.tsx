// Centered stream-selection popup for the TV detail page. Opened by clicking an
// episode (series) or the Watch button (movie). The BODY reuses <StreamList>
// verbatim — same Continue-watching + Top picks + 4K/1080p/720p/SD/Other bucket
// ranking the desktop sidebar uses (all buckets start expanded on TV) — so the
// torrent logic is untouched. useTvOverlay pauses Norigin and drives native
// focus across the rows; Play navigates via the page's handleNavigateToPlayer.

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '@heroui/react';
import { StreamList } from '../components/StreamList';
import { StreamFilters } from '../components/StreamFilters';
import { useTvOverlay } from '../../../spatial/useTvOverlay';
import type { StreamRow } from '../streams';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  type: string;
  id: string;
  selectedVideoId: string | null;
  streamRows: StreamRow[];
  streamsLoading: boolean;
  addonSelectItems: Array<{ key: string; label: string }>;
  selectedAddon: string;
  onSelectAddon: (key: string) => void;
  metaName: string | null;
  metaPoster?: string | null;
  episodeLabel?: string | null;
  getEpisodeProgressInfo: (videoId: string) => {
    percent: number;
    hasProgress: boolean;
    watched: boolean;
    timeSeconds: number;
    durationSeconds: number;
  };
  onNavigate: (playerLink: string) => boolean | void;
};

export function TvStreamsPopup({
  open,
  onClose,
  title,
  type,
  id,
  selectedVideoId,
  streamRows,
  streamsLoading,
  addonSelectItems,
  selectedAddon,
  onSelectAddon,
  metaName,
  metaPoster,
  episodeLabel,
  getEpisodeProgressInfo,
  onNavigate,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useTvOverlay({
    open,
    containerRef,
    onClose,
    autoFocusSelector: '.tv-stream-popup-body button',
  });

  if (!open) return null;

  return createPortal(
    <div className="tv-stream-popup-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        className="tv-stream-popup-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Select a stream"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="tv-stream-popup-head">
          <button type="button" className="tv-stream-popup-iconbtn" onClick={onClose} aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="tv-stream-popup-title">{title}</div>
          <button type="button" className="tv-stream-popup-iconbtn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="tv-stream-popup-filters">
          <StreamFilters
            addonSelectItems={addonSelectItems}
            selectedAddon={selectedAddon}
            onSelectAddon={onSelectAddon}
            showAddonSelect
            addonWidthClassName="w-[180px]"
          />
        </div>

        <div className="tv-stream-popup-body">
          {streamsLoading ? (
            <div className="flex w-full items-center justify-center py-10">
              <Spinner
                size="lg"
                color="current"
                className="text-[var(--bliss-accent)] drop-shadow-[0_0_12px_var(--bliss-accent-glow)]"
              />
            </div>
          ) : null}
          {!streamsLoading && streamRows.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              No streams found.
            </div>
          ) : null}
          <StreamList
            rows={streamRows}
            variant="desktop"
            type={type}
            id={id}
            selectedVideoId={selectedVideoId}
            metaName={metaName}
            metaPoster={metaPoster ?? null}
            episodeLabel={episodeLabel ?? null}
            getEpisodeProgressInfo={getEpisodeProgressInfo}
            onNavigate={(link) => {
              // Close (which for series clears videoId and navigates to /detail
              // with `replace`) ONLY when we did NOT route to the player. On a
              // successful play the page is already pushing /player; closing here
              // would replace that entry with /detail and bounce straight back —
              // the "stream opens then nothing happens" bug. On a bail
              // (RD-required / unreleased modal) we DO close so the popup gets
              // out of the modal's way.
              const didNavigate = onNavigate(link);
              if (didNavigate === false) onClose();
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
